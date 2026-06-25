-- Don't leak the raw private-bucket audio_path into the public payload (ADR-0001:
-- the public snapshot is an explicit allowlist, never a whole-row blob). The
-- player only needs to know a track HAS gated audio (it plays by slug+track_id via
-- the signing route), so strip audio_path and emit a `has_audio` boolean instead.
-- Rest of get_public_site is unchanged from 20260624180000.
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
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at, r.id
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type in ('track', 'tour_date', 'merch', 'link', 'media', 'site_content')
    order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
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
                 (data - 'audio_path')
                 || jsonb_build_object('has_audio', (data ->> 'audio_path') is not null)
                 order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'track'), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(data order by (data ->> 'date'), published_at)
        from live where entity_type = 'tour_date'), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(data order by (data ->> 'created_at'), published_at)
        from live where entity_type = 'merch'), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
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

-- Defense in depth: enforce the audio format + size at the bucket, not only in
-- the client (the write path is direct browser → Storage, so client checks are
-- bypassable). 30 MB; mp3 (audio/mpeg) + m4a (audio/mp4).
update storage.buckets
set file_size_limit = 31457280,
    allowed_mime_types = array['audio/mpeg', 'audio/mp4']
where id = 'audio';
