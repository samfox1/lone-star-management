-- Exact event counts by type for an artist since a cutoff (for the Overview
-- insights). SECURITY INVOKER → RLS applies (owner-read). Replaces counting all
-- rows in JS, which silently UNDERCOUNTS past PostgREST's 1000-row cap.
create or replace function public.analytics_summary(p_artist_id uuid, p_since timestamptz)
returns table (type text, count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select type, count(*)
  from public.analytics_events
  where artist_id = p_artist_id and created_at >= p_since
  group by type
$$;

grant execute on function public.analytics_summary(uuid, timestamptz) to authenticated;
