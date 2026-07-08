-- Daily per-entity event counts for the item-detail sparklines (ANALYTICS_STATS_PLAN.md
-- Phase 4). Takes an ARRAY of entity ids so a release can sum across its tracks + its
-- own smart-link. Owner-read via RLS (security invoker), like analytics_daily. Bucketed
-- in UTC so day boundaries match the client's 30-day fill.
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
  group by (created_at at time zone 'UTC')::date
$$;

grant execute on function public.analytics_entity_daily(uuid, uuid[], timestamptz) to authenticated;
