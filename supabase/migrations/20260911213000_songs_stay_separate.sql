-- A song that is a single AND an album track is TWO songs, one per release (Sam,
-- 2026-09-11: "some songs are released as singles in the music world and then are also a
-- part of an album. I think it would be best to keep these separate, even though they
-- are the same song").
--
-- The Spotify pull used to collapse a title that appeared on several releases into one
-- row and the dashboard offered an "also appears on" link (parent_release_id,
-- 20260727170000) to file that one row under the album too. The pull now keeps one row
-- per release (keyed by Spotify's per-release track id), the dashboard no longer reads
-- or writes the link, and this clears the three rows that carried one so a release's
-- tracklist lists only the songs whose home it is. The column stays for now (the row
-- types still name it); nothing writes it.
update public.tracks set parent_release_id = null where parent_release_id is not null;

comment on column public.tracks.parent_release_id is
  'Legacy (2026-09-11): no longer read or written. A song on several releases is one row per release.';
