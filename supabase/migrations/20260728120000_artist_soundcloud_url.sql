-- The artist's SoundCloud PROFILE url, captured at connect time. SoundCloud has no usable
-- catalog API (app registration is closed), so this can't auto-sync like Spotify/Apple/Deezer
-- — it's stored for the public social link and as a reference for adding per-song SoundCloud
-- links by hand. Distinct from tracks.soundcloud_url (a per-song listen link).
alter table artists add column if not exists soundcloud_url text;
