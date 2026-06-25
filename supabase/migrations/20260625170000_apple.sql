-- Phase 4: Apple Music as a catalog source (completes Spotify/Apple/Deezer).
-- catalog_source + tracks.source already allow 'apple' (20260624200000); add the
-- per-source ids.
alter table public.tracks add column apple_id text;
alter table public.artists add column apple_artist_id text;
