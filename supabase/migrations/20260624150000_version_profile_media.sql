-- Phase 0: version the artist profile + media (draft → publish).
--
-- The fan-visible profile (name/bio/hero/template/spotify_artist_id) and media
-- now publish like content: get_public_site reads the PUBLISHED snapshot
-- (latest entity_type='artist' revision + entity_type='media' revisions), not
-- the live row. A site is "live" once its profile has been published once.

-- 1. Allow 'media' as a revision entity type.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media'));

-- 2. Backfill: snapshot every existing artist's current live profile + media into
--    revisions, so the cutover renders every currently-live site unchanged.
insert into public.revisions (artist_id, entity_type, entity_id, data)
select id, 'artist', id,
  jsonb_build_object(
    'name', name, 'bio', bio, 'hero_image_url', hero_image_url,
    'template', template, 'spotify_artist_id', spotify_artist_id
  )
from public.artists;

insert into public.revisions (artist_id, entity_type, entity_id, data)
select artist_id, 'media', id,
  jsonb_build_object('purpose', purpose, 'storage_path', storage_path, 'sort_order', sort_order)
from public.media;

-- 3. Rewrite get_public_site: profile + media from published revisions.
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
    -- latest published profile snapshot for this artist
    select r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'artist'
    order by r.published_at desc
    limit 1
  ),
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type in ('track', 'tour_date', 'merch', 'link', 'media')
    order by r.entity_type, r.entity_id, r.published_at desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null  -- profile never published → not live
    else jsonb_build_object(
      'artist', jsonb_build_object(
        'id',                (select id from a),
        'slug',              (select slug from a),
        'name',              (select data ->> 'name' from ap),
        'bio',               (select data ->> 'bio' from ap),
        'hero_image_url',    (select data ->> 'hero_image_url' from ap),
        'template',          (select data ->> 'template' from ap),
        'spotify_artist_id', (select data ->> 'spotify_artist_id' from ap)
      ),
      'tracks',     coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
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
                         order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'media'), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
