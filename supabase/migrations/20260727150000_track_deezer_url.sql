-- A manager-entered Deezer link for a track, mirroring apple_url / soundcloud_url. The
-- synced deezer_id stays for platform detection; this stored URL is what the editor's
-- per-song Deezer slot reads and writes, so a song can carry all four streaming links.
alter table tracks add column if not exists deezer_url text;
