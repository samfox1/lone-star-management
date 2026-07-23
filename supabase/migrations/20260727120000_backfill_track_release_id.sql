-- Populate the PARENT link between a song and its project (Sam, 2026-07-23).
--
-- A song belongs to an album/EP by `tracks.release_id` — a stable FK, not the album name
-- (rename-unsafe, title-collision-prone) or cover art (skeen's old heuristic). The column
-- has always existed; the Spotify catalog sync just never populated it for these rows, so
-- grouping fell back to matching names. This backfills the link from that same name match,
-- one time, so grouping keys on the parent from here on.
--
-- Deterministic and safe to re-run: only fills rows still NULL, and only where the album
-- name matches EXACTLY ONE release title for that artist (a duplicate title would be
-- ambiguous, so those are left NULL and stay standalone until linked by hand). A song
-- with no matching release keeps release_id NULL — it is a standalone single, its own
-- one-song project. Going forward the release sync and the manual add both set release_id.

update public.tracks t
set release_id = r.id
from public.releases r
where t.artist_id = r.artist_id
  and t.album_name = r.title
  and t.release_id is null
  -- Only when that title is UNIQUE for the artist: a title shared by two releases is
  -- ambiguous, so those songs stay standalone until linked by hand.
  and not exists (
    select 1 from public.releases r2
    where r2.artist_id = r.artist_id and r2.title = r.title and r2.id <> r.id
  );
