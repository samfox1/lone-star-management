-- Music union model: one track row carries the union of every platform's fields,
-- and "which platforms is this song on" is DERIVED from the per-platform id columns
-- (spotify_id / apple_id / deezer_id) — not stored booleans that could drift.
--
-- Released vs Unreleased is likewise DERIVED from provenance (MUSIC_RESTRUCTURE.md,
-- decision #1) — no status column here. This migration adds only the two fields the
-- multi-platform merge genuinely needs and can't derive:
--   * duration_ms — the cross-platform match key (normalized title + duration) and a
--     display value; both Spotify (duration_ms) and the free iTunes Search API
--     (trackTimeMillis) provide it.
--   * apple_url — Apple/iTunes store link. Unlike Spotify (open.spotify.com/track/{id})
--     and Deezer (deezer.com/track/{id}), an Apple song URL can't be rebuilt from its
--     id, so it's the one link we must store; the merged row keeps each platform's
--     link independently instead of sharing the single legacy `provider_url`.
--
-- Additive and NON-BREAKING: both nullable so existing rows are unchanged.
alter table public.tracks add column if not exists duration_ms integer;
alter table public.tracks add column if not exists apple_url text;
