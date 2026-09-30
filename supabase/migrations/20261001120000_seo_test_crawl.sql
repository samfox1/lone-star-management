-- SEO TEST RUNS: + `crawl`, what a run SAW, for "How crawlers see your site" (types.ts SeoCrawl).
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. `supabase db push --dry-run` lists ONLY this file. Then push (`npm run db:push`).
--   3. `npm run audit:grants`: seo_test_finish must not be listed (it is service-role only).
--   4. Flip CRAWL_MIGRATION_PUSHED in tests/integration/seo-tests/seo-test-runs.test.ts and run
--      that file.
--
-- ── BEFORE THE PUSH ─────────────────────────────────────────────────────────────────────
-- store.ts already reads and writes `crawl`. Against a database without this file:
--   * finishRun sends `p_crawl` only when there is a crawl, and when that call fails it finishes
--     the run again WITHOUT it: the run's results are kept, only the crawl is lost.
--   * latestRun selects `crawl`, and when the column is missing (42703) it reads the run again
--     without it, so the Test tab keeps working before this is pushed.
--
-- ── WHAT THIS FILE DOES ─────────────────────────────────────────────────────────────────
--   1. seo_test_runs.crawl jsonb: null, or an OBJECT of at most 64 KB counted in BYTES of its
--      text form (store.ts capCrawl keeps under it by the same measure, so this is a backstop).
--      The table checks only that much; the shape (v: 1, robots, sitemap, pages…) is checked by
--      store.ts on the way in AND on the way out, and the page renders it as text.
--   2. The claim trigger nulls `crawl` like every other server-owned column: a new run never
--      starts with one, whoever inserts it (the owner included).
--   3. The finish trigger: a run still running cannot gain a crawl, and a FAILED run never keeps
--      one (as it keeps no results). A finished run stays immutable, `crawl` included: the
--      trigger already refuses any change to a row that is not running.
--   4. seo_test_finish gains a trailing `p_crawl jsonb default null`. A new argument list is a
--      new function (an OVERLOAD), so the old one is dropped first; the new one is revoked from
--      public, anon AND authenticated and granted to the service role alone (AGENTS.md
--      "Grants"). Every check in its body is unchanged. It stores `p_crawl` as given; the
--      finish trigger (3) is the one place that decides a failed run keeps none, for every
--      writer, so there is no second copy of that rule here to drift from it.
--
-- Checked on a throwaway local Postgres 18 (2026-09-30; hosted is 17, and the codes used here are
-- the same on both), with the Supabase roles and default privileges stubbed: the check refuses a
-- non-object and 65,537 bytes and takes 65,536; finish stores the crawl; a failed finish keeps
-- none; a finished run's crawl cannot change; a direct insert starts with none; a running run
-- cannot gain one; anon and authenticated cannot execute the new seo_test_finish; old callers
-- (7 and 8 named arguments) still resolve. Each guard was broken once and its check went red.

-- ── 1. The column ──────────────────────────────────────────────────────────────────────

alter table public.seo_test_runs add column crawl jsonb;

alter table public.seo_test_runs add constraint seo_test_runs_crawl check (
  crawl is null or (jsonb_typeof(crawl) = 'object' and octet_length(crawl::text) <= 65536)
);

-- ── 2. The claim: every server-owned column reset, `crawl` now among them ───────────────
-- Identical to 20260929140000 but for one line (`new.crawl := null`).
create or replace function public.seo_test_runs_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cooldown constant interval := interval '60 seconds';
  stale constant interval := interval '5 minutes';
  keep constant int := 30;
  per_person_running constant int := 2;
  per_person_hour constant int := 30;
  last_start timestamptz;
  last_finish timestamptz;
  wait_until timestamptz;
  n int;
begin
  -- WHO. A person must manage the artist (or be an admin). Checked on the row, not on a JWT:
  -- the only callers are the owner and seo_test_claim, which the server calls with the service
  -- key and the id of the manager it has already signed in.
  if new.started_by is not null
     and not exists (select 1 from public.artist_managers m where m.artist_id = new.artist_id and m.user_id = new.started_by)
     and not exists (select 1 from auth.users u where u.id = new.started_by and u.raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'seo_test_denied' using errcode = 'check_violation', detail = 'denied';
  end if;

  if new.started_by is not null then
    perform pg_advisory_xact_lock(hashtext('seo_test_runs:person:' || new.started_by::text));
  end if;
  perform pg_advisory_xact_lock(hashtext('seo_test_runs:' || new.artist_id::text));

  -- The database owns the clock and the lifecycle, whatever the caller sent.
  new.ran_at := now();
  new.status := 'running';
  new.finished_at := null;
  new.results := '[]'::jsonb;
  new.passed := 0;
  new.total := 0;
  new.summary := '{}'::jsonb;
  new.site_fresh := null;
  new.note := null;
  new.reach := null;
  new.crawl := null;
  if new.trigger <> 'publish' then
    new.published_at := null;
  end if;

  update public.seo_test_runs
     set status = 'failed', note = 'This test stopped before it finished.'
   where artist_id = new.artist_id
     and status = 'running'
     and ran_at < clock_timestamp() - stale;

  if exists (select 1 from public.seo_test_runs where artist_id = new.artist_id and status = 'running') then
    raise exception 'seo_test_busy' using errcode = 'check_violation', detail = 'busy', hint = '10';
  end if;

  -- PER PERSON, across all their artists.
  if new.started_by is not null then
    select count(*) into n from public.seo_test_runs r
     where r.started_by = new.started_by and r.status = 'running' and r.ran_at >= clock_timestamp() - stale;
    if n >= per_person_running then
      raise exception 'seo_test_limit' using errcode = 'check_violation', detail = 'limit', hint = '30';
    end if;
    select count(*), min(r.ran_at) into n, last_start from public.seo_test_runs r
     where r.started_by = new.started_by and r.ran_at > clock_timestamp() - interval '1 hour';
    if n >= per_person_hour then
      raise exception 'seo_test_limit' using errcode = 'check_violation', detail = 'limit',
        hint = greatest(1, ceil(extract(epoch from (last_start + interval '1 hour' - clock_timestamp())))::int)::text;
    end if;
  end if;

  if new.trigger = 'manual' then
    -- The finish that counts is a DONE run's: a run the sweep above just marked failed would
    -- otherwise start a cool-down on the very claim that swept it.
    select max(r.ran_at), max(r.finished_at) filter (where r.status = 'done')
      into last_start, last_finish from public.seo_test_runs r where r.artist_id = new.artist_id;
    wait_until := greatest(last_start + cooldown, last_finish + cooldown);
    if wait_until is not null and wait_until > clock_timestamp() then
      raise exception 'seo_test_cooldown' using errcode = 'check_violation', detail = 'cooldown',
        hint = greatest(1, ceil(extract(epoch from (wait_until - clock_timestamp())))::int)::text;
    end if;
  elsif new.trigger = 'publish' then
    if new.published_at is not null and exists (
      select 1 from public.seo_test_runs r
       where r.artist_id = new.artist_id and r.status in ('running', 'done') and r.published_at >= new.published_at
    ) then
      raise exception 'seo_test_coalesced' using errcode = 'check_violation', detail = 'coalesced';
    end if;
    select max(r.ran_at) into last_start from public.seo_test_runs r where r.artist_id = new.artist_id and r.trigger = 'publish';
    if last_start is not null and last_start > clock_timestamp() - cooldown then
      raise exception 'seo_test_cooldown' using errcode = 'check_violation', detail = 'cooldown',
        hint = greatest(1, ceil(extract(epoch from (last_start + cooldown - clock_timestamp())))::int)::text;
    end if;
  end if;

  -- Keep the newest `keep` INCLUDING this one.
  delete from public.seo_test_runs
   where id in (
     select r.id from public.seo_test_runs r
      where r.artist_id = new.artist_id
      order by r.ran_at desc, r.id desc
      offset keep - 1
   );

  return new;
end;
$$;

-- ── 3. The finish trigger: no crawl while running, none on a failed run ─────────────────
-- Identical to 20260929140000 but for two lines (`new.crawl := old.crawl`, `new.crawl := null`).
create or replace function public.seo_test_runs_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'running' then
    raise exception 'seo_test_finished: a finished test run cannot change'
      using errcode = 'check_violation';
  end if;
  -- Who, when, why and for whom a run started never change.
  new.artist_id := old.artist_id;
  new.ran_at := old.ran_at;
  new.trigger := old.trigger;
  new.started_by := old.started_by;
  if new.status = 'running' then
    new.results := old.results;
    new.crawl := old.crawl;
    return new;
  end if;
  new.finished_at := now();
  if new.status = 'failed' then
    new.results := '[]'::jsonb;
    new.crawl := null;
  end if;
  if jsonb_typeof(new.results) = 'array' then
    -- The four statuses of types.ts `SeoTestStatus`, and nothing else: `total` leaves out
    -- exactly `na`, so a status this trigger does not know would be counted as scored.
    if exists (select 1 from jsonb_array_elements(new.results) r
                where coalesce(r.value ->> 'status', '') not in ('pass', 'fail', 'unknown', 'na')) then
      raise exception 'seo_test_bad_status: a result has a status the tests do not use'
        using errcode = 'check_violation';
    end if;
    select (count(*) filter (where r.value ->> 'status' <> 'na'))::int,
           (count(*) filter (where r.value ->> 'status' = 'pass'))::int,
           coalesce(jsonb_object_agg(r.value ->> 'id', r.value ->> 'status') filter (where r.value ->> 'id' is not null), '{}'::jsonb)
      into new.total, new.passed, new.summary
      from jsonb_array_elements(new.results) r;
  end if;
  return new;
end;
$$;

-- Trigger functions: `create or replace` keeps their privileges; revoked again so this file
-- says so on its own (`npm run audit:grants` lists neither).
revoke all on function public.seo_test_runs_claim() from public, anon, authenticated;
revoke all on function public.seo_test_runs_finish() from public, anon, authenticated;

-- ── 4. seo_test_finish, + p_crawl ───────────────────────────────────────────────────────
-- The old argument list goes first: `create or replace` with one more argument would leave it
-- in place as a second, still-callable function.
drop function public.seo_test_finish(uuid, text, jsonb, text, boolean, timestamptz, text, jsonb);

-- Finish: the running run becomes `done` (with results) or `failed` (with a note). true = it
-- was running and is now finished; false = no such running run (abandoned, pruned, finished).
create function public.seo_test_finish(
  p_run_id uuid,
  p_status text,
  p_results jsonb,
  p_site_url text,
  p_site_fresh boolean,
  p_published_at timestamptz,
  p_note text,
  p_reach jsonb default null,
  p_crawl jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('done', 'failed') then
    raise exception 'seo_test_finish: status must be done or failed' using errcode = 'check_violation';
  end if;
  update public.seo_test_runs
     set status = p_status,
         results = coalesce(p_results, '[]'::jsonb),
         site_url = p_site_url,
         site_fresh = p_site_fresh,
         published_at = coalesce(p_published_at, published_at),
         note = p_note,
         reach = p_reach,
         crawl = p_crawl
   where id = p_run_id and status = 'running';
  return found;
end;
$$;

-- AGENTS.md "Service-only": a NEW function, so Supabase's default privileges have just granted
-- it to anon and authenticated BY ROLE. Revoked from public, anon AND authenticated, then
-- granted to the service role alone.
revoke all on function public.seo_test_finish(uuid, text, jsonb, text, boolean, timestamptz, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.seo_test_finish(uuid, text, jsonb, text, boolean, timestamptz, text, jsonb, jsonb) to service_role;
