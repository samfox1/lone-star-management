-- A fourth media purpose: `bio_video`, the self-hosted clip behind the About/bio
-- section (skeen's #about). Like hero_video it's a background video managed as a media
-- upload, not a library item — so it rides the same media snapshot and the same
-- get_public_site media branch (non-gallery purposes are served unconditionally when
-- published; only gallery_image is on_site-gated).
--
-- Widen the purpose CHECK. The constraint was defined inline in 20260624140000, so
-- Postgres named it media_purpose_check.
alter table public.media drop constraint if exists media_purpose_check;
alter table public.media
  add constraint media_purpose_check
  check (purpose in ('hero_video', 'profile_photo', 'gallery_image', 'bio_video'));
