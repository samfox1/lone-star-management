-- Add a third background slot role: `bio_background` — the video that plays behind the
-- bio section. Like the two hero roles (20260716200000), it's an UPLOADED video the
-- editor picks from the shared library; site_role rides the get_public_site.videos
-- snapshot and skeen's band skips uploaded videos, so it never double-renders.
--
-- The original check was an unnamed inline constraint; drop it by its generated name
-- and re-add a named one so future widenings are a one-liner.
alter table public.videos drop constraint if exists videos_site_role_check;
alter table public.videos add constraint videos_site_role_check
  check (site_role is null or site_role in ('hero_landscape', 'hero_portrait', 'bio_background'));
