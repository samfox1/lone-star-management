-- Per-item analytics attribution (ANALYTICS_STATS_PLAN.md, Phase 1). Events can now
-- point at the specific content row they're about, so the dashboard can show a
-- 30-day stat per card (release engagement, ticket/buy clicks, video clicks) instead
-- of the old fragile title-string matching. `entity_id`/`entity_type` are nullable —
-- site-level `view` events have neither. Adds a `video_click` type (embeds can't
-- report plays, so an on-site tile click is the observable signal) and columns to
-- cache each video's YouTube global view count (refreshed on sync).
alter table public.analytics_events add column if not exists entity_type text;
alter table public.analytics_events add column if not exists entity_id   uuid;

alter table public.analytics_events drop constraint if exists analytics_events_type_check;
alter table public.analytics_events add constraint analytics_events_type_check
  check (type in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click'));

create index if not exists analytics_events_entity_idx
  on public.analytics_events (artist_id, entity_type, entity_id, created_at);

alter table public.videos add column if not exists youtube_views    bigint;
alter table public.videos add column if not exists youtube_views_at timestamptz;

-- record_event now also takes the entity being acted on. Drop the old 3-arg version
-- so the 5-arg (with defaults) is unambiguous for both 3-arg (view) and 5-arg calls.
drop function if exists public.record_event(text, text, text);

create or replace function public.record_event(
  p_slug        text,
  p_type        text,
  p_target      text default null,
  p_entity_id   uuid default null,
  p_entity_type text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
begin
  -- Allowlist the type; ignore junk (anon fire-and-forget, never error).
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;
  insert into public.analytics_events (artist_id, type, target, entity_id, entity_type)
  values (
    aid,
    p_type,
    nullif(left(coalesce(p_target, ''), 200), ''),
    p_entity_id,
    nullif(left(coalesce(p_entity_type, ''), 40), '')
  );
end;
$$;

revoke all on function public.record_event(text, text, text, uuid, text) from public;
grant execute on function public.record_event(text, text, text, uuid, text) to anon, authenticated;

-- Exact per-entity event counts since a cutoff (owner-read via RLS, like
-- analytics_summary). Feeds the per-card 30-day stat. Only entity-attributed rows.
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
  group by entity_type, entity_id, type
$$;

grant execute on function public.analytics_by_entity(uuid, timestamptz) to authenticated;
