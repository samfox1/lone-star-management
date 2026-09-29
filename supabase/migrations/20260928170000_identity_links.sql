-- Identity links: every connected profile that says who the artist is reaches `sameAs`
-- (AI_VISIBILITY_AUDIT.md finding 1.2), 2026-09-28.
--
-- Sam: "add all the connections and links" to the hidden fact card (JSON-LD `sameAs`) that
-- Google and AI engines read. The bridge built `sameAs` from `links`, and the door sends
-- only links with `on_site = true` (20260714160000). A new connection starts OFF the site
-- (a connection is an account; the editor is where it becomes a button), so most of an
-- artist's connections never reached `sameAs`.
--
--   1. links.identity_url   the url TypeScript judged to be the artist's identity profile,
--                           or null. Written ONLY by lib/content.ts (createContent /
--                           updateContent → lib/connections `identityUrlOf`, which asks the
--                           bridge's `isIdentityProfileUrl`), on every write of a link.
--                           Existing rows: scripts/backfill-identity-links.ts (dry run by
--                           default), NOT guessed here in SQL.
--   2. get_public_site      re-created whole from 20260925120000 with `identity_links`
--                           added. Nothing else changes.
--
--      identity_links: [{ url, label }]   url + label and nothing else, in the links
--                                         branch's order (sort_order, then publish time,
--                                         then id so ties are stable). Always present
--                                         ([] when none).
--
-- THE PRIVACY RULE. A link that is not a site button was never chosen to be shown. The door
-- publishes one only when TypeScript judged it an identity profile: never a payment handle
-- (PayPal, Cash App, Venmo: they can carry a personal legal name), an invite (Discord,
-- WhatsApp), a playlist, a booking address, a role-bound button, or an unknown host. Creator
-- and organiser pages that name the artist (Ko-fi, Patreon, Eventbrite) ARE identities (the
-- orchestrator's call, 2026-09-28). SQL cannot run that rule, so it reads the stored verdict — and the verdict is the URL judged, not a boolean: a link rides
-- `identity_links` only while its PUBLISHED url (the snapshot) EQUALS `identity_url` on its
-- working row. So a verdict vouches for one exact string, and nothing can slip past it:
--   • a url edited in the draft is judged for the draft url, not the published one, so the
--     old published url drops out of `identity_links` until the next Publish (it stays a
--     button if it was one: `links` is unchanged);
--   • a url changed by any path that skipped the judgement (a script, a restore) no longer
--     matches, so it is never published by an older verdict;
--   • a published link whose working row is gone has no verdict: INNER join, so it is out.
-- The bridge's `sameAsFrom` runs `isIdentityProfileUrl` again on what arrives.
--
-- Not on the wire in `links`: `identity_url` is not in PUBLISHABLE.link.snapshot, so it never
-- enters a revision, and the links branch (which serves the snapshot wholesale) cannot leak it.
--
-- GRANTS (AGENTS.md): no new function, table or view. get_public_site stays the anon door it
-- is today, restated below. RLS is unchanged: links_rw already scopes every row this file
-- adds a column to, so anon never reads `identity_url` itself.

-- ===========================================================================
-- 1. links.identity_url
-- ===========================================================================
alter table public.links add column if not exists identity_url text;

comment on column public.links.identity_url is
  'The url TypeScript judged to be the artist''s identity profile (lib/connections identityUrlOf, '
  'bridge isIdentityProfileUrl), or null. Written only by lib/content.ts on every link write and by '
  'scripts/backfill-identity-links.ts. get_public_site sends a link as an identity_link only while its '
  'PUBLISHED url equals this. 20260928170000.';

-- ===========================================================================
-- 2. get_public_site: `identity_links`
-- ===========================================================================
-- Re-created whole from 20260925120000. Changed: `identity_links` is new, directly after
-- `links`. Everything else is verbatim.
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
          limit 1))
    )
  end;
$$;

-- The public door, as it is today (anon, authenticated, service_role; queried 2026-09-25).
-- CREATE OR REPLACE keeps the ACL; restated so this file alone says who can call it.
revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated, service_role;
