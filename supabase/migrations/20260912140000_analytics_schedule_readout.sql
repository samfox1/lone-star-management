-- `analytics_schedule()` — is the nightly analytics maintenance actually running?
--
-- The schedule in 20260912130000 is invisible from everywhere else: the `cron` schema is
-- not exposed through PostgREST, so neither the runbook nor a test could tell whether the
-- jobs still exist, still run, or last failed. A schedule nobody can see is a schedule that
-- stops one night and is noticed a month later, when a card starts reading zero.
--
-- It reports, per job: the cron expression, whether it is active, WHO it runs as and
-- WHETHER THAT ROLE BYPASSES RLS — the one assumption the whole schedule rests on, because
-- both functions are `security invoker` and a runner without BYPASSRLS would read zero rows
-- through `analytics_events`'s owner-only policy and write EMPTY tallies over good ones —
-- plus the last run's time, status and message.
--
-- `security definer` here, which is the inverse of the house rule and deliberate: the
-- caller is service_role, which has no `usage` on schema `cron`, and the function must read
-- `cron.job` and `cron.job_run_details`. It returns job metadata only — no artist, no
-- visitor, no tenant data of any kind — so there is nothing for a definer to leak. Granted
-- to service_role alone, in the full revoke form (AGENTS.md).
create or replace function public.analytics_schedule()
returns table (
  jobname       text,
  schedule      text,
  command       text,
  active        boolean,
  runs_as       text,
  bypasses_rls  boolean,
  last_run      timestamptz,
  last_status   text,
  last_message  text
)
language sql
security definer
stable
set search_path = public, cron, pg_catalog
as $$
  select j.jobname::text,
         j.schedule::text,
         j.command::text,
         j.active,
         j.username::text,
         coalesce(r.rolbypassrls, false),
         d.end_time,
         d.status::text,
         left(coalesce(d.return_message, ''), 200)
  from cron.job j
  left join pg_roles r on r.rolname = j.username
  left join lateral (
    select end_time, status, return_message
    from cron.job_run_details x
    where x.jobid = j.jobid
    order by x.start_time desc
    limit 1
  ) d on true
  where j.jobname like 'analytics-%'
  order by j.jobname
$$;

revoke all on function public.analytics_schedule() from public, anon, authenticated;
grant execute on function public.analytics_schedule() to service_role;
