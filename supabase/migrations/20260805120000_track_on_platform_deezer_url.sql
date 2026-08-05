-- DRIFT FIX: music_track_on_platform did not count `deezer_url`.
--
-- `tracks.deezer_url` (the manager-entered Deezer link, added 20260727150000) counts as
-- platform presence in src/lib/music.ts — but this SQL mirror, last rewritten
-- 20260710130000, predates the column and never gained the check. So the same song was
-- Released in the app and Unreleased in Postgres.
--
-- Nothing broke only by luck: 20260710170000 removed this function's last door caller
-- (get_public_site and audio_path_for_play now gate on `tracks.on_site` instead), so the
-- disagreement had no way to reach a user. It is still a loaded gun — the next door that
-- reuses it would silently hide a Deezer-linked song. Closing it now.
--
-- The rule, in one line, and the same in all three copies:
--   platform source OR any external id/url OR the manual `released` flag.
-- tests/music-mirror.test.ts feeds identical fixtures through this function,
-- src/lib/music.ts, and lone-star-agent's copy, and fails if any two disagree.
--
-- `create or replace` keeps the existing ACL (20260709120000 revoked execute from
-- public/anon/authenticated — this is an internal helper, not a door); the revoke is
-- repeated below so the grant state is readable here rather than three files back.

create or replace function public.music_track_on_platform(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or d ->> 'apple_id' is not null
      or d ->> 'deezer_id' is not null
      or d ->> 'provider_url' is not null
      or d ->> 'stream_url' is not null
      or d ->> 'apple_url' is not null
      or d ->> 'soundcloud_url' is not null
      or d ->> 'deezer_url' is not null
      or coalesce((d ->> 'released')::boolean, false)
$$;

revoke all on function public.music_track_on_platform(jsonb) from public, anon, authenticated;
