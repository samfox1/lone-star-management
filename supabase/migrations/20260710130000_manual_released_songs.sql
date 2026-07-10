-- Manual songs can be RELEASED (Sam, 2026-07-09): the add-song flow gains a
-- required released/unreleased toggle, so an artist can add a song by hand —
-- cover + audio + details — and still mark it released (public). Attaching any
-- streaming link stays automatically-released via derivation; this flag covers
-- the no-link case, so classification becomes: platform presence OR the flag.
--
-- soundcloud_url joins the union model's per-platform links (SoundCloud has no
-- id column to rebuild from, so the URL is stored — same reasoning as apple_url).
alter table public.tracks add column if not exists released boolean not null default false;
alter table public.tracks add column if not exists soundcloud_url text;

-- The SQL mirror of lib/music.ts (see 20260709120000): a loose track is exposed
-- iff it carries platform linkage OR the manual released flag. Missing keys on
-- old snapshots stay Released via the coalesced source check, unchanged.
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
      or d ->> 'soundcloud_url' is not null
      or coalesce((d ->> 'released')::boolean, false)
$$;
