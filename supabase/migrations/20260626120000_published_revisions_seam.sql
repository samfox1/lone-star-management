-- Deepening (architecture review): give the "published state" rule a single home.
-- Every public door re-derived "latest revision per entity, minus tombstones,
-- tie-broken published_at desc / id desc". published_revisions() owns that rule;
-- the doors become thin projections over it (CONTEXT.md → Published state).
--
-- DEFINER + NOT anon-callable: it returns RAW revision data (incl. fields a door
-- strips, e.g. audio_path), so anon must never reach it directly — only the
-- doors (running as owner) call it. Tests use the service role.
create or replace function public.published_revisions(p_artist_id uuid, p_entity_type text default null)
returns table (entity_type text, entity_id uuid, data jsonb, published_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select entity_type, entity_id, data, published_at
  from (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at
    from public.revisions r
    where r.artist_id = p_artist_id
      and (p_entity_type is null or r.entity_type = p_entity_type)
    order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
  ) latest
  where coalesce(data ->> '_deleted', 'false') <> 'true';
$$;

revoke all on function public.published_revisions(uuid, text) from public, anon, authenticated;
grant execute on function public.published_revisions(uuid, text) to service_role;

-- get_public_site: project over published_revisions. Output shaping (has_audio
-- strip, media {purpose,path}, site_content fold, per-type ordering) unchanged.
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
      'videos',     coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'video'), '[]'::jsonb),
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

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;

-- get_release: one published release for (artist, release) slug.
create or replace function public.get_release(p_artist_slug text, p_release_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_artist_slug)
  select data
  from public.published_revisions((select id from a), 'release')
  where data ->> 'slug' = p_release_slug
  limit 1
$$;

revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;

-- get_public_releases: all published releases for an artist.
create or replace function public.get_public_releases(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug)
  select coalesce(
    jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release')
$$;

revoke all on function public.get_public_releases(text) from public;
grant execute on function public.get_public_releases(text) to anon, authenticated;

-- audio_path_for_play: the published audio path for one track (tombstone/unpub → null).
create or replace function public.audio_path_for_play(p_slug text, p_track_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug)
  select data ->> 'audio_path'
  from public.published_revisions((select id from a), 'track')
  where entity_id = p_track_id
$$;

revoke all on function public.audio_path_for_play(text, uuid) from public;
grant execute on function public.audio_path_for_play(text, uuid) to anon, authenticated;
