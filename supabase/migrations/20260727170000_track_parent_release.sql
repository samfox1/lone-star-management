-- A track's optional "also appears on" project. `release_id` stays the track's own home
-- (e.g. its single); `parent_release_id` links it into a bigger EP/album so it shows in that
-- project's tracklist too — the way a lead single lives standalone AND on the album. Nullable;
-- ON DELETE SET NULL so removing the album doesn't delete the single's track.
alter table tracks add column if not exists parent_release_id uuid references releases(id) on delete set null;
