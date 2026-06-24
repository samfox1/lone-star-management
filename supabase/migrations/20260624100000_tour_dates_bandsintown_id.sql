-- Bandsintown sync dedup key. Mirrors tracks.spotify_id / merch.shopify_product_id:
-- a stable external id so a re-pull updates the same row instead of duplicating.
alter table public.tour_dates add column bandsintown_id text;
