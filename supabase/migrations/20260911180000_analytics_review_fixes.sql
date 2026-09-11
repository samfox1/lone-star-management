-- Step 2 review fixes (REVIEW_2026-09-11_ANALYTICS.md, findings S1–S3, S5, S6, O1, O5, O7).
-- Repairs forward, like 20260804240000 after 20260804230000 — this repo does not squash.
--
--   S1  A day whose raw rows were pruned could be RE-ROLLED, and roll-up rebuilds from raw,
--       so that day's tallies went to zero for every artist. One service call away, and
--       the plan invites re-rolling ("buckets can be recomputed"). The ledger now records
--       `pruned_at`; roll-up refuses a pruned day; prune works in whole UTC days and never
--       touches the last three, so the nightly re-roll of the last two can never meet it.
--   S2  Cron and the door's opportunistic run both re-roll the last two days. Two at once:
--       the loser's insert hits the tally primary key and its whole run rolls back. An
--       advisory lock per day serialises them; the second simply re-does an idempotent job.
--   S3  Tallies are tied to the ledger structurally (FK, cascade) and the ledger row is
--       written FIRST, so a tally row can never exist for a day the readers treat as raw.
--       Both halves of every reader now consult the ledger the same way (`exists`), so a
--       later tightening of the ledger's policy fails LOUDLY (numbers vanish) rather than
--       double-counting.
--   S5  Bots are now COUNTED — as bots — on `daily_total.bots`, so the page can show what
--       was filtered (decision 6: auditable). The prune comment that claimed this already
--       happened was wrong; now it is true.
--   S6  `not in (subquery)` → `not exists`. Same answer today; no NULL cliff later.
--   O5  `record_event_v2` was the repo's first `_v2`. Nothing calls it yet, so it is renamed
--       for its role: `record_site_event`. `record_event` (the anon door) keeps its name
--       until the cut-over drops it.
--   O7  `visitor` → `visitor_hash`, matching `ip_hash` everywhere else a salted hash lives.
--       Reader ordering gains a deterministic tie-break.
--   O1  Two manager RPCs outside analytics still carried Supabase's default anon EXECUTE
--       (`reorder_rows`, `set_release_link`) — RLS-protected, but the grant is wrong and
--       `npm run audit:grants` would flag them forever. Closed here.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.analytics_events rename column visitor to visitor_hash;
alter table analytics.rolled_days add column if not exists pruned_at timestamptz;
alter table analytics.daily_total  add column if not exists bots integer not null default 0;

-- Tallies exist only for ledger days. Every tally row written so far belongs to a ledger
-- day (they are written in the same call), so the constraints validate.
do $$
declare t text;
begin
  foreach t in array array['daily_total', 'daily_source', 'daily_place', 'daily_device', 'daily_path', 'daily_campaign', 'daily_entity']
  loop
    execute format('alter table analytics.%I drop constraint if exists %I', t, t || '_day_fkey');
    execute format(
      'alter table analytics.%I add constraint %I foreign key (day) references analytics.rolled_days (day) on delete cascade',
      t, t || '_day_fkey'
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- record_site_event — the door's write path (was record_event_v2). service_role only.
-- ---------------------------------------------------------------------------
drop function if exists public.record_event_v2(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean);

create or replace function public.record_site_event(
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
    country, region, city, device, browser, visitor_hash, is_bot
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
    bot
  );
end;
$$;

revoke all on function public.record_site_event(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_site_event(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- roll_up_analytics — serialised, refuses pruned days, ledger first, counts bots
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

-- ---------------------------------------------------------------------------
-- prune_analytics — whole UTC days, a three-day floor, and the ledger remembers
-- ---------------------------------------------------------------------------
create or replace function public.prune_analytics(p_keep interval default interval '90 days')
returns integer
language plpgsql
security invoker
set search_path = public, analytics
as $$
declare
  keep   interval := greatest(coalesce(p_keep, interval '90 days'), interval '3 days');
  cutoff date     := ((now() - keep) at time zone 'UTC')::date;  -- first day KEPT
  n integer;
begin
  -- Whole days only: a half-pruned day would make a later roll-up undercount it. The
  -- ledger check is what makes prune safe — a day that was never tallied is never touched.
  delete from public.analytics_events e
  where e.created_at < (cutoff::timestamp at time zone 'UTC')
    and exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date);
  get diagnostics n = row_count;

  -- Every ledger day before the cutoff is now past re-rolling, whether or not it had rows.
  update analytics.rolled_days set pruned_at = now() where day < cutoff and pruned_at is null;

  delete from analytics.event_attempts where minute < now() - interval '1 day';
  delete from analytics.geo_cache where fetched_at < now() - interval '2 days';
  return n;
end;
$$;

revoke all on function public.roll_up_analytics(date) from public, anon, authenticated;
revoke all on function public.prune_analytics(interval) from public, anon, authenticated;
grant execute on function public.roll_up_analytics(date) to service_role;
grant execute on function public.prune_analytics(interval) to service_role;

-- ---------------------------------------------------------------------------
-- Readers — both halves consult the ledger the same way; deterministic order
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_timeline(uuid, date, date);
create function public.analytics_timeline(p_artist_id uuid, p_since date, p_until date)
returns table (day date, views bigint, visitors bigint, bots bigint)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select t.day, t.views::bigint, t.visitors::bigint, t.bots::bigint
  from analytics.daily_total t
  where t.artist_id = p_artist_id and t.day between p_since and p_until
    and exists (select 1 from analytics.rolled_days r where r.day = t.day)
  union all
  select (e.created_at at time zone 'UTC')::date,
         count(*) filter (where not e.is_bot),
         count(distinct e.visitor_hash) filter (where not e.is_bot),
         count(*) filter (where e.is_bot)
  from public.analytics_events e
  where e.artist_id = p_artist_id and e.type = 'view'
    and e.created_at >= (p_since::timestamp at time zone 'UTC')
    and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
    and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
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
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.source, ''), coalesce(e.referrer_host, ''), count(*), count(distinct e.visitor_hash)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.source, ''), coalesce(e.referrer_host, '')
  ) u
  group by source, referrer_host
  order by 3 desc, 1, 2
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
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.country, ''), coalesce(e.region, ''), coalesce(e.city, ''), count(*), count(distinct e.visitor_hash)
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
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.device, ''), coalesce(e.browser, ''), count(*), count(distinct e.visitor_hash)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.device, ''), coalesce(e.browser, '')
  ) u
  group by device, browser
  order by 3 desc, 1, 2
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
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.path, ''), count(*), count(distinct e.visitor_hash)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.path, '')
  ) u
  group by path
  order by 2 desc, 1
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
      and exists (select 1 from analytics.rolled_days r where r.day = t.day)
    union all
    select coalesce(e.utm_source, ''), coalesce(e.utm_medium, ''), coalesce(e.utm_campaign, ''), count(*), count(distinct e.visitor_hash)
    from public.analytics_events e
    where e.artist_id = p_artist_id and e.type = 'view' and not e.is_bot
      and (e.utm_source is not null or e.utm_medium is not null or e.utm_campaign is not null)
      and e.created_at >= (p_since::timestamp at time zone 'UTC')
      and e.created_at <  ((p_until + 1)::timestamp at time zone 'UTC')
      and not exists (select 1 from analytics.rolled_days r where r.day = (e.created_at at time zone 'UTC')::date)
    group by (e.created_at at time zone 'UTC')::date, coalesce(e.utm_source, ''), coalesce(e.utm_medium, ''), coalesce(e.utm_campaign, '')
  ) u
  group by utm_source, utm_medium, utm_campaign
  order by 4 desc, 1, 2, 3
$$;

do $$
declare fn text;
begin
  foreach fn in array array['analytics_timeline', 'analytics_sources', 'analytics_places', 'analytics_devices', 'analytics_paths', 'analytics_campaigns']
  loop
    execute format('revoke all on function public.%I(uuid, date, date) from public, anon', fn);
    execute format('grant execute on function public.%I(uuid, date, date) to authenticated, service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- O1. Manager RPCs outside analytics that still carried the default anon grant.
-- ---------------------------------------------------------------------------
revoke all on function public.reorder_rows(text, uuid, uuid[]) from public, anon;
revoke all on function public.set_release_link(uuid, text, text) from public, anon;
