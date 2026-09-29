-- SEO / GEO TEST RUNS: the 24 plain-language tests' results, KEPT (Sam, 2026-09-28: "I want to
-- make sure that what it says its doing is actually being done... I want honest feedback").
--
-- One row per run. The page never decides a result itself: it reads these rows, so the history
-- dots, "tested today at 9:14 PM, after you published" and the Overview's timeline are all
-- reads of what a run really recorded. src/lib/seo-tests/store.ts is the only TS writer.
--
-- THE LIFECYCLE, owned by the database:
--
--   1. CLAIM   an INSERT of `{ artist_id, trigger }`. The claim trigger takes a per-artist lock,
--              refuses a second run while one is running ("busy") and a MANUAL run within 60 s
--              of the last one of any kind ("cooldown"), prunes the history, and stamps the
--              row itself: `ran_at = now()`, `status = 'running'`, empty results. A caller
--              cannot backdate a claim to dodge the cool-down.
--   2. FINISH  one UPDATE of the running row to `done` (with `results`) or `failed` (with a
--              `note`). The finish trigger derives `passed`, `total` and `summary` FROM
--              `results`, so the counts on the page can never disagree with the results they
--              count, and stamps `finished_at`.
--   3. KEPT    a finished row is immutable: RLS admits a manager's UPDATE only on a running
--              row, and the finish trigger refuses any change to a finished one (the service
--              role included). There is no DELETE for managers; retention prunes.
--
-- WHY IN THE DATABASE and not in memory: "Test again" is a server action, and a dev server,
-- two tabs or (later) several serverless instances share no memory. Only a row + a lock is
-- one truth for all of them, and the race (two clicks inside one second) is decided by the
-- advisory lock below, not by whoever reads first.
--
-- RETENTION: the newest 30 runs per artist (any status). History dots read 8; the Overview's
-- timeline reads the recent ones. A publish-triggered run per Publish means 30 is days to
-- weeks of history, never unbounded. Pruned at claim time, under the same lock.
--
-- SIZE: `results` is at most 256 KB as text. store.ts caps every string it writes (evidence
-- is capped text, ~4 KB per test at most), so this is a backstop that should never fire, and
-- a run that somehow trips it fails loudly rather than storing a truncated verdict.

create table public.seo_test_runs (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  -- When the run STARTED (the claim). Stamped by the claim trigger, never by the caller.
  ran_at       timestamptz not null default now(),
  finished_at  timestamptz,
  trigger      text not null,
  status       text not null default 'running',
  -- The site's origin as tested; null when no site was connected (every test `unknown`).
  site_url     text,
  -- One SeoTestResult per test, in SEO_TEST_IDS order (types.ts).
  results      jsonb not null default '[]'::jsonb,
  -- DERIVED from `results` by the finish trigger: count of `pass`, count of results, and
  -- { testId: status } for the cheap history / timeline reads.
  passed       int not null default 0,
  total        int not null default 0,
  summary      jsonb not null default '{}'::jsonb,
  -- Was the live site showing the latest publish when the run looked? true = confirmed (its
  -- sitemap's lastmod had reached `published_at`), false = confirmed NOT, null = could not
  -- tell. The page says "your site may not have updated yet" for anything but true.
  site_fresh   boolean,
  -- The publish the run compared against: max(revisions.published_at), as the door serves it.
  published_at timestamptz,
  -- One plain sentence: why a run failed, or what limited it ("ran out of time").
  note         text,
  constraint seo_test_runs_trigger check (trigger in ('manual', 'publish', 'scheduled')),
  constraint seo_test_runs_status check (status in ('running', 'done', 'failed')),
  constraint seo_test_runs_site_url check (site_url is null or (char_length(site_url) <= 2048 and site_url ~ '^https?://')),
  constraint seo_test_runs_results_shape check (jsonb_typeof(results) = 'array'),
  constraint seo_test_runs_results_size check (octet_length(results::text) <= 262144),
  constraint seo_test_runs_summary_shape check (jsonb_typeof(summary) = 'object'),
  constraint seo_test_runs_counts check (passed >= 0 and total >= 0 and passed <= total and total <= 64),
  constraint seo_test_runs_done_has_results check (status <> 'done' or total > 0),
  constraint seo_test_runs_note check (note is null or (char_length(note) <= 300 and note !~ '[\r\n]'))
);

-- Every reader is "this artist's runs, newest first".
create index seo_test_runs_artist_ran_idx on public.seo_test_runs (artist_id, ran_at desc);

-- One running run per artist, as a CONSTRAINT under the trigger's lock: a writer that skips
-- triggers (session_replication_role = replica) still cannot start a second one.
create unique index seo_test_runs_one_running on public.seo_test_runs (artist_id) where status = 'running';

alter table public.seo_test_runs enable row level security;

-- The artist's managers (and admins), the repo's predicate. READ every run; CLAIM a run; FINISH
-- only a RUNNING one. No delete policy: a manager cannot rewrite or remove the history, only
-- retention (the claim trigger, as owner) prunes it.
create policy seo_test_runs_read on public.seo_test_runs
  for select using (public.is_admin() or public.is_manager_of(artist_id));
create policy seo_test_runs_claim on public.seo_test_runs
  for insert with check (public.is_admin() or public.is_manager_of(artist_id));
create policy seo_test_runs_finish on public.seo_test_runs
  for update using ((public.is_admin() or public.is_manager_of(artist_id)) and status = 'running')
  with check (public.is_admin() or public.is_manager_of(artist_id));

-- AGENTS.md: by ROLE, not just PUBLIC. Anon gets nothing; a signed-in manager gets the three
-- verbs RLS scopes (no DELETE, no TRUNCATE).
revoke all on table public.seo_test_runs from public, anon, authenticated;
grant select, insert, update on table public.seo_test_runs to authenticated;
grant all on table public.seo_test_runs to service_role;

-- ---------------------------------------------------------------------------
-- CLAIM: lock, stamp, busy, cool-down, prune
-- ---------------------------------------------------------------------------
-- The lock is taken BEFORE anything is counted, or two concurrent claims both see "nothing
-- running" and both pass (the brand-colour cap learned that, 20260924120000). The second
-- waiter's queries run after the first commits, and plpgsql takes a fresh snapshot per
-- statement, so it sees the first claim and is refused as busy.
--
-- A running row older than 5 minutes is a run whose process died (a killed dev server, a
-- serverless timeout). It is marked `failed` here so it cannot wedge the artist forever; 5
-- minutes is well past the longest run (a publish run waits up to ~90 s for the site, then
-- has a 90 s budget).
--
-- `check_violation` + a message PREFIX (`seo_test_busy`, `seo_test_cooldown`) is what store.ts
-- maps to "a test is already running" / "tested a moment ago".
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
  last_start timestamptz;
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  -- WHO FIRST. A BEFORE trigger runs before the insert policy's WITH CHECK, so without this a
  -- signed-in stranger's claim would reach the busy / cool-down answers below and learn when
  -- another artist was last tested (the artist id is in every public payload). RLS would
  -- still refuse the row, and the rollback would undo the prune, but the ANSWER would leak.
  -- No claims at all = not a PostgREST request (the owner, a migration): allowed. The service
  -- role (a future scheduled run) is allowed; anon never gets here (no table grant).
  if claims is not null
     and coalesce(claims ->> 'role', '') <> 'service_role'
     and not (public.is_admin() or public.is_manager_of(new.artist_id)) then
    raise exception 'permission denied: not a manager of this artist'
      using errcode = 'insufficient_privilege';
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

  update public.seo_test_runs
     set status = 'failed', note = 'This test stopped before it finished.'
   where artist_id = new.artist_id
     and status = 'running'
     and ran_at < clock_timestamp() - stale;

  if exists (select 1 from public.seo_test_runs where artist_id = new.artist_id and status = 'running') then
    raise exception 'seo_test_busy: a test is already running for this artist'
      using errcode = 'check_violation';
  end if;

  -- The cool-down is for "Test again". A publish's run is never refused by it (a manager who
  -- tested and then published should see the publish tested), and a scheduled run is spaced
  -- by its schedule.
  if new.trigger = 'manual' then
    select max(r.ran_at) into last_start from public.seo_test_runs r where r.artist_id = new.artist_id;
    if last_start is not null and last_start > clock_timestamp() - cooldown then
      raise exception 'seo_test_cooldown: try again in % s',
        greatest(1, ceil(extract(epoch from (last_start + cooldown - clock_timestamp())))::int)
        using errcode = 'check_violation';
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
-- FINISH: a running row becomes done/failed exactly once; the counts are derived
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
  -- Who, when and why a run started never change.
  new.artist_id := old.artist_id;
  new.ran_at := old.ran_at;
  new.trigger := old.trigger;
  if new.status = 'running' then
    new.results := old.results;
    return new;
  end if;
  new.finished_at := now();
  if new.status = 'failed' then
    new.results := '[]'::jsonb;
  end if;
  if jsonb_typeof(new.results) = 'array' then
    select count(*)::int,
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

-- `public, anon` only, as for enforce_brand_color_cap: they fire on a MANAGER's write, and a
-- trigger function is not callable through PostgREST whatever its grant. `npm run
-- audit:grants` then lists neither.
revoke all on function public.seo_test_runs_claim() from public, anon;
revoke all on function public.seo_test_runs_finish() from public, anon;
