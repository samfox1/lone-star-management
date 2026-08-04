-- Brand: the artist's logos, and the favicon derived from the primary one.
--
-- Logos are `media` rows, not new columns: `profile_photo` already established the shape
-- (one row per purpose, replace by vacate-then-insert), so publishing, storage GC and the
-- public site payload all work without inventing a mechanism. `hero_image_url` is a
-- column only because its object lives OUTSIDE MEDIA_FOLDERS so publish GC can't sweep
-- the live hero — logos have no such need, since a media row references the object and
-- that is what keeps GC off it.
--
-- `favicon` is DERIVED, never uploaded. A favicon is a static file with no CSS at display
-- time, so the manager's zoom/nudge has to be baked into the pixels; the Brand page draws
-- the primary logo into a canvas and saves exactly what it drew. Storing the result as a
-- media row means the site reads it the same way it reads everything else.
alter table media drop constraint if exists media_purpose_check;
alter table media add constraint media_purpose_check check (
  purpose = any (array[
    'hero_video', 'profile_photo', 'gallery_image', 'bio_video',
    'logo_primary', 'logo_secondary', 'favicon'
  ])
);

-- The framing behind the derived favicon. CONFIG, not content: the generated image is
-- what the public consumes, and these two numbers exist only so reopening the Brand page
-- restores the controls where the manager left them. Deliberately NOT added to
-- ARTIST_SNAPSHOT — publishing them would grow every public site payload with something
-- no visitor can use.
--
-- Nullable with no default: NULL means "never adjusted", which lib/brand.ts reads as the
-- default framing (whole logo, centred). A stored 1/0 would be indistinguishable from a
-- deliberate choice to reset, which matters if the defaults ever change.
alter table artists add column if not exists favicon_zoom real;
alter table artists add column if not exists favicon_offset_y real;

-- Bound them in the database too. lib/brand.ts clamps on the way in, but that is the
-- client-side half; these are the values a canvas is driven from, and an out-of-range
-- zoom renders a blank tab icon with nothing to explain why.
alter table artists drop constraint if exists artists_favicon_zoom_range;
alter table artists add constraint artists_favicon_zoom_range
  check (favicon_zoom is null or (favicon_zoom >= 1 and favicon_zoom <= 6));

alter table artists drop constraint if exists artists_favicon_offset_range;
alter table artists add constraint artists_favicon_offset_range
  check (favicon_offset_y is null or (favicon_offset_y >= -1 and favicon_offset_y <= 1));
