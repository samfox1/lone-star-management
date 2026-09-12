-- The two things the `event` Edge Function needs from Postgres besides record_site_event:
-- a per-IP burst ledger and a two-day location cache. Both live in schema analytics
-- (ADR 0012) and are reached only through these service_role-only functions, the same
-- shape as log_contact_attempt for the /contact door (ADR 0010).
--
-- bump_event_attempt is the per-IP cap itself, done as ONE statement (upsert + returning)
-- so two concurrent events from the same IP cannot both read "59" and both pass. The cap
-- counts bots and fans alike: the point is to bound what one address can make us do.
--
-- Grants in the full form (AGENTS.md): from public, anon, authenticated; to service_role.

create or replace function public.bump_event_attempt(p_ip_hash text, p_limit integer default 60)
returns boolean
language plpgsql
security invoker
set search_path = public, analytics
as $$
declare
  n integer;
begin
  if p_ip_hash is null or p_ip_hash = '' then
    return false;
  end if;
  insert into analytics.event_attempts as a (ip_hash, minute, count)
  values (p_ip_hash, date_trunc('minute', now()), 1)
  on conflict (ip_hash, minute) do update set count = a.count + 1
  returning a.count into n;
  return n <= coalesce(p_limit, 60);
end;
$$;

create or replace function public.geo_cache_get(p_ip_hash text)
returns table (country text, region text, city text)
language sql
security invoker
stable
set search_path = public, analytics
as $$
  select g.country, g.region, g.city
  from analytics.geo_cache g
  where g.ip_hash = p_ip_hash and g.fetched_at > now() - interval '2 days'
$$;

create or replace function public.geo_cache_put(p_ip_hash text, p_country text, p_region text, p_city text)
returns void
language sql
security invoker
set search_path = public, analytics
as $$
  insert into analytics.geo_cache (ip_hash, country, region, city, fetched_at)
  values (p_ip_hash, p_country, p_region, p_city, now())
  on conflict (ip_hash) do update
    set country = excluded.country, region = excluded.region, city = excluded.city, fetched_at = now()
$$;

revoke all on function public.bump_event_attempt(text, integer) from public, anon, authenticated;
revoke all on function public.geo_cache_get(text) from public, anon, authenticated;
revoke all on function public.geo_cache_put(text, text, text, text) from public, anon, authenticated;
grant execute on function public.bump_event_attempt(text, integer) to service_role;
grant execute on function public.geo_cache_get(text) to service_role;
grant execute on function public.geo_cache_put(text, text, text, text) to service_role;
