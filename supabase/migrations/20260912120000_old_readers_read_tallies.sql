-- Step 4's PREREQUISITE (ANALYTICS_PAGE_PLAN.md; ADR 0012 consequences; review finding S4):
-- the four readers that predate the tally layer still read raw rows only, so the day prune
-- is scheduled, every dashboard number for a window longer than the raw window starts
-- undercounting — silently, and worse each day. Nothing may schedule prune until this
-- migration is in place.
--
-- WHAT WAS MISSING. `analytics.daily_total` counts views only; `analytics.daily_entity`
-- counts only events carrying an entity. An event that is neither — a `play` with no track
-- id, a `ticket_click` from an older site build — appears in no tally at all. There are 265
-- such rows in the last 90 days today, so `analytics_summary` cannot be rebuilt from what
-- exists. Hence `analytics.daily_type`: one row per (artist, day, type), every non-bot
-- event counted exactly once. `daily_total` keeps its own `views`/`visitors`/`bots` because
-- the timeline needs distinct visitors, which no per-type roll-up can give.
--
-- WINDOWS ARE NOW WHOLE UTC DAYS, in both halves of every reader. This is the point, not a
-- side effect: a tally is day-granular, so if the raw half honoured the exact `p_since`
-- timestamp while the tally half counted whole days, the SAME query would answer
-- differently before and after a day was rolled up. Day-granular on both sides means the
-- answer never moves. Callers ask for "30 days" and get 30 whole days; a few extra hours on
-- the first day is the honest reading of a daily figure.
--
-- PRUNED DAYS CANNOT BE REBUILT. A day already stamped `pruned_at` has no raw rows left, so
-- it gets no `daily_type` row and `analytics_summary` cannot see it. Every pruned day today
-- is a test fixture from 2017–2024; no real day has been pruned. The re-roll at the bottom
-- fills every day that still has its raw rows.

-- ---------------------------------------------------------------------------
-- A. The missing tally
-- ---------------------------------------------------------------------------
create table if not exists analytics.daily_type (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null references analytics.rolled_days (day) on delete cascade,
  type      text not null,
  count     integer not null,
  primary key (artist_id, day, type)
);

alter table analytics.daily_type enable row level security;
drop policy if exists daily_type_read on analytics.daily_type;
create policy daily_type_read on analytics.daily_type
  for select using (public.is_admin() or public.is_manager_of(artist_id));
grant select on analytics.daily_type to authenticated;
grant all on analytics.daily_type to service_role;

-- ---------------------------------------------------------------------------
-- B. The roll-up writes it. Everything else here is unchanged from 20260911180000.
-- ---------------------------------------------------------------------------
create or replace function public.roll_up_analytics(p_day date)
returns void
language plpgsql
security invoker
set search_path = public, analytics
as $$
declare
  d0 timestamptz := (p_day::timestamp at time zone 'UTC');
  d1 timestamptz := ((p_day + 1)::timestamp at time zone 'UTC');
begin
  -- An incomplete day must keep reading raw, or it undercounts until the next roll-up.
  if p_day >= (now() at time zone 'UTC')::date then
    return;
  end if;

  -- One roll-up per day at a time. The second caller waits, then redoes an idempotent job.
  perform pg_advisory_xact_lock(hashtext('analytics.roll_up'), p_day - date '2000-01-01');

  -- Raw rows for this day are gone; rebuilding from them would erase the tallies.
  if exists (select 1 from analytics.rolled_days where day = p_day and pruned_at is not null) then
    return;
  end if;

  -- Ledger FIRST: the tallies reference it, and the readers switch on it.
  insert into analytics.rolled_days (day, rolled_at) values (p_day, now())
  on conflict (day) do update set rolled_at = now();

  delete from analytics.daily_total    where day = p_day;
  delete from analytics.daily_type     where day = p_day;
  delete from analytics.daily_source   where day = p_day;
  delete from analytics.daily_place    where day = p_day;
  delete from analytics.daily_device   where day = p_day;
  delete from analytics.daily_path     where day = p_day;
  delete from analytics.daily_campaign where day = p_day;
  delete from analytics.daily_entity   where day = p_day;

  insert into analytics.daily_total (artist_id, day, views, visitors, bots)
  select artist_id, p_day,
         count(*) filter (where not is_bot),
         count(distinct visitor_hash) filter (where not is_bot),
         count(*) filter (where is_bot)
  from public.analytics_events
  where type = 'view' and created_at >= d0 and created_at < d1
  group by artist_id;

  -- EVERY type, entity or not — the one tally `analytics_summary` can be rebuilt from.
  insert into analytics.daily_type (artist_id, day, type, count)
  select artist_id, p_day, type, count(*)
  from public.analytics_events
  where not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, type;

  insert into analytics.daily_source (artist_id, day, source, referrer_host, views, visitors)
  select artist_id, p_day, coalesce(source, ''), coalesce(referrer_host, ''), count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(source, ''), coalesce(referrer_host, '');

  insert into analytics.daily_place (artist_id, day, country, region, city, views, visitors)
  select artist_id, p_day, coalesce(country, ''), coalesce(region, ''), coalesce(city, ''), count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(country, ''), coalesce(region, ''), coalesce(city, '');

  insert into analytics.daily_device (artist_id, day, device, browser, views, visitors)
  select artist_id, p_day, coalesce(device, ''), coalesce(browser, ''), count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(device, ''), coalesce(browser, '');

  insert into analytics.daily_path (artist_id, day, path, views, visitors)
  select artist_id, p_day, coalesce(path, ''), count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(path, '');

  insert into analytics.daily_campaign (artist_id, day, utm_source, utm_medium, utm_campaign, views, visitors)
  select artist_id, p_day, coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, ''), count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
    and (utm_source is not null or utm_medium is not null or utm_campaign is not null)
  group by artist_id, coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, '');

  insert into analytics.daily_entity (artist_id, day, entity_type, entity_id, type, count)
  select artist_id, p_day, entity_type, entity_id, type, count(*)
  from public.analytics_events
  where not is_bot and entity_id is not null and entity_type is not null
    and created_at >= d0 and created_at < d1
  group by artist_id, entity_type, entity_id, type;
end;
$$;

revoke all on function public.roll_up_analytics(date) from public, anon, authenticated;
grant execute on function public.roll_up_analytics(date) to service_role;

-- ---------------------------------------------------------------------------
-- C. The four readers: tallies for rolled days, raw for the rest, whole UTC days.
--
-- `create or replace` keeps each signature, so every caller in src/ is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_summary(p_artist_id uuid, p_since timestamptz)
returns table (type text, count bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select u.type, sum(u.n)::bigint
  from (
    select t.type, t.count::bigint as n
    from analytics.daily_type t
    where t.artist_id = p_artist_id
      and t.day >= (p_since at time zone 'UTC')::date
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select e.type, count(*)
    from public.analytics_events e
    where e.artist_id = p_artist_id
      and not e.is_bot
      and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by e.type
  ) u
  group by u.type
$$;

create or replace function public.analytics_daily(p_since timestamptz, p_artist_id uuid default null)
returns table (artist_id uuid, day date, views bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select t.artist_id, t.day, t.views::bigint
  from analytics.daily_total t
  where t.day >= (p_since at time zone 'UTC')::date
    and (p_artist_id is null or t.artist_id = p_artist_id)
    and exists (select 1 from analytics.rolled_days r where r.day = t.day)
  union all
  select e.artist_id, (e.created_at at time zone 'UTC')::date, count(*)
  from public.analytics_events e
  where e.type = 'view'
    and not e.is_bot
    and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
    and (p_artist_id is null or e.artist_id = p_artist_id)
    and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
  group by e.artist_id, (e.created_at at time zone 'UTC')::date
$$;

create or replace function public.analytics_by_entity(p_artist_id uuid, p_since timestamptz)
returns table (entity_type text, entity_id uuid, type text, count bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select u.entity_type, u.entity_id, u.type, sum(u.n)::bigint
  from (
    select t.entity_type, t.entity_id, t.type, t.count::bigint as n
    from analytics.daily_entity t
    where t.artist_id = p_artist_id
      and t.day >= (p_since at time zone 'UTC')::date
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select e.entity_type, e.entity_id, e.type, count(*)
    from public.analytics_events e
    where e.artist_id = p_artist_id
      and e.entity_id is not null
      and e.entity_type is not null
      and not e.is_bot
      and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by e.entity_type, e.entity_id, e.type
  ) u
  group by u.entity_type, u.entity_id, u.type
$$;

create or replace function public.analytics_entity_daily(
  p_artist_id uuid,
  p_entity_ids uuid[],
  p_since timestamptz
)
returns table (day date, count bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select u.day, sum(u.n)::bigint
  from (
    select t.day, t.count::bigint as n
    from analytics.daily_entity t
    where t.artist_id = p_artist_id
      and t.entity_id = any(p_entity_ids)
      and t.day >= (p_since at time zone 'UTC')::date
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select (e.created_at at time zone 'UTC')::date, count(*)
    from public.analytics_events e
    where e.artist_id = p_artist_id
      and e.entity_id = any(p_entity_ids)
      and not e.is_bot
      and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date
  ) u
  group by u.day
$$;

revoke all on function public.analytics_summary(uuid, timestamptz) from public, anon;
revoke all on function public.analytics_daily(timestamptz, uuid) from public, anon;
revoke all on function public.analytics_by_entity(uuid, timestamptz) from public, anon;
revoke all on function public.analytics_entity_daily(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.analytics_summary(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_daily(timestamptz, uuid) to authenticated, service_role;
grant execute on function public.analytics_by_entity(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_entity_daily(uuid, uuid[], timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. Backfill `daily_type` for every already-rolled day that still has its raw rows.
-- Idempotent (roll_up_analytics deletes the day and rebuilds it), and it skips pruned days
-- because the roll-up itself refuses them.
-- ---------------------------------------------------------------------------
do $$
declare d date;
begin
  for d in select day from analytics.rolled_days where pruned_at is null order by day loop
    perform public.roll_up_analytics(d);
  end loop;
end $$;
