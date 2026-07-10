-- SITE-EDITOR phase 0.5: DECOUPLE Released from site visibility for TRACKS.
--
-- Released/Unreleased is now a LIBRARY-ONLY organizing label (the dashboard Music
-- tab still uses it) with NO effect on the public site. A track is on the public
-- site iff its own `tracks.visible` flag is true — exactly like merch/videos/tour.
-- This wakes the dormant `tracks.visible` column (added 20260708150000) and drops
-- the Released-derivation gating from get_public_site's tracks branch and from
-- audio_path_for_play. `music_track_on_platform` / `music_release_is_released`
-- stay (they still power lib/music.ts's library buckets and the RELEASE doors
-- get_release / get_public_releases, which are a separate surface and unchanged).
--
-- CUTOVER BACKFILL: `tracks.visible` defaults true, so without a backfill every
-- Unreleased demo would suddenly appear. Set visible = the track's CURRENT public
-- status under the old door logic (Released-derived, widen-only, AND its release
-- visible if it has one) so nothing appears/disappears at the switch. Managers
-- then curate per-track from the visual editor.

update public.tracks t
set visible = (
  (
    -- own platform presence OR the manual released flag ...
    coalesce(t.source, '') <> 'manual'
    or t.spotify_id is not null
    or t.apple_id is not null
    or t.deezer_id is not null
    or t.provider_url is not null
    or t.stream_url is not null
    or t.apple_url is not null
    or t.soundcloud_url is not null
    or t.released = true
    -- ... OR widen-only: it sits inside a Released release
    or exists (
      select 1 from public.releases r
      where r.id = t.release_id
        and (
          coalesce(r.source, '') <> 'manual'
          or r.spotify_id is not null
          or (jsonb_typeof(r.links) = 'array' and jsonb_array_length(r.links) > 0)
          or r.released = true
        )
    )
  )
  -- ... AND, if it belongs to a release, that release is currently on-site.
  and coalesce((select r2.visible from public.releases r2 where r2.id = t.release_id), true)
);

-- get_public_site: the tracks branch now gates on the live `tracks.visible` flag
-- (join the working row by id), mirroring the merch/videos/tour branches. The
-- Released-derivation lateral and the release-visible join are gone from tracks.
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
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(
                 (t.data - 'audio_path')
                 || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
                 order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
        from live t
        left join public.tracks trk on trk.id = (t.data ->> 'id')::uuid
        where t.entity_type = 'track'
          and coalesce(trk.visible, true)), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and coalesce(td.visible, true)), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and coalesce(m.visible, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.visible, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live where entity_type = 'media'), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb)
    )
  end;
$$;

-- audio_path_for_play: serve the published audio path iff the track is on-site
-- (its live `visible` is true). Released status no longer matters.
create or replace function public.audio_path_for_play(p_slug text, p_track_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug),
  t as (
    select data
    from public.published_revisions((select id from a), 'track')
    where entity_id = p_track_id
    limit 1
  )
  select t.data ->> 'audio_path'
  from t
  left join public.tracks trk on trk.id = p_track_id
  where coalesce(trk.visible, true)
$$;

revoke all on function public.audio_path_for_play(text, uuid) from public;
grant execute on function public.audio_path_for_play(text, uuid) to anon, authenticated;
