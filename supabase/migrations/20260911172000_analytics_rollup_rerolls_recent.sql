-- roll_up_pending re-rolls the two most recent complete days on every run.
--
-- WHY. Once a day is in `analytics.rolled_days` the readers trust its tallies and stop
-- looking at raw rows for it. A row that arrives for yesterday AFTER the nightly roll-up
-- (a fan's tab flushing late, clock skew, a retried send) was therefore invisible for
-- good: the day was "done" and nothing would ever count it. Seen first as a test
-- artefact (tests/integration/analytics/context.test.ts, 2026-09-11) — a day already in
-- the ledger showed a fresh artist's raw rows as nothing — but the production shape is
-- the same. roll_up_analytics is idempotent, so re-rolling costs one small delete +
-- insert per day and can never double-count.
create or replace function public.roll_up_pending(p_max_days integer default 120)
returns integer
language plpgsql
security invoker
set search_path = public, analytics
as $$
declare
  first_day date;
  d date;
  yesterday date := (now() at time zone 'UTC')::date - 1;
  n integer := 0;
begin
  select min((created_at at time zone 'UTC')::date) into first_day from public.analytics_events;
  if first_day is null then return 0; end if;
  first_day := greatest(first_day, yesterday - p_max_days);
  for d in select generate_series(first_day, yesterday, interval '1 day')::date loop
    -- Unrolled days, plus the last two complete days regardless (late arrivals).
    if d >= yesterday - 1 or not exists (select 1 from analytics.rolled_days where day = d) then
      perform public.roll_up_analytics(d);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.roll_up_pending(integer) from public, anon, authenticated;
grant execute on function public.roll_up_pending(integer) to service_role;
