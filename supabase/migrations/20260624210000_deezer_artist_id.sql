-- The artist's Deezer artist id, used to pull their catalog when the selected
-- catalog_source is 'deezer' (mirrors spotify_artist_id). Config, not published.
alter table public.artists add column deezer_artist_id text;
