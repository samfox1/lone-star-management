-- PROFILE MARKS, BIOS: the "updated" ticks for the outside bios an artist edits themselves
-- (OUTSIDE_PROFILES_PLAN.md, build step 1, "the change nudge"), and a way to RE-CONFIRM a mark.
-- Builds on 20261001150000_profile_marks.sql (live).
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. `supabase db push --dry-run` lists this file. Then `npm run db:push`.
--   3. `npm run audit:grants`: one new function, profile_marks_stamp (a trigger), revoked from
--      public, anon and authenticated, so expect NO change. Column grants, by eye (expect
--      authenticated: INSERT on artist_id + item, UPDATE on done_at, plus SELECT on all four
--      columns from the table-level grant, nothing else):
--        select grantee, column_name, privilege_type from information_schema.column_privileges
--         where table_schema = 'public' and table_name = 'profile_marks' and grantee = 'authenticated'
--         order by privilege_type, column_name;
--   4. Flip BIO_MARKS_PUSHED in tests/integration/manager-tools/seo/profile-marks.test.ts and run
--      that file. Then delete what only held before this push: the two `skipIf(BIO_MARKS_PUSHED)`
--      tests there, the 42501 fallback in setProfileMark (src/lib/manager-tools/profiles/marks.ts)
--      and its unit test ("falls back to the old insert while UPDATE is not granted").
--   5. SEO → Profiles: tick a bio "updated", reload, it stays; tick it again, the date moves.
--
-- ── 1. THE ITEMS ────────────────────────────────────────────────────────────────────────
-- Exactly PROFILE_ITEMS in src/lib/manager-tools/profiles/marks.ts: 'allmusic_bio' plus one
-- `bio_<key>` per OUTSIDE_BIOS entry (src/lib/manager-tools/profiles/bios.ts). A unit test reads
-- the newest definition of this constraint across all migrations and fails if the lists differ
-- (tests/unit/manager-tools/seo/profile-marks.test.ts), so widen both together.
--
-- ── 2. RE-CONFIRM: why an UPDATE grant + a stamping trigger ─────────────────────────────
-- Ticking "updated" again must move the date to now: the 6-month "still current?" nudge counts
-- from it. Two ways were weighed:
--   * delete-then-insert from the app (no schema change): two statements, so a failed insert
--     after the delete LOSES the mark, and the page can read "not done" in between.
--   * an UPDATE of done_at, stamped by the database (chosen): one statement, atomic, the row is
--     never missing. The grant is on done_at ONLY, and a BEFORE UPDATE trigger overwrites
--     done_at with now() and done_by with auth.uid() whatever the request sent, so a manager can
--     re-confirm but can never pick the date (past or future) or put it in someone else's name.
--     Same rule as the insert: the stamp is the database's.
-- The trigger runs on EVERY update, the service role's included (it has no auth.uid(), so
-- done_by goes null). To plant an old date (tests, a backfill), INSERT it as the service role.
--
-- WHO MAY UPDATE: the same predicate as the table's other three policies (copied from
-- `brand_colors_rw`, 20260924120000_brand_page.sql), in USING and WITH CHECK. artist_id cannot
-- change (no column grant), so WITH CHECK only repeats USING; it is there so a future column
-- grant cannot move a mark onto an artist the caller does not manage. A denied update is
-- row-filtered (no error, zero rows): callers check ownership first, as setProfileMark's server
-- action does.
--
-- GRANTS (AGENTS.md): the trigger function is never called directly (PostgREST cannot invoke a
-- `returns trigger` function), and a trigger fires without the caller holding EXECUTE, so it is
-- revoked from public, anon AND authenticated, like seo_test_runs_claim/_finish.
--
-- Checked on a throwaway local Postgres 2026-10-01, each guard broken once: see the integration
-- file's header.

-- 1. The items.
alter table public.profile_marks drop constraint profile_marks_item_check;
alter table public.profile_marks add constraint profile_marks_item_check check (item in (
  'allmusic_bio',
  'bio_spotify',
  'bio_instagram',
  'bio_soundcloud',
  'bio_youtube',
  'bio_tiktok',
  'bio_x',
  'bio_apple_music',
  'bio_bandsintown'
));

-- 2. Re-confirm.
create function public.profile_marks_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.done_at := now();
  new.done_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.profile_marks_stamp() from public, anon, authenticated;

create trigger profile_marks_stamp
  before update on public.profile_marks
  for each row execute function public.profile_marks_stamp();

create policy profile_marks_update on public.profile_marks
  for update
  using (public.is_admin() or public.is_manager_of(artist_id))
  with check (public.is_admin() or public.is_manager_of(artist_id));

grant update (done_at) on table public.profile_marks to authenticated;
