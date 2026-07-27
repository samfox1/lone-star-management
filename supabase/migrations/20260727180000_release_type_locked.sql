-- When a manager sets a release's type in the editor, lock it so the Spotify Sync (which
-- re-derives type from album_type + track count, and has no "EP" or "remix") can't revert
-- it. Backfill: any existing 'remix' release is definitely manual (Spotify never returns
-- remix), so lock those; the manager can lock others by re-picking the type.
alter table releases add column if not exists release_type_locked boolean not null default false;
update releases set release_type_locked = true where release_type = 'remix';
