-- Analytics door hardening (review follow-up; TODO.md:103).
--
-- 1. record_event gets a per-artist burst cap.
-- 2. analytics_summary stops being executable by PUBLIC.

-- ---------------------------------------------------------------------------
-- 1. record_event burst cap
--
-- record_event is an anonymous ingest door, so a bot can flood it. Forgery only
-- ever inflates the artist's OWN vanity counts — the door resolves artist_id
-- from the slug (never cross-tenant) and entity_type has been allowlisted since
-- 20260707200000 — but an unbounded flood still bloats analytics_events. This
-- caps rows-per-artist-per-minute, which bounds that growth.
--
-- This is NOT per-IP rate limiting: a DB function cannot see the client IP, so
-- that belongs at the edge (the same caveat 20260706150000_subscribe_rate_limit
-- carries). Be clear-eyed about the trade: while a flood is in progress the
-- attacker fills the window and the artist's REAL events are dropped alongside
-- the junk. Bounded junk plus possible suppression during an attack beats
-- unbounded junk — that minute's data is unusable either way.
--
-- 120/min = 2 events/sec sustained for one artist, far above real traffic at
-- this scale, so legitimate events are not dropped in practice. Deliberately NOT
-- the subscribe door's 15/min: subscribe caps signups (rare), while this fires
-- on every page view and click, and analytics is a headline dashboard feature.
--
-- DROPS SILENTLY (return) instead of raising the way subscribe does. subscribe
-- backs a form where the person needs the feedback; record_event is
-- fire-and-forget telemetry from a fan's page, where an exception would surface
-- as a visible error. Silence matches how this door already swallows an unknown
-- type / unknown slug.
--
-- Cheap: analytics_events_artist_idx is (artist_id, created_at), so the window
-- count is an index range scan — and the window is self-bounding at the cap,
-- because this door is the table's only ingest path.
--
-- Everything else is unchanged from 20260707200000.
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
  etype text;
  eid uuid;
  recent int;
begin
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;

  -- Burst cap. Per-artist, so a flooded artist can never suppress another's.
  select count(*) into recent
  from public.analytics_events
  where artist_id = aid and created_at > now() - interval '1 minute';
  if recent >= 120 then
    return;
  end if;

  -- Only keep the entity attribution when the type is a real content kind.
  if p_entity_type in ('release', 'track', 'merch', 'video', 'tour_date', 'link') then
    etype := p_entity_type;
    eid := p_entity_id;
  else
    etype := null;
    eid := null;
  end if;
  insert into public.analytics_events (artist_id, type, target, entity_id, entity_type)
  values (aid, p_type, nullif(left(coalesce(p_target, ''), 200), ''), eid, etype);
end;
$$;

revoke all on function public.record_event(text, text, text, uuid, text) from public;
grant execute on function public.record_event(text, text, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. analytics_summary: revoke the implicit PUBLIC execute grant.
--
-- Hygiene, not a hole: the function is SECURITY INVOKER, so analytics_events'
-- owner-read RLS already applies to the caller and anon gets zero rows. Postgres
-- grants EXECUTE to PUBLIC by default though, and 20260625230000 only added the
-- `authenticated` grant without revoking that default. Make the intent explicit
-- and match every other door in this schema.
revoke all on function public.analytics_summary(uuid, timestamptz) from public;
grant execute on function public.analytics_summary(uuid, timestamptz) to authenticated;
