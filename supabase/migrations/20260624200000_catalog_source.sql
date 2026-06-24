-- Phase 2: per-artist catalog source. An artist imports tracks from exactly ONE
-- of Spotify / Apple / Deezer (or Manual). catalog_source is editor config
-- (instant, not draft/publish, not fan-visible). Switching source deletes that
-- artist's working tracks for the OLD importer source (handled in app code).
alter table public.artists
  add column catalog_source text not null default 'manual'
  check (catalog_source in ('manual', 'spotify', 'apple', 'deezer'));

-- Per-source track ids + a link-out URL (Deezer is metadata + link only).
alter table public.tracks add column deezer_id text;
alter table public.tracks add column provider_url text;

-- Allow 'apple' and 'deezer' as track sync sources.
alter table public.tracks drop constraint if exists tracks_source_check;
alter table public.tracks
  add constraint tracks_source_check
  check (source in ('manual', 'spotify', 'bandsintown', 'shopify', 'apple', 'deezer'));
