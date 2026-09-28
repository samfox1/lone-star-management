-- A SoundCloud link never makes a RELEASE Released either (Sam, 2026-09-28).
--
-- "Soundcloud songs can be released and unreleased. … A soundcloud song can be released
-- or unreleased, depends on the song." The SONG rule dropped SoundCloud on 2026-09-10
-- (20260910120000), but music_release_is_released still counted ANY link, so a record
-- whose only link was SoundCloud's read Released — in the dashboard and at the public
-- release doors (get_release / get_public_releases / the audio door's inherited bucket).
--
-- Both rules now read ONE definition of platform presence, the SQL half of
-- packages/music-rules `urlIsPresence` / `releaseLinkIsPresence`:
--
--   music_url_is_presence(v)          a stored link counts iff there is one and it is not
--                                     SoundCloud's (host soundcloud.com / snd.sc, or a
--                                     subdomain). The regex is the TypeScript one, verbatim.
--   music_release_link_is_presence(l) one `releases.links` entry ({label, url}): not in the
--                                     SoundCloud slot, and its url is presence.
--
-- music_track_on_platform also routes its four link columns through music_url_is_presence,
-- so a SoundCloud URL pasted into the Spotify row (before that row checked its platform)
-- does not release a song either. Ids are ids, never SoundCloud's, and stay as they were.
--
-- NO BACKFILL. Checked against the live project before writing this (2026-09-28): 8
-- releases, all Spotify-sourced with a spotify_id; none carries a SoundCloud link, in the
-- working rows or the published snapshots, and no song holds a SoundCloud URL outside
-- soundcloud_url. Nothing on screen or on a site changes classification.
--
-- tests/integration/music/music-mirror.test.ts feeds identical fixtures through these
-- functions and packages/music-rules and fails the moment they disagree.
--
-- `create or replace` keeps an existing function's ACL; the grants are repeated anyway so
-- the state is readable here. All four are internal helpers for the SECURITY DEFINER doors
-- (which run as the owner): service-only, per AGENTS.md.

create or replace function public.music_url_is_presence(v jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(jsonb_typeof(v), 'null') <> 'null'
     and not (jsonb_typeof(v) = 'string'
              and (v #>> '{}') ~* '^\s*(?:[a-z][a-z0-9+.-]*:)?(?://)?(?:[^/?#@\s]*@)?(?:[^/?#@:\s]*\.)?(?:soundcloud\.com|snd\.sc)(?::[0-9]*)?(?:[/?#]|\s*$)')
$$;

create or replace function public.music_release_link_is_presence(l jsonb)
returns boolean
language sql
immutable
as $$
  select not coalesce(jsonb_typeof(l -> 'label') = 'string'
                      and (l ->> 'label') ~* '^\s*soundcloud\s*$', false)
     and public.music_url_is_presence(l -> 'url')
$$;

create or replace function public.music_release_is_released(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or case when jsonb_typeof(d -> 'links') = 'array'
              then exists (select 1
                             from jsonb_array_elements(d -> 'links') as l(v)
                            where public.music_release_link_is_presence(l.v))
              else false
         end
      or coalesce((d ->> 'released')::boolean, false)
$$;

create or replace function public.music_track_on_platform(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or d ->> 'apple_id' is not null
      or d ->> 'deezer_id' is not null
      or public.music_url_is_presence(d -> 'provider_url')
      or public.music_url_is_presence(d -> 'stream_url')
      or public.music_url_is_presence(d -> 'apple_url')
      or public.music_url_is_presence(d -> 'deezer_url')
      or coalesce((d ->> 'released')::boolean, false)
$$;

revoke all on function public.music_url_is_presence(jsonb) from public, anon, authenticated;
revoke all on function public.music_release_link_is_presence(jsonb) from public, anon, authenticated;
revoke all on function public.music_release_is_released(jsonb) from public, anon, authenticated;
revoke all on function public.music_track_on_platform(jsonb) from public, anon, authenticated;
grant execute on function public.music_url_is_presence(jsonb) to service_role;
grant execute on function public.music_release_link_is_presence(jsonb) to service_role;
grant execute on function public.music_release_is_released(jsonb) to service_role;
grant execute on function public.music_track_on_platform(jsonb) to service_role;
