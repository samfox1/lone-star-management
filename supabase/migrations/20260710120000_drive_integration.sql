-- Google Drive integration (public-folder-link model). The manager pastes a
-- link-shared folder's URL; the dashboard browses it via the Drive API (one
-- global server API key, no OAuth) and IMPORTS selected files by copying the
-- bytes into our own buckets — imported rows then behave exactly like uploads.
--
-- artists.drive_folder_id — the connected folder (stored as the bare Drive id).
-- drive_file_id on tracks/videos/media — which Drive file a row was imported
-- from. Partial unique per artist = clean dedupe (re-import → 23505 → friendly
-- "already imported") and lets the browser badge files as Imported. The publish
-- snapshot allowlists (content.ts PUBLISHABLE) never include it, so it stays off
-- the public site.
alter table public.artists add column if not exists drive_folder_id text;

alter table public.tracks add column if not exists drive_file_id text;
alter table public.videos add column if not exists drive_file_id text;
alter table public.media  add column if not exists drive_file_id text;

create unique index if not exists tracks_drive_file_uniq
  on public.tracks (artist_id, drive_file_id) where drive_file_id is not null;
create unique index if not exists videos_drive_file_uniq
  on public.videos (artist_id, drive_file_id) where drive_file_id is not null;
create unique index if not exists media_drive_file_uniq
  on public.media (artist_id, drive_file_id) where drive_file_id is not null;
