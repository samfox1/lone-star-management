-- analytics_summary gains the same optional-artist shape analytics_daily already has,
-- so the roster page can read every owned artist's 30-day summary in ONE round trip
-- instead of one `analytics_summary` call per artist inside `artists.map(async …)`
-- (CODE_AUDIT.md item J; `rosterAnalytics` in src/app/roster-data.ts).
--
-- `analytics_daily(p_since timestamptz, p_artist_id uuid default null)` already supports
-- both call shapes and is called both ways. `analytics_summary(p_artist_id uuid, p_since
-- timestamptz)` never gained the default, so the roster page had no scoped-down way to
-- ask "every artist I manage" in one call and fell back to an N+1.
--
-- The old signature is DROPPED, not left alongside the new one: PostgREST resolves an
-- RPC call by matching argument NAMES against a function's parameters, and every caller
-- (roster-data.ts, tests/integration/analytics/*) already passes both `p_artist_id` and
-- `p_since` as named arguments. Two live overloads that both accept `{p_artist_id,
-- p_since}` would make that call ambiguous ("function is not unique") the moment both
-- exist, so the swap has to be atomic: drop the old shape, create the new one, in the
-- same migration.
--
-- The return row gains `artist_id` so a caller passing no `p_artist_id` can tell which
-- artist each `(type, count)` pair belongs to (group-by, done here instead of in JS, for
-- the same reason `analytics_daily` already returns `artist_id`). Every existing caller
-- passes `p_artist_id` explicitly and keeps getting exactly its own rows back — RLS
-- (`analytics_read` on analytics_events, `daily_type_read` on analytics.daily_type) is
-- what actually scopes a null-artist call to the artists the caller manages, the same way
-- `analytics_daily(p_since, null)` and `ownedArtists()` already rely on it.
drop function if exists public.analytics_summary(uuid, timestamptz);

create or replace function public.analytics_summary(p_since timestamptz, p_artist_id uuid default null)
returns table (artist_id uuid, type text, count bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select u.artist_id, u.type, sum(u.n)::bigint
  from (
    select t.artist_id, t.type, t.count::bigint as n
    from analytics.daily_type t
    where (p_artist_id is null or t.artist_id = p_artist_id)
      and t.day >= (p_since at time zone 'UTC')::date
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select e.artist_id, e.type, count(*)
    from public.analytics_events e
    where (p_artist_id is null or e.artist_id = p_artist_id)
      and not e.is_bot
      and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by e.artist_id, e.type
  ) u
  group by u.artist_id, u.type
$$;

-- Same grants the old signature had (20260911171000): signed-in managers (RLS decides
-- which rows) and service_role. Never anon, never bare PUBLIC — AGENTS.md's grants rule.
revoke all on function public.analytics_summary(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.analytics_summary(timestamptz, uuid) to authenticated, service_role;
