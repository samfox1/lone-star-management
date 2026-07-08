-- Split YouTube uploads into normal videos vs Shorts. `is_short` marks a row as a
-- Short so the dashboard videos page can tab between them (normal videos land by
-- default; Shorts get their own tab), mirroring the music page's release-type split.
--
-- Detection is source-side: the import classifies each upload by hitting
-- youtube.com/shorts/<id> (200 ⟹ Short, a redirect ⟹ normal) — see src/lib/youtube.ts;
-- manual adds derive it from a pasted /shorts/ URL via embedInfo. Defaults false so
-- existing rows read as normal videos (the safe landing bucket).
alter table public.videos add column if not exists is_short boolean not null default false;
