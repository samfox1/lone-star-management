-- Custom fonts: uploaded font files an artist's site is typeset in (Sam's brief,
-- 2026-08-05). UPLOADED FILES, not Google Fonts — a foundry font is what makes a music
-- site look like that artist rather than like a template, and half of them are on no CDN.
--
-- WHY A NEW BUCKET, and why PUBLIC:
--   `documents` is private because our own server is the only reader. A font is the
--   opposite: the FAN'S BROWSER fetches the file itself, from a stylesheet, with no
--   server in the middle to sign a URL. So it has to be public-read, which is exactly
--   why its allowed_mime_types is the tightest in this project.
--   It is NOT the `media` bucket: media's caps are image/video, and widening them would
--   mean the photo uploaders' bucket accepts fonts and the 2 MB font cap could not exist
--   (media's limit is sized for multi-megapixel originals).
--
-- WHY NOT `image/svg+xml`: an SVG font is a dead format and a live script-execution
-- vector. On a PUBLIC bucket, one served from the Supabase origin is stored XSS on that
-- origin. WHY NOT `application/octet-stream`: it is what Windows reports for a .ttf, so
-- it is tempting — and it would admit literally any file, which is the whole guard gone.
-- The app never sends it: the uploader sets the content type explicitly from
-- `contentTypeFor(ext)` (lib/upload.ts), which emits only the four types below.
--
-- The four mime strings are the RFC 8081 `font/*` registrations, which is what browsers
-- and `file(1)` report on macOS (.ttf -> font/ttf) and what modern Linux mime databases
-- carry. The formats that browsers report INCONSISTENTLY — .woff2 (macOS sends nothing,
-- no registered UTI) and .ttf/.otf on Windows (application/octet-stream, no registry
-- entry) — are matched client-side by EXTENSION instead; see FONT_UPLOAD_RULES.

-- 1. Bucket: public read by URL, four font types, 2 MB.
--    2 MB because this file blocks first paint of the artist's own name: a subsetted
--    woff2 is 20-80 KB, and a full-coverage TTF is not something to send a fan on mobile.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fonts', 'fonts', true, 2097152, array['font/woff2', 'font/woff', 'font/ttf', 'font/otf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Object policies (path: {artist_id}/fonts/<uuid>.<ext>), manager-scoped on the
--    tenant prefix like every other bucket. Deliberately NO anon SELECT: the public
--    object endpoint bypasses RLS, so fans still fetch the file, but nobody can .list()
--    the bucket and enumerate which artists have which foundry's font sitting in draft.
drop policy if exists "fonts manager read" on storage.objects;
create policy "fonts manager read" on storage.objects
  for select using (
    bucket_id = 'fonts'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "fonts manager insert" on storage.objects;
create policy "fonts manager insert" on storage.objects
  for insert with check (
    bucket_id = 'fonts'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "fonts manager update" on storage.objects;
create policy "fonts manager update" on storage.objects
  for update using (
    bucket_id = 'fonts'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "fonts manager delete" on storage.objects;
create policy "fonts manager delete" on storage.objects
  for delete using (
    bucket_id = 'fonts'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- 3. The registry. A TABLE, not columns on `artists`: an artist has MANY fonts (every
--    one of them selectable per-region in the editor), of which at most two hold a
--    site-wide role. Columns would model the roles and lose the rest.
--
--    `label` is what the manager typed and is display-only. `family` is the CSS token
--    derived from it (lib/fonts.ts `sanitizeFamily`) and is what lands in the stylesheet
--    and in the `.font-<family>` utility class. They are separate columns because they
--    are separate things: the label can be anything a person types, the family is a
--    strict [a-z0-9-] allowlist because it is interpolated into CSS served to fans.
create table public.artist_fonts (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  label        text not null,
  family       text not null,
  storage_path text not null,
  format       text not null check (format in ('woff2', 'woff', 'ttf', 'otf')),
  -- Nullable: most fonts hold no site-wide role. They are still uploaded, still emitted,
  -- and still selectable per-region — the role is a shortcut, not a gate.
  role         text check (role in ('primary', 'secondary')),
  created_at   timestamptz not null default now()
);

create index artist_fonts_artist_idx on public.artist_fonts (artist_id, created_at);

-- One primary and one secondary PER ARTIST. A partial index rather than a check or an
-- application-level rule: the roles are read straight into the templates, and two rows
-- claiming 'primary' makes which font the site uses depend on row order.
create unique index artist_fonts_one_role_per_artist
  on public.artist_fonts (artist_id, role)
  where role is not null;

-- One row per CSS token. Two fonts sharing a family emit two @font-face blocks for one
-- name, and which file a region gets is then decided by cascade order — a coin flip that
-- looks like a caching bug. lib/fonts.ts `uniqueFamily` suffixes before it ever gets
-- here; this is the guard for writers that skip it.
create unique index artist_fonts_family_unique on public.artist_fonts (artist_id, family);

alter table public.artist_fonts enable row level security;

-- Standard tenant isolation, same shape as site_styles/media. The font FILE is public
-- once uploaded (the bucket has to be); the ROW — label, role, which artist has it — is
-- owner-only, and stays owner-only until it is published.
create policy artist_fonts_rw on public.artist_fonts
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- 4. Allow 'artist_font' as a revision entity type, so fonts ride the PUBLISH window like
--    site_styles: a font uploaded on Tuesday must not change the live site until the
--    manager publishes. The publish wiring itself (lib/content.ts PUBLISHABLE entry +
--    the `fonts` key in get_public_site) is the next slice; the constraint has to widen
--    first, because a revision insert with a type it does not know simply fails.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media',
                         'site_content', 'video', 'release', 'site_styles', 'artist_font'));
