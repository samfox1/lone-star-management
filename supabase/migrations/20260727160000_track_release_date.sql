-- An optional release date for a track, so an orphan single (a released song with no
-- parent release row — e.g. a SoundCloud single) can carry its own year, the way a release
-- single gets one from the release. Nullable: most synced tracks won't have it, and a song
-- inside an album still shows the album's year.
alter table tracks add column if not exists release_date date;
