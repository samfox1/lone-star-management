-- Where a city IS, so the map and globe can draw it (ANALYTICS_PAGE_PLAN.md step 6, the v24
-- mock's Places pane; Sam, 2026-09-14).
--
-- ipinfo answers with `loc: "43.0389,-87.9065"` — the CITY's centroid, never the visitor's
-- own position — and the door threw it away because nothing stored it. Now:
--   analytics_events.lat / lon   the point per view, written by record_site_event
--   analytics.geo_cache.lat / lon  cached with the place, so a cache hit carries it too
--   analytics.daily_place.lat / lon  the tally keeps the mean point per place per day
--   analytics_places(...)          returns lat / lon beside country / region / city
-- Every column is nullable: rows before today, cache entries before today, and visits
-- ipinfo could not place have no point, and the table still counts them.
--
-- Signatures change on four functions. Each is DROPPED first: `create or replace` with new
-- arguments would leave the old one beside it as a second overload. The door calls every
-- one with NAMED arguments, so between this push and the door's redeploy the old call
-- shape still resolves (the new parameters default to null).

alter table public.analytics_events
  add column if not exists lat double precision,
  add column if not exists lon double precision;
alter table analytics.geo_cache
  add column if not exists lat double precision,
  add column if not exists lon double precision;
alter table analytics.daily_place
  add column if not exists lat double precision,
  add column if not exists lon double precision;

-- ---------------------------------------------------------------------------
-- The geo cache carries the point.
-- ---------------------------------------------------------------------------
drop function if exists public.lookup_geo_cache(text);
create function public.lookup_geo_cache(p_ip_hash text)
returns table (country text, region text, city text, lat double precision, lon double precision)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select g.country, g.region, g.city, g.lat, g.lon
  from analytics.geo_cache g
  where g.ip_hash = p_ip_hash and g.fetched_at > now() - interval '2 days'
$$;

drop function if exists public.cache_geo(text, text, text, text);
create function public.cache_geo(
  p_ip_hash text, p_country text, p_region text, p_city text,
  p_lat double precision default null, p_lon double precision default null
)
returns void
language sql
security invoker
set search_path = public, analytics
as $$
  insert into analytics.geo_cache (ip_hash, country, region, city, lat, lon, fetched_at)
  values (p_ip_hash, p_country, p_region, p_city, p_lat, p_lon, now())
  on conflict (ip_hash) do update
    set country = excluded.country, region = excluded.region, city = excluded.city,
        lat = excluded.lat, lon = excluded.lon, fetched_at = now()
$$;

revoke all on function public.lookup_geo_cache(text) from public, anon, authenticated;
revoke all on function public.cache_geo(text, text, text, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.lookup_geo_cache(text) to service_role;
grant execute on function public.cache_geo(text, text, text, text, double precision, double precision) to service_role;

-- ---------------------------------------------------------------------------
-- record_site_event takes the point. Body unchanged from 20260911180000 apart from the
-- two columns; a point outside the globe is dropped, the row is still written.
-- ---------------------------------------------------------------------------
drop function if exists public.record_site_event(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean);
create function public.record_site_event(
  p_slug          text,
  p_type          text,
  p_target        text default null,
  p_entity_id     uuid default null,
  p_entity_type   text default null,
  p_path          text default null,
  p_referrer_host text default null,
  p_source        text default null,
  p_utm_source    text default null,
  p_utm_medium    text default null,
  p_utm_campaign  text default null,
  p_country       text default null,
  p_region        text default null,
  p_city          text default null,
  p_device        text default null,
  p_browser       text default null,
  p_visitor_hash  text default null,
  p_is_bot        boolean default false,
  p_lat           double precision default null,
  p_lon           double precision default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  aid uuid;
  etype text;
  eid uuid;
  recent int;
  bot boolean := coalesce(p_is_bot, false);
  on_globe boolean := p_lat between -90 and 90 and p_lon between -180 and 180;
begin
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;

  -- Burst caps, per artist, real and flagged traffic SEPARATELY: a bot flood can neither
  -- fill the table nor crowd out the fans behind it. The door's per-IP cap is the first
  -- line; this is the floor under it.
  if bot then
    select count(*) into recent from public.analytics_events
    where artist_id = aid and is_bot and created_at > now() - interval '1 minute';
    if recent >= 60 then return; end if;
  else
    select count(*) into recent from public.analytics_events
    where artist_id = aid and not is_bot and created_at > now() - interval '1 minute';
    if recent >= 120 then return; end if;
  end if;

  if p_entity_type in ('release', 'track', 'merch', 'video', 'tour_date', 'link') then
    etype := p_entity_type;
    eid := p_entity_id;
  else
    etype := null;
    eid := null;
  end if;

  insert into public.analytics_events (
    artist_id, type, target, entity_id, entity_type,
    path, referrer_host, source, utm_source, utm_medium, utm_campaign,
    country, region, city, device, browser, visitor_hash, is_bot, lat, lon
  ) values (
    aid, p_type, nullif(left(coalesce(p_target, ''), 200), ''), eid, etype,
    nullif(left(coalesce(p_path, ''), 200), ''),
    nullif(left(lower(coalesce(p_referrer_host, '')), 200), ''),
    nullif(left(lower(coalesce(p_source, '')), 40), ''),
    nullif(left(coalesce(p_utm_source, ''), 100), ''),
    nullif(left(coalesce(p_utm_medium, ''), 100), ''),
    nullif(left(coalesce(p_utm_campaign, ''), 100), ''),
    case when upper(coalesce(p_country, '')) ~ '^[A-Z]{2}$' then upper(p_country) else null end,
    nullif(left(coalesce(p_region, ''), 100), ''),
    nullif(left(coalesce(p_city, ''), 100), ''),
    case when p_device in ('mobile', 'tablet', 'desktop') then p_device else null end,
    nullif(left(lower(coalesce(p_browser, '')), 40), ''),
    nullif(left(coalesce(p_visitor_hash, ''), 64), ''),
    bot,
    case when on_globe then p_lat end,
    case when on_globe then p_lon end
  );
end;
$$;

revoke all on function public.record_site_event(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, double precision, double precision) from public, anon, authenticated;
grant execute on function public.record_site_event(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, double precision, double precision) to service_role;

-- ---------------------------------------------------------------------------
-- The roll-up keeps the point. Everything else is unchanged from 20260913230000.
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

  -- The place's point is the mean of what ipinfo gave for it: one city centroid in the
  -- common case, and a fair middle when two IPs of one city were placed a street apart.
  insert into analytics.daily_place (artist_id, day, country, region, city, views, visitors, lat, lon)
  select artist_id, p_day, coalesce(country, ''), coalesce(region, ''), coalesce(city, ''), count(*), count(distinct visitor_hash),
         avg(lat), avg(lon)
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
-- The reader returns the point. Same two arms as before; the point is the mean over
-- whatever days answered, so a day never moves when the roll-up reaches it.
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_places(uuid, date, date);
create function public.analytics_places(p_artist_id uuid, p_since date, p_until date)
returns table (country text, region text, city text, views bigint, visitors bigint, lat double precision, lon double precision)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select country, region, city, sum(views)::bigint, sum(visitors)::bigint, avg(lat), avg(lon) from (
    select t.country, t.region, t.city, t.views::bigint as views, t.visitors::bigint as visitors, t.lat, t.lon
    from analytics.daily_place t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.country, ''), coalesce(e.region, ''), coalesce(e.city, ''), count(*), count(distinct e.visitor_hash), avg(e.lat), avg(e.lon)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.country, ''), coalesce(e.region, ''), coalesce(e.city, '')
  ) u
  group by country, region, city
  order by 4 desc, 1, 2, 3
$$;

revoke all on function public.analytics_places(uuid, date, date) from public, anon;
grant execute on function public.analytics_places(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: re-roll every day whose raw rows are still here, so the tallies carry the
-- point for today's rows once today rolls. Idempotent; pruned days are skipped.
-- ---------------------------------------------------------------------------
do $$
declare d date;
begin
  for d in select day from analytics.rolled_days where pruned_at is null order by day loop
    perform public.roll_up_analytics(d);
  end loop;
end
$$;
