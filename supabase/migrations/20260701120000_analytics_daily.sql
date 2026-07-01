-- Daily VIEW counts per artist, for the dashboard sparklines + trend lines.
-- SECURITY INVOKER so RLS applies (owner-read), exactly like analytics_summary;
-- the SQL group-by gives exact per-day counts past PostgREST's 1000-row cap.
-- p_artist_id filters to a single artist; null = every artist the caller manages.
-- Bucketed in UTC so the day boundaries match the client's fill logic.
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
    and created_at >= p_since
    and (p_artist_id is null or artist_id = p_artist_id)
  group by artist_id, (created_at at time zone 'UTC')::date
$$;

grant execute on function public.analytics_daily(timestamptz, uuid) to authenticated;
