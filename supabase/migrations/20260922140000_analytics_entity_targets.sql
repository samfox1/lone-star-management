-- Per-entity breakdown by TARGET: which streaming service a listener picked for a song,
-- and whether a merch click opened the product or added it to the cart.
--
-- WHY A SEPARATE READER. `analytics_by_entity` groups by (entity_type, entity_id, type)
-- and serves the ranked columns. It cannot answer this, because the rolled tally
-- `analytics.daily_entity` carries NO target column — the detail exists only on the raw
-- rows. So this reads `public.analytics_events` directly and never unions the tally.
--
-- WHAT THAT COSTS. Raw rows are pruned at 90 days (prune_analytics_events), so this can
-- only answer for windows inside that. The dashboard's longest window is 30 days, and a
-- caller asking for more gets a truthful partial answer rather than a wrong whole one —
-- there is no way to recover a target once its row is pruned.
--
-- Rolled days are fine: roll_up_analytics rebuilds the analytics.daily_* tallies and
-- leaves analytics_events alone. Only the prune removes rows.
create or replace function public.analytics_entity_targets(p_artist_id uuid, p_since timestamptz)
returns table (entity_type text, entity_id uuid, type text, target text, count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select e.entity_type, e.entity_id, e.type, e.target, count(*)::bigint
  from public.analytics_events e
  where e.artist_id = p_artist_id
    and e.entity_id is not null
    and e.entity_type is not null
    and e.target is not null
    and not e.is_bot
    and e.created_at >= (((p_since at time zone 'UTC')::date)::timestamp at time zone 'UTC')
  group by e.entity_type, e.entity_id, e.type, e.target
$$;

-- Manager-facing, never anon. `revoke … from public` alone would leave the default
-- role grants on `anon` and `authenticated` untouched (AGENTS.md); name them.
revoke all on function public.analytics_entity_targets(uuid, timestamptz) from public, anon;
grant execute on function public.analytics_entity_targets(uuid, timestamptz) to authenticated, service_role;
