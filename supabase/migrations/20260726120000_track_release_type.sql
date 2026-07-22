-- Song TYPE becomes a per-song tag (Sam, 2026-07-22).
--
-- A song already carries `released` (public / unreleased) and `on_site` (shows on the
-- site) as its own booleans. Its TYPE — single / EP / album / remix / featured — is the
-- same kind of fact and belongs on the song too, not on a `releases` row. A SoundCloud
-- add creates no release row, so a remix could never be tagged while type lived there;
-- now the manager tags it directly on the song.
--
-- Grouping is unchanged: songs still form a PROJECT by shared album name. The project's
-- section (Singles / EPs / Albums / Remixes) is simply its songs' type — they agree
-- within an album. Spotify stamps this from its album classification on sync; manual and
-- SoundCloud adds set it from the manager's pick. Keep the vocabulary in sync with
-- RELEASE_TYPES in src/lib/releases.ts.

alter table public.tracks
  add column if not exists release_type text not null default 'single';

alter table public.tracks
  drop constraint if exists tracks_release_type_check;
alter table public.tracks
  add constraint tracks_release_type_check
  check (release_type in ('album', 'single', 'ep', 'featured', 'remix'));

-- Backfill from the release the song matches BY ALBUM NAME (release_id is unpopulated in
-- practice, so title is the join). A song on no known release keeps the 'single' default.
-- Only fills rows still at the default, so re-running never clobbers a manual re-tag.
update public.tracks t
set release_type = r.release_type
from public.releases r
where r.artist_id = t.artist_id
  and r.title = t.album_name
  and t.album_name is not null
  and t.release_type = 'single';

-- Releases keep their own type (Spotify sync writes it, other surfaces still read it);
-- widen its CHECK to allow 'remix' too, so the two vocabularies match.
alter table public.releases
  drop constraint if exists releases_release_type_check;
alter table public.releases
  add constraint releases_release_type_check
  check (release_type in ('album', 'single', 'ep', 'featured', 'remix'));
