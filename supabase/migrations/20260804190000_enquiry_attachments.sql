-- Demo links and audio attachments on enquiries (Block B).
--
-- Extends the contact stack from 20260722120000 / 20260722130000. Nothing here rebuilds
-- it: the enquiry row, the recipient resolution and the rate limiter are untouched.

-- 1. The demo link.
--
-- https ONLY, enforced here as well as in validate.ts. The TS check is what produces a
-- useful 400 for the visitor; this is what makes the rule true regardless of who writes
-- the row — a future admin tool, a backfill, or a bug in the function. It is
-- attacker-controlled text that a MANAGER clicks in their own dashboard, so it earns two
-- guards rather than one.
alter table public.enquiries add column if not exists demo_url text;

alter table public.enquiries drop constraint if exists enquiries_demo_url_https;
alter table public.enquiries add constraint enquiries_demo_url_https
  check (demo_url is null or (demo_url ~ '^https://' and length(demo_url) <= 2048));

-- 2. The attachments table.
--
-- `artist_id` is DENORMALISED from the parent enquiry on purpose: the storage policy and
-- the retention sweep both need the tenant, and neither should have to join to get it.
-- The join would also have to be RLS-visible to work inside a policy, which is exactly
-- the kind of circularity that turns a simple policy into a puzzle.
create table if not exists public.enquiry_attachments (
  id           uuid primary key default gen_random_uuid(),
  enquiry_id   uuid not null references public.enquiries (id) on delete cascade,
  artist_id    uuid not null references public.artists (id)   on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime_type    text not null,
  bytes        bigint not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists enquiry_attachments_enquiry_idx on public.enquiry_attachments (enquiry_id);
-- The retention sweep scans by age across all tenants; this keeps it from being a seq scan.
create index if not exists enquiry_attachments_created_idx on public.enquiry_attachments (created_at);

alter table public.enquiry_attachments enable row level security;

-- READ ONLY, for managers of that artist. There is deliberately NO insert, update or
-- delete policy for `authenticated` or `anon`: the Edge Function writes these rows with
-- the service role, which bypasses RLS, and it is the only writer. A missing policy is a
-- denial, so this is a closed door rather than an omission.
drop policy if exists "enquiry_attachments owner read" on public.enquiry_attachments;
create policy "enquiry_attachments owner read" on public.enquiry_attachments
  for select using (public.is_admin() or public.is_manager_of(artist_id));

comment on table public.enquiry_attachments is
  'Audio files attached to a demo enquiry. Objects live in the private enquiry-attachments bucket and are deleted after 90 days; the parent enquiry is kept. Written only by the /contact Edge Function (service role).';

-- 3. The private bucket.
--
-- public = false, so there is no URL that serves these to anyone. The dashboard reaches
-- them through short-lived signed URLs minted per view, and the contact function writes
-- through short-lived signed UPLOAD urls. Neither anon nor authenticated is ever granted
-- a blanket write.
--
-- allowed_mime_types is capped to audio. A private bucket that accepted text/html would
-- still be a stored-XSS risk the moment anything ever signs a URL to it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'enquiry-attachments', 'enquiry-attachments', false, 26214400,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/flac']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 4. Object policies, same shape as the `audio` bucket (20260625130000): the FIRST path
--    segment is the artist id, checked with is_manager_of().
--
--    Path: <artist_id>/<enquiry_id>/<uuid>-<sanitised filename>
--
--    READ is for the manager (and the retention sweep, which runs as service role).
--    There is no insert policy for authenticated: a visitor is anonymous, and their
--    upload is authorised by a server-minted signed token instead — a capability scoped
--    to one path, not a role granted to a stranger.
drop policy if exists "enquiry attachments manager read" on storage.objects;
create policy "enquiry attachments manager read" on storage.objects
  for select using (
    bucket_id = 'enquiry-attachments'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "enquiry attachments manager delete" on storage.objects;
create policy "enquiry attachments manager delete" on storage.objects
  for delete using (
    bucket_id = 'enquiry-attachments'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );
