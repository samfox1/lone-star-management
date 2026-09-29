-- SEO / GEO TEST RUNS: the 24 plain-language tests' results, KEPT (Sam, 2026-09-28: "I want to
-- make sure that what it says its doing is actually being done... I want honest feedback").
--
-- One row per run. The page never decides a result itself: it reads these rows, so the history
-- dots, "tested today at 9:14 PM, after you published", "19 of 24" and the Overview's timeline
-- are all reads of what a run recorded.
--
-- WHO CAN WRITE (the 2026-09-29 security review found a manager could forge runs, skip the
-- cool-down and wipe the history through the table itself; this is the fix):
--
--   * A manager's session (`authenticated`) may only SELECT, and only its own artists' rows.
--     It has no INSERT, UPDATE or DELETE on the table and cannot execute the two functions
--     below, so NO browser session can write a run, forged or real.
--   * `seo_test_claim` / `seo_test_finish` (security definer, executable by service_role ONLY)
--     are the only write path. Our server calls them with the service key, AFTER it has checked
--     the signed-in manager owns the artist (test-actions.ts, the publish hook), and passes that
--     manager's id so the limits below are per person. The results a run stores are computed by
--     our server code (run.ts), never taken from a request.
--   * The service role itself has SELECT only on the table: even a service-key bug cannot write
--     around the functions. Only the owner (migrations, the SQL editor) writes directly, and the
--     triggers below still apply to it.
--
-- WHAT THE SERVICE KEY CAN STILL DO, said plainly: call seo_test_finish with any results it
-- likes. That key is the server's; whoever holds it holds the whole database anyway. The
-- guarantee is "no browser session", not "no server bug".
--
-- THE RULES (all in the BEFORE INSERT trigger, so they hold for every insert, the owner's too):
--   busy        one running run per artist (plus a unique index as the backstop).
--   cool-down   MANUAL: 60 s from the later of the last run's start and the last run's FINISH.
--               Counting from the finish gives every publish-triggered run a window no chain of
--               "Test again" clicks can close. PUBLISH: at most one publish-triggered run per
--               artist per 60 s, so publishing 20 times in a minute cannot make 20 runs.
--   coalesce    a publish run is refused ("coalesced") when a running or finished run already
--               covers that publish (its published_at is at or after it).
--   per person  a manager may have at most 2 runs going at once and start at most 30 an hour,
--               across ALL their artists (50 artists aimed at one site cannot mean 50 runs).
--   denied      the person must be a manager of the artist, or an admin.
--   retention   the newest 30 runs per artist are kept; older ones are pruned at insert.
--
-- A finished run is immutable, for every role (the finish trigger refuses any change to it).
--
-- SIZE: `results` is at most 256 KB, counted in BYTES of its text form (octet_length). store.ts
-- caps every string by the same measure (UTF-8 bytes of its JSON form), and 24 results at their
-- caps stay under ~200 KB, so this check is a backstop. If it ever fires, the run is marked
-- failed rather than left running.

create table public.seo_test_runs (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  -- When the run STARTED (the claim). Stamped by the claim trigger, never by the caller.
  ran_at       timestamptz not null default now(),
  finished_at  timestamptz,
  trigger      text not null,
  status       text not null default 'running',
  -- The manager whose click or publish caused the run (null for a scheduled run). What the
  -- per-person limits count. A user id only: no FK, so deleting a user keeps the history.
  started_by   uuid,
  -- The site's origin as tested; null when no site was connected (every test `unknown`).
  site_url     text,
  -- One SeoTestResult per test, in SEO_TEST_IDS order (types.ts).
  results      jsonb not null default '[]'::jsonb,
  -- DERIVED from `results` by the finish trigger: count of `pass`, count of results that are
  -- not `na` ("does not apply" is left out of the score on BOTH sides: 19 passes and one `na`
  -- out of 24 is "19 of 23"), and { testId: status } for the cheap history / timeline reads,
  -- `na` included (a test's history may mix statuses).
  passed       int not null default 0,
  total        int not null default 0,
  summary      jsonb not null default '{}'::jsonb,
  -- Was the live site showing the latest publish when the run looked? true = confirmed (its
  -- sitemap's lastmod named that publish), false = confirmed NOT, null = could not tell. The
  -- page says "your site may not have updated yet" for anything but true.
  site_fresh   boolean,
  -- The publish the run is for: set at the claim for a publish run (what coalescing compares),
  -- then what the run actually read (max(revisions.published_at), as the door serves it).
  published_at timestamptz,
  -- One plain sentence: why a run failed, or what limited it ("ran out of time").
  note         text,
  -- Did the site answer at all when the run looked (SeoEvidence.reach)? { state, status, error? },
  -- state answered / server-error / refused / no-answer. Anything but answered: the page says
  -- "We couldn't reach your site" once. null = no site connected, or the run could not tell.
  -- Written only through seo_test_finish.
  reach        jsonb,
  constraint seo_test_runs_trigger check (trigger in ('manual', 'publish', 'scheduled')),
  constraint seo_test_runs_status check (status in ('running', 'done', 'failed')),
  -- A person causes a manual or publish run; only a schedule has no one behind it.
  constraint seo_test_runs_started_by check (trigger = 'scheduled' or started_by is not null),
  constraint seo_test_runs_site_url check (site_url is null or (char_length(site_url) <= 2048 and site_url ~ '^https?://')),
  constraint seo_test_runs_results_shape check (jsonb_typeof(results) = 'array'),
  constraint seo_test_runs_results_size check (octet_length(results::text) <= 262144),
  constraint seo_test_runs_summary_shape check (jsonb_typeof(summary) = 'object'),
  constraint seo_test_runs_counts check (passed >= 0 and total >= 0 and passed <= total and total <= 64),
  -- A done run HAS results. Counted on `results`, not `total`: a run where every test is `na`
  -- is a real run with a score of 0 of 0, not an empty one.
  constraint seo_test_runs_done_has_results check (status <> 'done' or (jsonb_typeof(results) = 'array' and jsonb_array_length(results) > 0)),
  constraint seo_test_runs_note check (note is null or (char_length(note) <= 300 and note !~ '[\r\n]')),
  constraint seo_test_runs_reach check (
    reach is null or (
      jsonb_typeof(reach) = 'object'
      and reach ->> 'state' in ('answered', 'server-error', 'refused', 'no-answer')
      and jsonb_typeof(coalesce(reach -> 'status', 'null'::jsonb)) in ('number', 'null')
      and jsonb_typeof(coalesce(reach -> 'error', 'null'::jsonb)) in ('string', 'null')
      and octet_length(reach::text) <= 512
    )
  )
);

-- Every reader is "this artist's runs, newest first".
create index seo_test_runs_artist_ran_idx on public.seo_test_runs (artist_id, ran_at desc);
-- The per-person limits: "this manager's runs in the last hour".
create index seo_test_runs_started_by_idx on public.seo_test_runs (started_by, ran_at desc) where started_by is not null;

-- One running run per artist, as a CONSTRAINT under the trigger's lock: a writer that skips
-- triggers (session_replication_role = replica) still cannot start a second one.
create unique index seo_test_runs_one_running on public.seo_test_runs (artist_id) where status = 'running';

alter table public.seo_test_runs enable row level security;

-- READ ONLY, for the artist's managers (and admins): the repo's predicate. There is no insert,
-- update or delete policy, and no such grant below: writes go through the functions.
create policy seo_test_runs_read on public.seo_test_runs
  for select using (public.is_admin() or public.is_manager_of(artist_id));

-- AGENTS.md: by ROLE, not just PUBLIC. Anon gets nothing. Managers and the service role get
-- SELECT and nothing else (the service role bypasses RLS, not table privileges).
revoke all on table public.seo_test_runs from public, anon, authenticated, service_role;
grant select on table public.seo_test_runs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CLAIM (BEFORE INSERT): who, lock, stamp, busy, limits, cool-downs, coalesce, prune
-- ---------------------------------------------------------------------------
-- Locks are taken BEFORE anything is counted, or two concurrent claims both see "nothing
-- running" and both pass (the brand-colour cap learned that, 20260924120000). The person's lock
-- first, then the artist's, always in that order, so two claims can never wait on each other in
-- a circle. A waiter's queries run after the holder commits, and plpgsql takes a fresh snapshot
-- per statement, so it sees the holder's row.
--
-- A running row older than 5 minutes is a run whose process died (a killed dev server, a
-- serverless timeout). It is marked `failed` so it cannot wedge the artist forever.
--
-- A refusal is `check_violation` with the reason in DETAIL (busy / cooldown / coalesced / limit /
-- denied) and the seconds to wait in HINT; seo_test_claim turns it into an answer row.
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

create trigger seo_test_runs_claim
  before insert on public.seo_test_runs
  for each row execute function public.seo_test_runs_claim();

-- ---------------------------------------------------------------------------
-- FINISH (BEFORE UPDATE): a running row becomes done/failed exactly once; the counts are derived
-- ---------------------------------------------------------------------------
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
    return new;
  end if;
  new.finished_at := now();
  if new.status = 'failed' then
    new.results := '[]'::jsonb;
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

create trigger seo_test_runs_finish
  before update on public.seo_test_runs
  for each row execute function public.seo_test_runs_finish();

-- Trigger functions: PostgREST cannot invoke them whatever the grant; revoked from every role so
-- `npm run audit:grants` lists neither.
revoke all on function public.seo_test_runs_claim() from public, anon, authenticated;
revoke all on function public.seo_test_runs_finish() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE WRITE PATH: two functions, service_role only
-- ---------------------------------------------------------------------------
-- Claim: one answer row, never an exception for a refusal. `outcome` is claimed / busy /
-- cooldown / coalesced / limit / denied; `retry_in_s` is how long to wait, when that is known.
create or replace function public.seo_test_claim(p_artist_id uuid, p_trigger text, p_user_id uuid, p_published_at timestamptz default null)
returns table (outcome text, run_id uuid, ran_at timestamptz, retry_in_s int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_at timestamptz;
  v_detail text;
  v_hint text;
begin
  insert into public.seo_test_runs (artist_id, trigger, started_by, published_at)
  values (p_artist_id, p_trigger, p_user_id, case when p_trigger = 'publish' then p_published_at end)
  returning seo_test_runs.id, seo_test_runs.ran_at into v_id, v_at;
  return query select 'claimed'::text, v_id, v_at, null::int;
exception
  when check_violation then
    get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    if v_detail in ('busy', 'cooldown', 'coalesced', 'limit', 'denied') then
      return query select v_detail, null::uuid, null::timestamptz, nullif(v_hint, '')::int;
    else
      raise;
    end if;
  when unique_violation then
    return query select 'busy'::text, null::uuid, null::timestamptz, 10;
end;
$$;

-- Finish: the running run becomes `done` (with results) or `failed` (with a note). true = it
-- was running and is now finished; false = no such running run (abandoned, pruned, finished).
create or replace function public.seo_test_finish(
  p_run_id uuid,
  p_status text,
  p_results jsonb,
  p_site_url text,
  p_site_fresh boolean,
  p_published_at timestamptz,
  p_note text,
  p_reach jsonb default null
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
         reach = p_reach
   where id = p_run_id and status = 'running';
  return found;
end;
$$;

-- AGENTS.md "Service-only": revoked from public, anon AND authenticated, then granted to the
-- service role alone. A manager's session cannot call either.
revoke all on function public.seo_test_claim(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.seo_test_finish(uuid, text, jsonb, text, boolean, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.seo_test_claim(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.seo_test_finish(uuid, text, jsonb, text, boolean, timestamptz, text, jsonb) to service_role;
