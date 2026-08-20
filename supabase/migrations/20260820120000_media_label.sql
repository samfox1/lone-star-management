-- A label on media rows (ftbk-website's works pool — docs/LONE_STAR_CHANGES.md §1).
-- The desktop site scatters arbitrary labelled pieces; gallery images had no name to
-- show under an icon. Additive and optional: template sites never read it, and the
-- wire carries it only once it is listed in the media snapshot columns.
alter table public.media add column if not exists label text;
