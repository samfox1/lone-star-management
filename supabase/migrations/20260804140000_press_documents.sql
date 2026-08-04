-- Press-kit documents: the stage plot and tech rider that get stapled onto the generated
-- EPK PDF (Sam's brief, 2026-08-04).
--
-- WHY A NEW BUCKET, and why PRIVATE:
--   `media` is PUBLIC — an object there is readable by URL forever, by anyone who has it.
--   That is right for photos a fan is meant to see and wrong for a document the manager
--   chooses who receives. Because the rider is MERGED into the EPK at download time
--   (decision 4), the only reader that ever needs it is our own server, so nothing is
--   lost by making it private. `audio` set this precedent: private bucket, manager-only
--   policies, no anon read.
--   The bucket also caps allowed_mime_types to application/pdf. A store that accepted
--   text/html or image/svg+xml would serve stored XSS from the Supabase origin.
--
-- Path convention `{artist_id}/documents/<uuid>.pdf` — same shape every other bucket
-- uses, so `storage.foldername(name)[1]` is the tenant and the policies below are the
-- same manager-scoped rule as videos/media.

-- 1. Bucket: private, PDF only, 10 MB (a rider is a few pages; it rides an EPK download).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Object policies. Manager-scoped on all four verbs; deliberately NO anon select, so
--    the bucket is neither readable nor enumerable by a fan. Reads for the PDF build go
--    through the service role, which bypasses RLS.
drop policy if exists "documents manager read" on storage.objects;
create policy "documents manager read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "documents manager insert" on storage.objects;
create policy "documents manager insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "documents manager update" on storage.objects;
create policy "documents manager update" on storage.objects
  for update using (
    bucket_id = 'documents'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "documents manager delete" on storage.objects;
create policy "documents manager delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- 3. Where the two documents hang. Columns on `artists` rather than `media` rows: a media
--    row means "an object in the PUBLIC media bucket" everywhere else in this system
--    (get_public_site serves them as {purpose, path}), and quietly making that mean two
--    different buckets is how a private document ends up served publicly one refactor
--    later. Single-occupancy, so a column says exactly what it is.
--
--    They join ARTIST_SNAPSHOT, so they publish with the profile: the generated PDF is
--    entirely published content, never a mix of published copy and a draft rider. The
--    PATH reaching the public payload is not access — the bucket is private.
alter table artists add column if not exists tech_rider_path text;
alter table artists add column if not exists stage_plot_path text;
