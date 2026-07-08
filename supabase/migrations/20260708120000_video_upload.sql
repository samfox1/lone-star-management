-- Manager-uploaded video files: a self-hosted alternative to YouTube/SoundCloud
-- embeds, living in a new public `videos` bucket. Origin is carried by
-- videos.provider ('uploaded'); embedding rules follow the provider.
--
-- Security: the bucket caps allowed_mime_types to VIDEO types (a public bucket that
-- accepted text/html or image/svg would serve stored XSS on the Supabase origin) and
-- file_size_limit. No anon SELECT policy → anon cannot .list()/enumerate the bucket;
-- public PLAYBACK still works because the public object endpoint bypasses RLS.

-- 1. Bucket (public read by URL, capped types + size, NOT enumerable)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 524288000, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Object policies (path: {artist_id}/videos/<file>). Manager-scoped for the
--    authenticated/list APIs; deliberately NO public/anon select (no enumeration).
drop policy if exists "videos manager read" on storage.objects;
create policy "videos manager read" on storage.objects
  for select using (
    bucket_id = 'videos'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "videos manager insert" on storage.objects;
create policy "videos manager insert" on storage.objects
  for insert with check (
    bucket_id = 'videos'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "videos manager update" on storage.objects;
create policy "videos manager update" on storage.objects
  for update using (
    bucket_id = 'videos'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "videos manager delete" on storage.objects;
create policy "videos manager delete" on storage.objects
  for delete using (
    bucket_id = 'videos'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- 3. videos table: uploaded videos have a storage_path instead of an embed_url.
alter table public.videos add column if not exists storage_path text;
alter table public.videos alter column embed_url drop not null;

alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos add constraint videos_provider_check
  check (provider in ('youtube', 'soundcloud', 'uploaded'));

-- A video is either an embed or an upload — never neither.
alter table public.videos drop constraint if exists videos_embed_or_storage;
alter table public.videos add constraint videos_embed_or_storage
  check (embed_url is not null or storage_path is not null);

-- 4. Close the media bucket's enumeration hole: its blanket anon SELECT policy let
--    anyone .list() every artist's draft hero videos / profile photos. Scope SELECT to
--    managers; public PLAYBACK is unaffected (it uses /object/public, which bypasses RLS).
drop policy if exists "media public read" on storage.objects;
drop policy if exists "media manager read" on storage.objects;
create policy "media manager read" on storage.objects
  for select using (
    bucket_id = 'media'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );
