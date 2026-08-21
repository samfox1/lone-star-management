-- A gallery photo can belong to a NAMED COLLECTION.
--
-- Until now a site had exactly one open image pool: `purpose='gallery_image'` with no
-- `site_role`. That was enough while every site rendered one collage. ftbk renders two
-- unrelated pools — the works scattered on the desktop (the artist's pieces) and the
-- personal photos inside its Photos app — and the manager must be able to put an image
-- in one without it appearing in the other (Sam, 2026-08-20: "I want FTBK to be able to
-- put personal images into the photos application … this should be a different section
-- of images in the images panel").
--
-- Why not the columns we already have:
--   • `site_role` is single-occupancy by construction — `media_artist_site_role_uniq`
--     (20260724120000) allows ONE row per role per artist, because a component slot IS
--     one position. A collection holds many.
--   • `purpose` is a closed CHECK naming what a file IS (a gallery image, a portrait),
--     not where it is shown. Widening it per site would make every site's pools a
--     platform-level enum change.
--
-- So: an open text tag, shaped like `site_role`, meaning "which declared image slot of
-- the site this photo fills". NULL keeps its old meaning — the site's first (or only)
-- declared image collection — so every existing row and every existing site is
-- unchanged, and skeen's single gallery needs no backfill.
alter table public.media add column if not exists collection text
  check (collection is null or collection ~ '^[a-z0-9_]{1,64}$');

comment on column public.media.collection is
  'Which declared image collection (manifest slot key) this photo fills. NULL = the site''s first/default collection. Many rows may share one value, unlike site_role.';
