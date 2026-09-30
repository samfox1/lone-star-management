-- SITE VERIFICATIONS: the codes that prove to Google and Bing that Tapir controls an artist's
-- site (ADD_WEBSITE_PLAN.md, step 2; reviewed 2026-09-30).
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. Save Skeen's public payload:  select public.get_public_site('skeen');
--   3. `supabase db push --dry-run` lists ONLY this file. Then push.
--   4. `npm run audit:grants`.
--   5. Flip MIGRATION_PUSHED in tests/integration/site/site-verifications.test.ts and run it.
--   6. Skeen's payload again: identical to step 2 except the new
--      "verification": {"google": null, "bing": null}.
--
-- ── WHY A TABLE, NOT site_content ───────────────────────────────────────────────────────
-- A manager can write any site_content row and any revisions row through the API
-- (site_content_rw, revisions_rw are FOR ALL), so a code kept there could be swapped for the
-- manager's own and the domain claimed in THEIR Search Console. "Restore version" deletes
-- site_content rows in whole mode, so a revert would silently drop verification; and a
-- one-row publish would add a fake version to the history and move every sitemap lastmod.
-- These codes are CONFIG, like site_kind / custom_site_url: a table only the service role
-- writes, read live by get_public_site, so a new code is on the site within a minute (ISR)
-- with no publish at all. (get_public_site answers nothing before an artist's FIRST publish,
-- so Add website needs the site published once.)
--
-- Two artists can never share a site: unique (provider, site_url) below. The plan's unique
-- index on artists.custom_site_url is not needed now that only staff can set that column.
--
-- ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────────────────
--   1. site_verifications: one row per artist per provider. Service role only (RLS on, no
--      policy, every privilege revoked from anon and authenticated).
--   2. site_verification_status(artist): what a manager may see (provider, address,
--      verified, a reason code), never the code itself. Manager-facing.
--   3. get_public_site: + "verification": {google, bing}.
--   4. artists.site_kind / custom_site_url: only Tapir staff (admins) and the service role
--      may change them. Managers could until now (artists_update is a whole-row policy) and
--      nothing legitimate did; the CLI (scripts/set-custom-site.ts) uses the service role.

-- ── 1. The codes ───────────────────────────────────────────────────────────────────────

create table if not exists public.site_verifications (
  artist_id   uuid not null references public.artists (id) on delete restrict,
  provider    text not null check (provider in ('google', 'bing')),
  -- The ONE address the site is registered under (ADD_WEBSITE_PLAN "One address"): the final
  -- origin after redirects plus "/", https, lower case, punycode for international names.
  -- A bare IP address is refused: a site is registered by its name, never by a number.
  site_url    text not null
              check (char_length(site_url) <= 300
                     and site_url ~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?/$'
                     and site_url !~ '^https://[0-9.]+/$'),
  -- Google: the content of <meta name="google-site-verification">, base64url-ish.
  -- Bing: the content of <meta name="msvalidate.01">, 32 hex digits, any case.
  code        text not null
              check ((provider = 'google' and code ~ '^[A-Za-z0-9_-]{20,128}$')
                  or (provider = 'bing' and code ~ '^[0-9A-Fa-f]{32}$')),
  verified_at timestamptz,
  -- A short reason CODE when the last attempt failed, never raw error text: Bing's key travels
  -- in its request URL and could otherwise leak into a message.
  error_code  text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  updated_at  timestamptz not null default now(),
  primary key (artist_id, provider),
  -- Two artists can never be registered under the same site.
  unique (provider, site_url)
);

create trigger site_verifications_updated_at
  before update on public.site_verifications
  for each row execute function public.set_updated_at();

alter table public.site_verifications enable row level security;
revoke all on table public.site_verifications from public, anon, authenticated;
grant select, insert, update, delete on table public.site_verifications to service_role;

-- ── 2. What a manager may see ──────────────────────────────────────────────────────────

create or replace function public.site_verification_status(p_artist uuid)
returns table (provider text, site_url text, verified boolean, error_code text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.provider, v.site_url, v.verified_at is not null, v.error_code, v.updated_at
  from public.site_verifications v
  where v.artist_id = p_artist
    and ((auth.jwt() ->> 'role') = 'service_role' or public.is_admin() or public.is_manager_of(p_artist))
  order by v.provider;
$$;

revoke all on function public.site_verification_status(uuid) from public, anon;
grant execute on function public.site_verification_status(uuid) to authenticated, service_role;

-- ── 3. The live site receives them ─────────────────────────────────────────────────────

create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug from public.artists where slug = p_slug
  ),
  ap as (
    select r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'artist'
    order by r.published_at desc, r.id desc
    limit 1
  ),
  live as (
    select entity_type, data, published_at
    from public.published_revisions((select id from a))
  ),
  -- The published fonts the site can actually load: an upload with its file, or a Google
  -- family with a name the css2 URL and the font-family string can carry. A revision older
  -- than 20260925120000 has no `source`: it is an upload.
  fonts_live as (
    select data, published_at
    from live
    where entity_type = 'artist_font'
      and data ->> 'family' is not null
      and (
        (coalesce(data ->> 'source', 'upload') = 'upload' and data ->> 'storage_path' is not null)
        or (data ->> 'source' = 'google'
            and coalesce(data ->> 'google_family', '') ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$')
      )
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      -- When the site last changed (SEO_GEO_PLAN B1): the newest revision of anything
      -- published for this artist. Sites use it as the sitemap's lastmod instead of the
      -- clock, so Google learns to trust it.
      -- ALL revisions, tombstones included: deleting a show and publishing changes the
      -- page too (20260826170000; `live` filters `_deleted` rows out).
      'published_at', (select max(r.published_at) from public.revisions r where r.artist_id = (select id from a)),
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(
                 -- on_site rides the snapshot now (20260910130000) so the door can read it;
                 -- it is a GATE, not content, and stays off the wire like audio_path.
                 (t.data - 'audio_path' - 'on_site')
                 || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
                 order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
        from live t
        left join public.tracks trk on trk.id = (t.data ->> 'id')::uuid
        where t.entity_type = 'track'
          -- Presence from the SNAPSHOT (20260910130000, PRESENCE_PLAN S1): a tick on the
          -- Music page is a draft until Publish. The live row is only the fallback for a
          -- revision older than the backfill.
          and coalesce((t.data ->> 'on_site')::boolean, trk.on_site, true)), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg((l.data - 'on_site') order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        -- Presence from the SNAPSHOT (20260911120000): a toggle on the Tour page is a draft
        -- until Publish. Live row only as a fallback for a revision older than the backfill.
        where l.entity_type = 'tour_date' and coalesce((l.data ->> 'on_site')::boolean, td.on_site, true)), '[]'::jsonb),
      'merch',      coalesce((
        -- Newest on top (PRESENCE_PLAN S2, Sam 2026-09-10: merch "should just get added to
        -- the front/top of the list"), and a dragged order wins where one exists. It was
        -- created_at ASCENDING — new products went to the bottom, and the editor's drag
        -- order never reached the site at all.
        select jsonb_agg((l.data - 'on_site') order by (l.data ->> 'sort_order')::int nulls last, (l.data ->> 'created_at') desc, l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        -- Same for merch (20260911120000): the toggle is a draft until Publish.
        where l.entity_type = 'merch' and coalesce((l.data ->> 'on_site')::boolean, m.on_site, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.links lnk on lnk.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'link' and coalesce(lnk.on_site, true)), '[]'::jsonb),
      -- Connected profiles that identify the artist, button or not (20260928170000). url +
      -- label only. Published only while the snapshot's url equals the verdict TypeScript
      -- stored on the working row (see the header): INNER join, so no verdict, no link.
      'identity_links', coalesce((
        select jsonb_agg(jsonb_build_object('url', l.data ->> 'url', 'label', l.data ->> 'label')
                         order by (l.data ->> 'sort_order')::int nulls last, l.published_at, (l.data ->> 'id'))
        from live l
        join public.links lnk on lnk.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'link'
          and lnk.artist_id = (select id from a)
          and lnk.identity_url is not null
          and lnk.identity_url = l.data ->> 'url'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.on_site, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object(
                           'id', data ->> 'id',
                           'purpose', data ->> 'purpose',
                           'path', data ->> 'storage_path',
                           'orientation', data ->> 'orientation',
                           'site_role', data ->> 'site_role',
                           'label', data ->> 'label',
                           'collection', data ->> 'collection',
                           'alt', data ->> 'alt',
                           'kind', data ->> 'kind')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live
        where entity_type = 'media'
          and (data ->> 'purpose' <> 'gallery_image'
               or coalesce((data ->> 'on_site')::boolean, (data ->> 'visible')::boolean, true))
        ), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb),
      'styles', coalesce((
        select jsonb_object_agg(data ->> 'region_key', data ->> 'class_names')
        from live
        where entity_type = 'site_styles'
          and data ->> 'region_key' is not null
          and coalesce(data ->> 'class_names', '') <> ''), '{}'::jsonb),
      'fonts', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'family', data ->> 'family',
                   'label',  data ->> 'label',
                   'path',   data ->> 'storage_path',
                   'format', data ->> 'format',
                   'source', coalesce(data ->> 'source', 'upload'))
                 || case when data ->> 'source' = 'google'
                         then jsonb_build_object('google_family', data ->> 'google_family')
                         else '{}'::jsonb end
                 order by data ->> 'family')
        from fonts_live), '[]'::jsonb),
      'font_slots', coalesce((
        select jsonb_object_agg(slot, f.data ->> 'family')
        from fonts_live f
        cross join lateral jsonb_array_elements_text(f.data -> 'slots') as slot
        where jsonb_typeof(f.data -> 'slots') = 'array'), '{}'::jsonb),
      'brand', jsonb_build_object(
        'colors', coalesce((
          select jsonb_agg(jsonb_build_object(
                             'key',  data ->> 'key',
                             'name', data ->> 'name',
                             'hex',  data ->> 'hex')
                           order by case data ->> 'slot' when 'primary' then 0 when 'secondary' then 1 else 2 end,
                                    (data ->> 'sort_order')::int nulls last,
                                    (data ->> 'created_at'),
                                    published_at)
          from live
          where entity_type = 'brand_color'
            and coalesce(data ->> 'key', '') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
            and char_length(data ->> 'key') <= 40
            and coalesce(data ->> 'hex', '') ~ '^#[0-9a-f]{6}$'), '[]'::jsonb),
        'theme_color', (
          select data ->> 'theme_color'
          from live
          where entity_type = 'theme_color'
            and coalesce(data ->> 'theme_color', '') ~ '^#[0-9a-f]{6}$'
          limit 1)),
      -- Search-engine verification codes (20260930120000): CONFIG, not content, read live from
      -- the service-only site_verifications table, never from a published revision. The site
      -- renders them in <head> (bridge `siteVerification`). Public by nature: they sit in the
      -- page for anyone to read.
      'verification', jsonb_build_object(
        'google', (select v.code from public.site_verifications v
                   where v.artist_id = (select id from a) and v.provider = 'google'),
        'bing',   (select v.code from public.site_verifications v
                   where v.artist_id = (select id from a) and v.provider = 'bing'))
    )
  end;
$$;

-- The public door, as it is today (anon, authenticated, service_role).
revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated, service_role;

-- ── 4. Only staff change where an artist's site lives ──────────────────────────────────

-- A manager changing custom_site_url could point Tapir's registration, the SEO test and the
-- editor at a site that is not theirs. RLS cannot guard one column, so a trigger does, and it
-- refuses by default: any caller with a JWT is refused (42501) unless it is the service role
-- or an admin. Only a direct SQL session with no JWT at all (migrations, the SQL editor)
-- passes. (Review 2026-09-30: an allow-list of roles to refuse would let a token with no
-- role claim through.)
create or replace function public.guard_site_address()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.site_kind is distinct from old.site_kind
      or new.custom_site_url is distinct from old.custom_site_url)
     and auth.jwt() is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'only Tapir staff can change where an artist''s site lives'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_address() from public, anon, authenticated;

drop trigger if exists artists_guard_site_address on public.artists;
create trigger artists_guard_site_address
  before update of site_kind, custom_site_url on public.artists
  for each row execute function public.guard_site_address();
