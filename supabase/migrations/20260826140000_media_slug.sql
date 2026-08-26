-- Descriptive file names (SEO_GEO_PLAN B6b, Sam 2026-08-26: "give them descriptive slugs
-- … in the final HTML … don't bury the src"). `slug` names the object:
-- `{artist}/{category}/{slug}.{ext}`, so the URL a crawler sees carries the words.
-- Renaming COPIES the object (never moves): the published snapshot still points at the
-- old path until the next publish, and storage GC sweeps it after that.
alter table public.media add column if not exists slug text
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
-- One name per artist folder tree; null (uuid-named) rows are unconstrained.
create unique index if not exists media_artist_slug_uniq
  on public.media (artist_id, slug)
  where slug is not null;
comment on column public.media.slug is 'Descriptive object name; storage_path ends in {slug}.{ext}';
