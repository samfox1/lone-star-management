-- TOUR DATES: + start_time, the show's start as the venue's LOCAL wall-clock time, 24h HH:MM.
--
-- Bandsintown's bulk upload requires a start time (24h `HH:MM`) on every show, and Google's
-- Event data is better with one (visibility research, 2026-09-30). A show stored only a date.
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. `supabase db push --dry-run` lists this file (and 20261001130000 if that one is still
--      unpushed: they are independent, either order is fine). Then push (`npm run db:push`).
--   3. `npm run audit:grants`: no function is created or replaced here, so expect no change.
--   4. Flip START_TIME_PUSHED in tests/integration/tour/tour-start-time.test.ts and run that
--      file. Also run tests/integration/sync/sync.bandsintown.test.ts (its pull now carries a
--      time when Bandsintown gives one; the fixture has none, so it writes none).
--   5. In Tour, open a show, set Time, Publish: get_public_site carries "start_time" on it.
--   6. Expect, once per artist: the next tour Publish writes a fresh revision for EVERY show,
--      because the snapshot gained a key (null on the working row, absent on the stored copy).
--      Same content, one extra publish moment. Not a bug; it does not repeat.
--
-- ── WHY text, NOT time ──────────────────────────────────────────────────────────────────
-- The value is a label for one place's clock, never arithmetic, and it travels as-is: into the
-- published jsonb snapshot, the public door, the sites, a CSV. A `time` column reads back as
-- "20:30:00", so every reader would have to re-cut it to HH:MM; and `time` vs `timetz` invites
-- a zone the value does not have. So: text, constrained to exactly what the app's parser
-- (src/lib/tour.ts parseStartTime) writes. Nullable: most shows have no announced time.
--
-- ── WHAT ELSE NEEDS CHANGING: NOTHING (checked 2026-09-30) ─────────────────────────────
--   * RLS: `tour_dates_rw` (FOR ALL, admin or manager of the artist) covers every column.
--   * Grants: tour_dates has no column-level grants; the new column inherits the table's.
--   * get_public_site sends each tour_date revision's `data` wholesale (minus on_site), so the
--     key reaches the door through PUBLISHABLE.tour_date.snapshot with no SQL change.
--   * No view, trigger or function lists tour_dates' columns: reorder_rows writes sort_order
--     only, set_updated_at is column-blind, the presence backfill (20260911120000) is done.
--   * The restore (EDITOR_RESTORE) puts back on_site + sort_order only, so it never writes this.

alter table public.tour_dates
  add column if not exists start_time text
  constraint tour_dates_start_time_check
  check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
