-- TOUR DATES AND MERCH: presence waits for Publish too (PRESENCE_PLAN.md, revised).
--
-- Sam, 2026-09-11: "I do still want the publish button on the merch and tour pages. The
-- user toggles, hits publish, and it updates on the live site." So these two join the
-- draft-presence kinds: the toggle writes the working row, the door reads `on_site`
-- FROM THE SNAPSHOT, Publish is what shows it — exactly the model music got in
-- 20260910130000. The auto-publish of the day before is withdrawn. Videos, photos and
-- links keep the live-row gate (ADR 0009).
--
-- BACKFILL, as for music: each entity's LATEST tour_date / merch revision gets on_site
-- copied in from its working row, so nobody wakes up "dirty" and nothing that is live
-- today changes. The doors strip on_site from what they emit — a gate, not content —
-- so the public payload is unchanged. Fallback order everywhere: snapshot → live row → true.

with latest as (
  select distinct on (r.entity_type, r.entity_id) r.id, r.entity_type, r.entity_id
  from public.revisions r
  where r.entity_type in ('tour_date', 'merch') and r.entity_id is not null
    and coalesce((r.data ->> '_deleted')::boolean, false) = false
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
)
update public.revisions rv
   set data = rv.data || jsonb_build_object('on_site', coalesce(t.on_site, true))
  from latest l join public.tour_dates t on t.id = l.entity_id
 where rv.id = l.id and l.entity_type = 'tour_date' and rv.data ->> 'on_site' is null;

with latest as (
  select distinct on (r.entity_type, r.entity_id) r.id, r.entity_type, r.entity_id
  from public.revisions r
  where r.entity_type in ('tour_date', 'merch') and r.entity_id is not null
    and coalesce((r.data ->> '_deleted')::boolean, false) = false
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
)
update public.revisions rv
   set data = rv.data || jsonb_build_object('on_site', coalesce(m.on_site, true))
  from latest l join public.merch m on m.id = l.entity_id
 where rv.id = l.id and l.entity_type = 'merch' and rv.data ->> 'on_site' is null;

-- get_public_site, re-created whole from 20260910160000 with the tour and merch branches
-- gating on the snapshot and stripping on_site from the wire.
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
        select jsonb_agg(jsonb_build_object(
                           'family', data ->> 'family',
                           'label',  data ->> 'label',
                           'path',   data ->> 'storage_path',
                           'format', data ->> 'format')
                         order by data ->> 'family')
        from live
        where entity_type = 'artist_font'
          and data ->> 'family' is not null
          and data ->> 'storage_path' is not null), '[]'::jsonb),
      'font_slots', coalesce((
        select jsonb_object_agg(slot, f.data ->> 'family')
        from live f
        cross join lateral jsonb_array_elements_text(f.data -> 'slots') as slot
        where f.entity_type = 'artist_font'
          and f.data ->> 'family' is not null
          and f.data ->> 'storage_path' is not null
          and jsonb_typeof(f.data -> 'slots') = 'array'), '{}'::jsonb)
    )
  end;
$$;
