-- A DAILY series per event type, so a metric can carry its own sparkline.
--
-- `analytics_summary` already answers "how many plays in this window", and
-- `analytics_timeline` answers "how many views on each day". Nothing answered
-- "how many plays on each day", which is exactly what a sparkline inside a
-- metric pill draws. The tally has existed since the roll-up was written
-- (`analytics.daily_type`); it simply had no door.
--
-- The shape copies `analytics_timeline` deliberately:
--
--   * tallies for the days the ledger says are rolled,
--   * the raw table for the days it does not,
--   * and never both arms for the same day, or today would be counted twice.
--
-- The raw arm repeats the roll-up's own filter (`not is_bot`, every type) so a
-- day's numbers cannot change merely by being rolled up overnight. If that
-- filter ever drifts from `roll_up_analytics`, the reader starts lying on the
-- boundary between rolled and unrolled days and nothing else would say so —
-- `tests/integration/analytics/type-timeline.test.ts` pins the two together.

drop function if exists public.analytics_type_timeline(uuid, date, date);
create function public.analytics_type_timeline(p_artist_id uuid, p_since date, p_until date)
returns table (day date, type text, count bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select t.day, t.type, t.count::bigint
  from analytics.daily_type t
  where t.artist_id = p_artist_id
    and t.day between p_since and p_until
    and exists (select 1 from analytics.rolled_days r where r.day = t.day)
  union all
  select (e.created_at at time zone 'UTC')::date, e.type, count(*)
  from public.analytics_events e
  where e.artist_id = p_artist_id
    and not e.is_bot
    and e.created_at >= (p_since::timestamp at time zone 'UTC')
    and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
    and not exists (
      select 1 from analytics.rolled_days r
      where r.day = (e.created_at at time zone 'UTC')::date
    )
  group by (e.created_at at time zone 'UTC')::date, e.type
  order by 1, 2
$$;

-- Manager-facing: signed-in users (RLS decides which artists they see) and the
-- service key. NEVER anon.
--
-- `revoke all ... from public` on its own would leave this open to anon, because
-- Supabase's default privileges grant EXECUTE on every new function to anon,
-- authenticated and service_role BY ROLE, and the PUBLIC pseudo-role is not any
-- of them. That is how `record_event_v2` shipped anon-callable for four minutes
-- and four analytics readers for weeks. `npm run audit:grants` is the check.
revoke all on function public.analytics_type_timeline(uuid, date, date) from public, anon;
grant execute on function public.analytics_type_timeline(uuid, date, date) to authenticated, service_role;
