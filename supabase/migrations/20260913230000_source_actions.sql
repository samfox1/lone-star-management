-- What visitors from each source went on to DO (ADR 0012; the sources card).
--
-- The sources card could say how many came from Instagram and nothing about what they
-- did next, because no tally joined a source to an event type: `daily_source` counts
-- views, `daily_type` counts events, and neither knows the other. The raw rows carry
-- both (the bridge sends `document.referrer` with every event, and on 2026-09-13 a
-- non-view event's source matched its visitor's view 107 times in 108), so the join is
-- honest — it just needed a tally so the answer outlives the 90-day prune.
--
-- `analytics.daily_source_type`: one row per (artist, day, source, type) for every
-- NON-VIEW, non-bot event, with the event count AND the distinct visitors behind it.
-- The card's sentence is built from the visitors ("1 in 4 plays a song"), not the
-- count: one person playing ten times in a day is one listener. Visitors are
-- daily-distinct like every other tally (the hash rotates daily), so a window sums
-- days on both sides of every ratio.
--
-- Backfill: every rolled day that still has its raw rows is re-rolled at the bottom, so
-- the last 90 days appear at once. Pruned days cannot be rebuilt and are skipped.

create table if not exists analytics.daily_source_type (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null references analytics.rolled_days (day) on delete cascade,
  source    text not null,
  type      text not null,
  count     integer not null,
  visitors  integer not null,
  primary key (artist_id, day, source, type)
);

alter table analytics.daily_source_type enable row level security;
drop policy if exists daily_source_type_read on analytics.daily_source_type;
create policy daily_source_type_read on analytics.daily_source_type
  for select using (public.is_admin() or public.is_manager_of(artist_id));
grant select on analytics.daily_source_type to authenticated;
grant all on analytics.daily_source_type to service_role;

-- ---------------------------------------------------------------------------
-- The roll-up writes it. Everything else is unchanged from 20260912120000.
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

  delete from analytics.daily_total       where day = p_day;
  delete from analytics.daily_type        where day = p_day;
  delete from analytics.daily_source      where day = p_day;
  delete from analytics.daily_source_type where day = p_day;
  delete from analytics.daily_place       where day = p_day;
  delete from analytics.daily_device      where day = p_day;
  delete from analytics.daily_path        where day = p_day;
  delete from analytics.daily_campaign    where day = p_day;
  delete from analytics.daily_entity      where day = p_day;

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

  -- What each source's visitors did: every non-view event, by source, with the
  -- distinct visitors behind it. Views live in daily_source above.
  insert into analytics.daily_source_type (artist_id, day, source, type, count, visitors)
  select artist_id, p_day, coalesce(source, ''), type, count(*), count(distinct visitor_hash)
  from public.analytics_events
  where type <> 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(source, ''), type;

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
-- The reader: tallies for rolled days, raw for the rest, whole UTC days, same
-- filters in both arms so a day never moves when the roll-up reaches it.
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_source_types(uuid, date, date);
create function public.analytics_source_types(p_artist_id uuid, p_since date, p_until date)
returns table (source text, type text, count bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select source, type, sum(count)::bigint, sum(visitors)::bigint from (
    select t.source, t.type, t.count::bigint as count, t.visitors::bigint as visitors
    from analytics.daily_source_type t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.source, ''), e.type, count(*), count(distinct e.visitor_hash)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type <> 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.source, ''), e.type
  ) u
  group by source, type
  order by 3 desc, 1, 2
$$;

revoke all on function public.analytics_source_types(uuid, date, date) from public, anon;
grant execute on function public.analytics_source_types(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: re-roll every day whose raw rows are still here. Idempotent.
-- ---------------------------------------------------------------------------
do $$
declare d date;
begin
  for d in select day from analytics.rolled_days where pruned_at is null order by day loop
    perform public.roll_up_analytics(d);
  end loop;
end
$$;
