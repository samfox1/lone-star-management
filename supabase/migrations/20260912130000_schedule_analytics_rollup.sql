-- Step 4: the roll-up and the prune run nightly, on pg_cron.
--
-- Unblocked by 20260912120000 — until every reader could answer from tallies, scheduling
-- the prune would have quietly shrunk each 30-day card as the raw window moved. ADR 0012
-- carried that as a hard prerequisite; it is discharged.
--
-- WHY pg_cron AND NOT the door. The plan's fallback was an opportunistic run (~1 request in
-- 200, the way the contact door prunes attachments). pg_cron turns out to be available here
-- (1.6.4, probed 2026-09-12), and it is the better of the two by some distance: a fan's
-- page view never pays for a 73-day backfill, the work happens at a known quiet hour, and
-- `cron.job_run_details` says whether last night actually ran. The opportunistic path stays
-- described in the plan as the fallback if cron is ever unavailable on a future project.
--
-- WHY THE JOBS CAN SEE ANYTHING. Both functions are `security invoker`, so they run with
-- the caller's row visibility, and cron runs them as `postgres` — which holds `BYPASSRLS`
-- on this project (checked, not assumed: `select rolbypassrls from pg_roles where rolname =
-- 'postgres'` → true). Were that ever false, the roll-up would read zero rows through
-- `analytics_events`'s owner-only policy and write EMPTY tallies over good ones, silently.
-- That is the single assumption this schedule rests on, so it is named here; the
-- `tests/integration/analytics/schedule.test.ts` suite asserts it directly.
--
-- ORDER AND TIMING. Roll-up at 03:10 UTC, prune at 03:40. Half an hour is far more than the
-- work needs (a day is one indexed scan per dimension) and the two must not overlap: prune
-- only ever removes raw rows for days already in the ledger, so a roll-up still in flight
-- would be racing its own input. Both are idempotent, so a missed night self-heals the next
-- one — `roll_up_pending` walks every unrolled day back to the oldest raw row (120 days cap)
-- and re-rolls the last two regardless, for rows that arrived late.

create extension if not exists pg_cron;

-- `cron.schedule(name, schedule, sql)` upserts by name, so re-running this migration
-- rewrites the two jobs rather than piling up duplicates.
select cron.schedule('analytics-roll-up', '10 3 * * *', $$select public.roll_up_pending()$$);
select cron.schedule('analytics-prune',   '40 3 * * *', $$select public.prune_analytics()$$);
