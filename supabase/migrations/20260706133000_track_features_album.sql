-- Capture two more Spotify facts per track so the public site can show them:
--   featured_artists — collaborators on the track (primary artist excluded)
--   album_name       — the release title the track belongs to
-- Both are populated by the Spotify sync and copied into the published snapshot
-- (see src/lib/spotify.ts, src/lib/sync.ts, src/lib/content.ts). Nullable/empty
-- by default so existing rows and non-Spotify sources are unaffected.

alter table public.tracks add column if not exists featured_artists text[] not null default '{}';
alter table public.tracks add column if not exists album_name text;
