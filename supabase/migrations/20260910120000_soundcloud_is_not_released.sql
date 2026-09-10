-- A SoundCloud link no longer means "released" (Sam, 2026-09-10).
--
-- "the point of the release tag is some tracks are considered 'unreleased'. These are
-- ones that often aren't on any services. This shouldnt be dependent on where it comes
-- from. We should assume, when adding a song, that it is released. There can be a
-- toggle that says 'unreleased'. this should only be available on soundcloud and when
-- a song is manually added."
--
-- Two things follow, and both live here because this function is the SQL half of ONE
-- rule (tests/music-mirror.test.ts feeds identical rows through it and through
-- packages/music-rules and fails if they disagree):
--
--   1. `soundcloud_url` leaves the platform list. SoundCloud is where unreleased demos
--      and live sets live, so its presence proves nothing about release. A SoundCloud-only
--      song is Released iff its `released` flag says so. Spotify, Apple and Deezer stay:
--      a song on those IS released, whatever the flag says, and no toggle is offered.
--   2. `released` DEFAULTS TO TRUE. The Add flow used to force a released/unreleased
--      choice; now it assumes released and offers an "Unreleased" toggle only where it
--      can apply. A row written without the column should read as the assumption, not
--      as the exception.
--
-- BACKFILL, scoped to what would otherwise change on screen: every SoundCloud-only song
-- is Released TODAY by derivation. Dropping the check would flip any such row that
-- carries released=false to Unreleased on the spot — a change nobody asked for on data
-- they already see. Those rows are set released=true so the library looks exactly as it
-- did; the toggle is there for the ones that should not be.
--
-- `create or replace` keeps the ACL; the revoke is repeated so the grant state is
-- readable here.

alter table public.tracks alter column released set default true;

update public.tracks
   set released = true
 where soundcloud_url is not null
   and released = false
   and spotify_id is null and apple_id is null and deezer_id is null
   and provider_url is null and stream_url is null and apple_url is null and deezer_url is null
   and coalesce(source, 'manual') = 'manual';

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
      or d ->> 'deezer_url' is not null
      or coalesce((d ->> 'released')::boolean, false)
$$;

revoke all on function public.music_track_on_platform(jsonb) from public, anon, authenticated;
