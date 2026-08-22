-- LIVE PERFORMANCE becomes a song type (Sam, 2026-08-21: "I want music to have another
-- possible field, 'live performance'. This is for recordings of artists live performance"
-- — "its own section in the music assets but embeded in the sites just like the other
-- music is").
--
-- A TYPE, not a new column, because that is exactly what the sentence describes: the
-- Music page's sections ARE the type vocabulary (RELEASE_TYPES drives them), so a live
-- recording gets its own section for free, and it reaches a connected site through the
-- same `release_type` field on the wire that every other type already uses. A boolean
-- column would have needed its own section rule, its own editor control, and its own
-- wire field to say the same thing.
--
-- Both tables widen together: `tracks.release_type` is the per-song tag the manager sets
-- and `releases.release_type` is what a synced/created release carries. They were kept in
-- lockstep by 20260726120000 and must stay that way, or a live release can hold songs its
-- own table would reject. Keep the vocabulary in sync with RELEASE_TYPES in
-- src/lib/releases.ts.

alter table public.tracks
  drop constraint if exists tracks_release_type_check;
alter table public.tracks
  add constraint tracks_release_type_check
  check (release_type in ('album', 'single', 'ep', 'featured', 'remix', 'live'));

alter table public.releases
  drop constraint if exists releases_release_type_check;
alter table public.releases
  add constraint releases_release_type_check
  check (release_type in ('album', 'single', 'ep', 'featured', 'remix', 'live'));
