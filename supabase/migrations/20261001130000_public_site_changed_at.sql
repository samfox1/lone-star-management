-- PUBLIC SITE: + "changed_at", when each KIND of content last changed, so a sitemap can date
-- each page honestly (VISIBILITY_TOOLKIT / ADD_WEBSITE_PLAN: per-page lastmod).
--
-- ── ROLLOUT ORDER (review 2026-09-30) ───────────────────────────────────────────────────
--   this push → lone-star with the new freshness check live (dev merged to main) → publish
--   bridge 0.45 → sites upgrade. A 0.45 site read by OLDER lone-star code makes the AI test say
--   "still showing an older publish" after a restyle. The push alone changes nothing a site on
--   0.44 or older does: they ignore the new key.
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. Save Skeen's public payload:  select public.get_public_site('skeen');
--   3. `supabase db push --dry-run` lists ONLY this file. Then push (`npm run db:push`).
--   4. `npm run audit:grants` (get_public_site is an intended anon door; nothing new).
--   5. Flip CHANGED_AT_PUSHED in tests/integration/publish/site-published-at-payload.test.ts
--      and run that file.
--   6. Skeen's payload again: identical to step 2 except the new "changed_at" object, whose
--      newest value equals "published_at".
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────
-- `published_at` is the newest revision of ANYTHING, style changes included. Sites use it as
-- every page's sitemap lastmod, so a colour tweak re-dates the whole site, and Google learns
-- the dates mean nothing. `changed_at` gives the same stamp per entity_type; the bridge
-- decides which kinds each page shows and dates the page by those.
--
-- ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────────────────
-- get_public_site, VERBATIM from 20260930120000_site_verifications.sql, plus ONE key:
--   "changed_at": { "<entity_type>": "<max(published_at) of that kind>", ... }
-- One entry per kind the artist has any revision of (all 13 kinds the revisions CHECK
-- admits, look kinds included), tombstones counted like `published_at` counts them. `{}`
-- when there are none (unreachable today: the door answers null before the first profile
-- publish, and that publish is itself an 'artist' revision). `published_at` is unchanged.
-- Grants repeat the previous file's exactly: the public door, no wider.
--
-- The draft payload mirrors it: src/lib/site.ts getWorkingSitePayload `changed_at`.

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
      -- The same stamp PER KIND (20261001130000): entity_type -> the newest revision of that
      -- kind, over ALL revisions, tombstones included, exactly like `published_at` above.
      -- `published_at` moves on ANY publish, a style tweak included, so a sitemap that gives
      -- every page that one date teaches Google to ignore it; the bridge dates each page by
      -- the kinds that page shows. Every kind is here, the look kinds (site_styles,
      -- artist_font, brand_color, theme_color) too: which kinds count is the bridge's call.
      -- `{}`, never null, so a site can tell "no key: a door older than this" from "nothing".
      'changed_at', coalesce((
        select jsonb_object_agg(k.entity_type, k.at)
        from (select r.entity_type, max(r.published_at) as at
              from public.revisions r
              where r.artist_id = (select id from a)
              group by r.entity_type) k), '{}'::jsonb),
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
