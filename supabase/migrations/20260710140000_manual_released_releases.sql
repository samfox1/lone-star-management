-- Manual RELEASES can be released too (the add-music flow creates a manual
-- album/EP with its songs): same reasoning as tracks.released (20260710130000)
-- — a hand-added album with no DSP links can still be public, and its songs
-- inherit the release's bucket, so the flag must live on the release.
alter table public.releases add column if not exists released boolean not null default false;

-- SQL mirror of lib/music.ts releaseBucket.
create or replace function public.music_release_is_released(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or (jsonb_typeof(d -> 'links') = 'array' and jsonb_array_length(d -> 'links') > 0)
      or coalesce((d ->> 'released')::boolean, false)
$$;
