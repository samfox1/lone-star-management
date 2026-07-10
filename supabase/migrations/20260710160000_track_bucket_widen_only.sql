-- MUSIC RESTRUCTURE follow-up (#4): make release inheritance WIDEN-ONLY.
--
-- The doors classified a track WITH a release_id purely by its release's bucket
-- (coalesce(rel.released, own-provenance)). That narrowed as well as widened: a
-- platform-linked song assigned to an Unreleased album inherited "unreleased" and
-- vanished from the public site. The rule is now "released if the track's OWN
-- provenance says released OR its release is released" — membership only ever
-- promotes a song to Released, never demotes a linked one. This mirrors
-- trackBucket in src/lib/music.ts; change them together.
--
-- The visible gate (20260710150000) is unchanged: a track of a hidden release is
-- still dropped regardless of bucket.

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
        left join lateral (
          select public.music_release_is_released(r.data) as released
          from live r
          where r.entity_type = 'release'
            and r.data ->> 'id' = t.data ->> 'release_id'
          limit 1
        ) rel on true
        left join public.releases rv on rv.id = nullif(t.data ->> 'release_id', '')::uuid
        where t.entity_type = 'track'
          and (public.music_track_on_platform(t.data) or coalesce(rel.released, false))
          and coalesce(rv.visible, true)), '[]'::jsonb),
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
  left join lateral (
    select public.music_release_is_released(r.data) as released
    from public.published_revisions((select id from a), 'release') r
    where r.data ->> 'id' = t.data ->> 'release_id'
    limit 1
  ) rel on true
  left join public.releases rv on rv.id = nullif(t.data ->> 'release_id', '')::uuid
  where (public.music_track_on_platform(t.data) or coalesce(rel.released, false))
    and coalesce(rv.visible, true)
$$;

revoke all on function public.audio_path_for_play(text, uuid) from public;
grant execute on function public.audio_path_for_play(text, uuid) to anon, authenticated;
