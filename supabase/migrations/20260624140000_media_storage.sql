-- Per-artist media in Supabase Storage, organized by use.
--
-- Bucket layout (public read; the public site loads these):
--   media/{artist_id}/hero-videos/<file>   -- display/hero montage clips
--   media/{artist_id}/profile/<file>       -- profile photos (≠ display videos)
--   media/{artist_id}/gallery/<file>       -- (future) gallery images
--
-- The `media` table tracks each asset's purpose so the app knows how to use it.
-- Writes (upload/update/delete) are restricted to the artist's manager via the
-- first path segment (artist_id); reads are public.

-- 1. Bucket
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- 2. Storage object policies (path: {artist_id}/{use}/<file>)
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media manager insert" on storage.objects;
create policy "media manager insert" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "media manager update" on storage.objects;
create policy "media manager update" on storage.objects
  for update using (
    bucket_id = 'media'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "media manager delete" on storage.objects;
create policy "media manager delete" on storage.objects
  for delete using (
    bucket_id = 'media'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- 3. Media registry table
create table public.media (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  purpose      text not null check (purpose in ('hero_video', 'profile_photo', 'gallery_image')),
  storage_path text not null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index media_artist_idx on public.media (artist_id, purpose, sort_order);

alter table public.media enable row level security;
create policy media_rw on public.media
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- 4. Expose media on the public read path (live, like the artist profile).
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug, name, bio, hero_image_url, template, spotify_artist_id
    from public.artists
    where slug = p_slug
  ),
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at
    from public.revisions r
    join a on a.id = r.artist_id
    order by r.entity_type, r.entity_id, r.published_at desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
  ),
  m as (
    select purpose, storage_path, sort_order
    from public.media
    join a on a.id = public.media.artist_id
  )
  select case
    when not exists (select 1 from a) then null
    else jsonb_build_object(
      'artist',     (select to_jsonb(a) from a),
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
        select jsonb_agg(jsonb_build_object('purpose', purpose, 'path', storage_path) order by sort_order)
        from m), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
