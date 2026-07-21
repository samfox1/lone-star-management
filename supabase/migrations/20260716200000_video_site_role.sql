-- A video's ROLE on the site: it can be placed in a named background slot instead of
-- (or as well as) the YouTube band. Right now the only roles are the two hero
-- backgrounds — a landscape clip (desktop) and a portrait clip (mobile). null = a
-- normal library/band video.
--
-- This is how the editor's hero slots pick from the SAME video library the YouTube
-- slots use: an uploaded video assigned `hero_landscape`/`hero_portrait` becomes the
-- hero. skeen reads it from get_public_site.videos (site_role rides the snapshot) and
-- its band already skips uploaded videos (embeds only), so a hero video never
-- double-renders in the band.
alter table public.videos add column if not exists site_role text
  check (site_role is null or site_role in ('hero_landscape', 'hero_portrait'));
