-- Two corrections to 20260910130000 / 20260910140000, found by the suite the same day.
--
-- 1. on_site is a GATE, not content. It joined the track and release snapshots so the
--    doors could read presence from the published copy — but jsonb_agg(data) then put
--    it ON THE WIRE, and the preview-parity guardrail caught the published payload
--    carrying a key the working payload never had. Every door below strips it from
--    what it emits, exactly as audio_path is stripped. The public payload is byte-for-
--    byte what it was before today.
--
-- 2. get_public_releases must keep its INNER join. The rewrite used a LEFT join to reach
--    the live-row fallback, which quietly widened the LIST door: a release whose working
--    row was deleted without a tombstone re-appeared in the discography.
--    release-door-asymmetry.test.ts pins the asymmetry on purpose — the LIST fails
--    closed on a missing row, the PAGE serves the snapshot until a real tombstone — and
--    it went red. Inner join restored; the snapshot-first gate stays.

create or replace function public.get_public_releases(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug)
  select coalesce(
    jsonb_agg((pr.data - 'on_site') order by (pr.data ->> 'release_date') desc nulls last, pr.published_at desc)
      filter (where coalesce((pr.data ->> 'on_site')::boolean, r.on_site, true)
                and public.music_release_is_released(pr.data)),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release') pr
  join public.releases r on r.id = (pr.data ->> 'id')::uuid
$$;

create or replace function public.get_release(p_artist_slug text, p_release_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_artist_slug),
  rel as (
    select pr.data
    from public.published_revisions((select id from a), 'release') pr
    left join public.releases r on r.id = (pr.data ->> 'id')::uuid
    where pr.data ->> 'slug' = p_release_slug
      and public.music_release_is_released(pr.data)
      and coalesce((pr.data ->> 'on_site')::boolean, r.on_site, true)
    limit 1
  )
  select (rel.data - 'on_site') || jsonb_build_object(
    'tracks',
    coalesce((
      select jsonb_agg(
               (t.data - 'audio_path' - 'on_site')
               || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
               order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
      from public.published_revisions((select id from a), 'track') t
      where t.data ->> 'release_id' = rel.data ->> 'id'
    ), '[]'::jsonb)
  )
  from rel
$$;

-- get_public_site, re-created whole from 20260910140000 with the tracks branch stripping
-- on_site from what it emits.
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
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and coalesce(td.on_site, true)), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and coalesce(m.on_site, true)), '[]'::jsonb),
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
