-- ANALYTICS_PAGE_PLAN.md step 2: the event learns WHERE the fan came from, the tallies
-- that keep the page fast, and the readers that stitch raw and tallied days together.
--
-- Four things this migration establishes, in order (A–D):
--
--   A. `analytics_events` gains context columns (path, referrer, source bucket, UTM,
--      location, device, browser, a daily visitor hash, is_bot). All nullable — rows
--      written before today simply have none. Bots are STORED and FLAGGED, never counted:
--      every existing reader is recreated here with `and not is_bot`.
--
--   B. `record_event_v2` — the write path for the Edge Function door (step 3). It is
--      `security invoker` and granted to service_role ONLY, the ADR 0010 inverse: the
--      caller already bypasses RLS, so DEFINER buys nothing, and INVOKER fails closed if
--      the grant is ever widened. `record_event` (the anon door) is untouched until the
--      cut-over (step 5).
--
--   C. Schema `analytics`: one tally row per (artist, day, dimension value) — total,
--      source, place, device, path, campaign, entity — plus the door's working tables
--      (geo_cache, event_attempts) and the `rolled_days` ledger. `roll_up_analytics(day)`
--      is idempotent (delete the day, re-insert). `prune_analytics` deletes raw rows
--      older than the keep window ONLY for days in the ledger, so nothing is ever thrown
--      away before it has been counted.
--
--   D. The readers (`analytics_timeline`, `_sources`, `_places`, `_devices`, `_paths`,
--      `_campaigns`) use TALLIES for days in the ledger and RAW for every other day, so a
--      window straddling the boundary is exact and no day is ever counted twice.
--
-- Amended the same day by 20260911171000 (grants — see its header for the Supabase
-- default-privileges lesson), 20260911172000 (re-roll of recent days) and
-- 20260911180000 (review fixes: pruned-day guard, advisory lock, FK to the ledger, bots
-- counted, `visitor_hash`, `record_site_event`). Read those for the current shape.
--
-- The schema is NOT exposed through PostgREST (db.schemas is unchanged); it is reached
-- only through the `public` RPCs below. Tests therefore assert tally state through the
-- readers — which is also where the values are used.
--
-- Isolation is the same rule as everywhere else: `artist_id` on every row and RLS via
-- is_admin() / is_manager_of(). A schema per artist was considered and rejected
-- (ANALYTICS_PAGE_PLAN.md decision 12).

-- ---------------------------------------------------------------------------
-- A. Context columns + the readers skip bots
-- ---------------------------------------------------------------------------
alter table public.analytics_events
  add column if not exists path          text,
  add column if not exists referrer_host text,
  add column if not exists source        text,
  add column if not exists utm_source    text,
  add column if not exists utm_medium    text,
  add column if not exists utm_campaign  text,
  add column if not exists country       text,
  add column if not exists region        text,
  add column if not exists city          text,
  add column if not exists device        text,
  add column if not exists browser       text,
  add column if not exists visitor       text,
  add column if not exists is_bot        boolean not null default false;

alter table public.analytics_events
  drop constraint if exists analytics_events_country_check,
  add constraint analytics_events_country_check check (country is null or country ~ '^[A-Z]{2}$'),
  drop constraint if exists analytics_events_device_check,
  add constraint analytics_events_device_check check (device is null or device in ('mobile', 'tablet', 'desktop'));

-- The window queries read one artist's recent NON-bot rows; a partial index is the
-- exact shape of that read and skips the flagged rows entirely.
create index if not exists analytics_events_live_idx
  on public.analytics_events (artist_id, created_at)
  where not is_bot;

-- The four existing readers, recreated with the bot filter. Grants are restated in
-- 20260911171000 — `create or replace` keeps existing grants, but the existing grants
-- were wrong (anon still held EXECUTE; see that migration's header).
create or replace function public.analytics_summary(p_artist_id uuid, p_since timestamptz)
returns table (type text, count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select type, count(*)
  from public.analytics_events
  where artist_id = p_artist_id and created_at >= p_since and not is_bot
  group by type
$$;

create or replace function public.analytics_daily(p_since timestamptz, p_artist_id uuid default null)
returns table (artist_id uuid, day date, views bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select artist_id, (created_at at time zone 'UTC')::date as day, count(*)
  from public.analytics_events
  where type = 'view'
    and not is_bot
    and created_at >= p_since
    and (p_artist_id is null or artist_id = p_artist_id)
  group by artist_id, (created_at at time zone 'UTC')::date
$$;

create or replace function public.analytics_by_entity(p_artist_id uuid, p_since timestamptz)
returns table (entity_type text, entity_id uuid, type text, count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select entity_type, entity_id, type, count(*)
  from public.analytics_events
  where artist_id = p_artist_id
    and created_at >= p_since
    and entity_id is not null
    and not is_bot
  group by entity_type, entity_id, type
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
set search_path = public
as $$
  select (created_at at time zone 'UTC')::date as day, count(*)
  from public.analytics_events
  where artist_id = p_artist_id
    and entity_id = any(p_entity_ids)
    and created_at >= p_since
    and not is_bot
  group by (created_at at time zone 'UTC')::date
$$;

-- ---------------------------------------------------------------------------
-- B. record_event_v2 — the door's write path. service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.record_event_v2(
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
  p_visitor       text default null,
  p_is_bot        boolean default false
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
begin
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;

  -- Burst caps, per artist. Real and flagged traffic are capped SEPARATELY, so a bot
  -- flood can neither fill the table nor crowd out the fans behind it. The door's per-IP
  -- cap (step 3) is the first line; this is the floor under it.
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
    country, region, city, device, browser, visitor, is_bot
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
    nullif(left(coalesce(p_visitor, ''), 64), ''),
    bot
  );
end;
$$;

revoke all on function public.record_event_v2(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.record_event_v2(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- C. Schema analytics: tallies, working tables, roll-up, prune
-- ---------------------------------------------------------------------------
create schema if not exists analytics;
grant usage on schema analytics to authenticated, service_role;

-- Tally dimensions are NOT NULL with '' standing for "unknown", so each table's primary
-- key is a plain composite and the roll-up's delete-then-insert is exact.
create table if not exists analytics.daily_total (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null,
  views     integer not null,
  visitors  integer not null,
  primary key (artist_id, day)
);
create table if not exists analytics.daily_source (
  artist_id     uuid not null references public.artists (id) on delete cascade,
  day           date not null,
  source        text not null,
  referrer_host text not null,
  views         integer not null,
  visitors      integer not null,
  primary key (artist_id, day, source, referrer_host)
);
create table if not exists analytics.daily_place (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null,
  country   text not null,
  region    text not null,
  city      text not null,
  views     integer not null,
  visitors  integer not null,
  primary key (artist_id, day, country, region, city)
);
create table if not exists analytics.daily_device (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null,
  device    text not null,
  browser   text not null,
  views     integer not null,
  visitors  integer not null,
  primary key (artist_id, day, device, browser)
);
create table if not exists analytics.daily_path (
  artist_id uuid not null references public.artists (id) on delete cascade,
  day       date not null,
  path      text not null,
  views     integer not null,
  visitors  integer not null,
  primary key (artist_id, day, path)
);
create table if not exists analytics.daily_campaign (
  artist_id    uuid not null references public.artists (id) on delete cascade,
  day          date not null,
  utm_source   text not null,
  utm_medium   text not null,
  utm_campaign text not null,
  views        integer not null,
  visitors     integer not null,
  primary key (artist_id, day, utm_source, utm_medium, utm_campaign)
);
create table if not exists analytics.daily_entity (
  artist_id   uuid not null references public.artists (id) on delete cascade,
  day         date not null,
  entity_type text not null,
  entity_id   uuid not null,
  type        text not null,
  count       integer not null,
  primary key (artist_id, day, entity_type, entity_id, type)
);

-- Days whose tallies are authoritative. The readers switch from raw to tallies on
-- membership here; prune deletes raw only for members.
create table if not exists analytics.rolled_days (
  day       date primary key,
  rolled_at timestamptz not null default now()
);

-- The door's working tables. service_role only: no grant to authenticated, no policy.
create table if not exists analytics.geo_cache (
  ip_hash    text primary key,
  country    text,
  region     text,
  city       text,
  fetched_at timestamptz not null default now()
);
create table if not exists analytics.event_attempts (
  ip_hash text not null,
  minute  timestamptz not null,
  count   integer not null default 0,
  primary key (ip_hash, minute)
);

-- Owner-read on every tally, the analytics_events rule verbatim.
do $$
declare t text;
begin
  foreach t in array array['daily_total', 'daily_source', 'daily_place', 'daily_device', 'daily_path', 'daily_campaign', 'daily_entity']
  loop
    execute format('alter table analytics.%I enable row level security', t);
    execute format('drop policy if exists %I on analytics.%I', t || '_read', t);
    execute format(
      'create policy %I on analytics.%I for select using (public.is_admin() or public.is_manager_of(artist_id))',
      t || '_read', t
    );
    execute format('grant select on analytics.%I to authenticated', t);
  end loop;
end $$;

alter table analytics.rolled_days    enable row level security;
alter table analytics.geo_cache      enable row level security;
alter table analytics.event_attempts enable row level security;
-- rolled_days is read by the readers (as authenticated) to pick raw vs tally per day.
-- It carries no artist data, so a plain true policy is correct.
drop policy if exists rolled_days_read on analytics.rolled_days;
create policy rolled_days_read on analytics.rolled_days for select using (true);
grant select on analytics.rolled_days to authenticated;

grant all on all tables in schema analytics to service_role;
alter default privileges in schema analytics grant all on tables to service_role;

-- roll_up_analytics(day): idempotent. Refuses today and the future — an incomplete day
-- must keep reading raw, or it would undercount until the next roll-up.
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
  if p_day >= (now() at time zone 'UTC')::date then
    return;
  end if;

  delete from analytics.daily_total    where day = p_day;
  delete from analytics.daily_source   where day = p_day;
  delete from analytics.daily_place    where day = p_day;
  delete from analytics.daily_device   where day = p_day;
  delete from analytics.daily_path     where day = p_day;
  delete from analytics.daily_campaign where day = p_day;
  delete from analytics.daily_entity   where day = p_day;

  insert into analytics.daily_total (artist_id, day, views, visitors)
  select artist_id, p_day, count(*), count(distinct visitor)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id;

  insert into analytics.daily_source (artist_id, day, source, referrer_host, views, visitors)
  select artist_id, p_day, coalesce(source, ''), coalesce(referrer_host, ''), count(*), count(distinct visitor)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(source, ''), coalesce(referrer_host, '');

  insert into analytics.daily_place (artist_id, day, country, region, city, views, visitors)
  select artist_id, p_day, coalesce(country, ''), coalesce(region, ''), coalesce(city, ''), count(*), count(distinct visitor)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(country, ''), coalesce(region, ''), coalesce(city, '');

  insert into analytics.daily_device (artist_id, day, device, browser, views, visitors)
  select artist_id, p_day, coalesce(device, ''), coalesce(browser, ''), count(*), count(distinct visitor)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(device, ''), coalesce(browser, '');

  insert into analytics.daily_path (artist_id, day, path, views, visitors)
  select artist_id, p_day, coalesce(path, ''), count(*), count(distinct visitor)
  from public.analytics_events
  where type = 'view' and not is_bot and created_at >= d0 and created_at < d1
  group by artist_id, coalesce(path, '');

  insert into analytics.daily_campaign (artist_id, day, utm_source, utm_medium, utm_campaign, views, visitors)
  select artist_id, p_day, coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, ''), count(*), count(distinct visitor)
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

  insert into analytics.rolled_days (day, rolled_at) values (p_day, now())
  on conflict (day) do update set rolled_at = now();
end;
$$;

-- roll_up_pending(): every complete day not yet in the ledger, from the oldest raw row
-- (or p_max_days back, whichever is later) to yesterday. What the schedule calls.
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
    if not exists (select 1 from analytics.rolled_days where day = d) then
      perform public.roll_up_analytics(d);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- prune_analytics(keep): raw rows older than the window, ONLY for days already tallied.
-- Also expires the door's working tables. Bot rows are pruned on the same rule — they
-- were counted (as bots) at roll-up, and the tallies are what the page reads.
create or replace function public.prune_analytics(p_keep interval default interval '90 days')
returns integer
language plpgsql
security invoker
set search_path = public, analytics
as $$
declare
  n integer;
begin
  delete from public.analytics_events e
  where e.created_at < now() - p_keep
    and (e.created_at at time zone 'UTC')::date in (select day from analytics.rolled_days);
  get diagnostics n = row_count;
  delete from analytics.event_attempts where minute < now() - interval '1 day';
  delete from analytics.geo_cache where fetched_at < now() - interval '2 days';
  return n;
end;
$$;

revoke all on function public.roll_up_analytics(date) from public;
revoke all on function public.roll_up_pending(integer) from public;
revoke all on function public.prune_analytics(interval) from public;
grant execute on function public.roll_up_analytics(date) to service_role;
grant execute on function public.roll_up_pending(integer) to service_role;
grant execute on function public.prune_analytics(interval) to service_role;

-- ---------------------------------------------------------------------------
-- D. Readers: tallies for rolled days, raw for the rest. Owner-read via RLS on both.
-- `visitors` over a window is the SUM of daily visitors (each day's distinct hashes) —
-- the only definition a daily-rotating hash supports, and the one Plausible-style tools
-- report. Rows written before this migration have no hash and count 0 visitors.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_timeline(p_artist_id uuid, p_since date, p_until date)
returns table (day date, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select t.day, t.views::bigint, t.visitors::bigint
  from analytics.daily_total t
  where t.artist_id = p_artist_id and t.day between p_since and p_until
  union all
  select (e.created_at at time zone 'UTC')::date, count(*), count(distinct e.visitor)
  from public.analytics_events e
  where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
    and e.created_at >= (p_since::timestamp at time zone 'UTC')
    and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
    and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
  group by (e.created_at at time zone 'UTC')::date
  order by 1
$$;

create or replace function public.analytics_sources(p_artist_id uuid, p_since date, p_until date)
returns table (source text, referrer_host text, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select source, referrer_host, sum(views)::bigint, sum(visitors)::bigint from (
    select t.source, t.referrer_host, t.views::bigint as views, t.visitors::bigint as visitors
    from analytics.daily_source t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
    union all
    select coalesce(e.source, ''), coalesce(e.referrer_host, ''), count(*), count(distinct e.visitor)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.source, ''), coalesce(e.referrer_host, '')
  ) u
  group by source, referrer_host
  order by 3 desc
$$;

create or replace function public.analytics_places(p_artist_id uuid, p_since date, p_until date)
returns table (country text, region text, city text, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select country, region, city, sum(views)::bigint, sum(visitors)::bigint from (
    select t.country, t.region, t.city, t.views::bigint as views, t.visitors::bigint as visitors
    from analytics.daily_place t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
    union all
    select coalesce(e.country, ''), coalesce(e.region, ''), coalesce(e.city, ''), count(*), count(distinct e.visitor)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.country, ''), coalesce(e.region, ''), coalesce(e.city, '')
  ) u
  group by country, region, city
  order by 4 desc
$$;

create or replace function public.analytics_devices(p_artist_id uuid, p_since date, p_until date)
returns table (device text, browser text, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select device, browser, sum(views)::bigint, sum(visitors)::bigint from (
    select t.device, t.browser, t.views::bigint as views, t.visitors::bigint as visitors
    from analytics.daily_device t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
    union all
    select coalesce(e.device, ''), coalesce(e.browser, ''), count(*), count(distinct e.visitor)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.device, ''), coalesce(e.browser, '')
  ) u
  group by device, browser
  order by 3 desc
$$;

create or replace function public.analytics_paths(p_artist_id uuid, p_since date, p_until date)
returns table (path text, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select path, sum(views)::bigint, sum(visitors)::bigint from (
    select t.path, t.views::bigint as views, t.visitors::bigint as visitors
    from analytics.daily_path t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
    union all
    select coalesce(e.path, ''), count(*), count(distinct e.visitor)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.path, '')
  ) u
  group by path
  order by 2 desc
$$;

create or replace function public.analytics_campaigns(p_artist_id uuid, p_since date, p_until date)
returns table (utm_source text, utm_medium text, utm_campaign text, views bigint, visitors bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select utm_source, utm_medium, utm_campaign, sum(views)::bigint, sum(visitors)::bigint from (
    select t.utm_source, t.utm_medium, t.utm_campaign, t.views::bigint as views, t.visitors::bigint as visitors
    from analytics.daily_campaign t
    where t.artist_id = p_artist_id and t.day between p_since and p_until
    union all
    select coalesce(e.utm_source, ''), coalesce(e.utm_medium, ''), coalesce(e.utm_campaign, ''), count(*), count(distinct e.visitor)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and (e.utm_source is not null or e.utm_medium is not null or e.utm_campaign is not null)
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and (e.created_at at time zone 'UTC')::date not in (select day from analytics.rolled_days)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.utm_source, ''), coalesce(e.utm_medium, ''), coalesce(e.utm_campaign, '')
  ) u
  group by utm_source, utm_medium, utm_campaign
  order by 4 desc
$$;

do $$
declare fn text;
begin
  foreach fn in array array['analytics_timeline', 'analytics_sources', 'analytics_places', 'analytics_devices', 'analytics_paths', 'analytics_campaigns']
  loop
    execute format('revoke all on function public.%I(uuid, date, date) from public', fn);
    execute format('grant execute on function public.%I(uuid, date, date) to authenticated', fn);
  end loop;
end $$;
