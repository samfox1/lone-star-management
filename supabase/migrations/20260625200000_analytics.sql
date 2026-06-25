-- Phase 5 (Analytics): privacy-light event capture (counts of views + clicks,
-- no IP/PII). Fans are anonymous and can't be trusted to insert rows directly,
-- so the ONLY write path is record_event — a SECURITY DEFINER door that resolves
-- the artist from the slug and validates the type. The table has a read policy
-- for the owner and NO insert policy (never `with check (true)`), so a caller
-- can't forge an event for an arbitrary artist_id.

create table public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  type       text not null check (type in ('view', 'link_click', 'ticket_click', 'buy_click', 'play')),
  target     text,
  created_at timestamptz not null default now()
);
create index analytics_events_artist_idx on public.analytics_events (artist_id, created_at);

alter table public.analytics_events enable row level security;
-- Owner-read only. No INSERT/UPDATE/DELETE policy → direct writes are denied for
-- everyone (anon + managers); record_event is the sole ingest path.
create policy analytics_read on public.analytics_events
  for select using (public.is_admin() or public.is_manager_of(artist_id));

create or replace function public.record_event(p_slug text, p_type text, p_target text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
begin
  -- Validate the type against the allowlist; ignore junk rather than erroring
  -- (it's an anon fire-and-forget call).
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;
  insert into public.analytics_events (artist_id, type, target)
  values (aid, p_type, nullif(left(coalesce(p_target, ''), 200), ''));
end;
$$;

revoke all on function public.record_event(text, text, text) from public;
grant execute on function public.record_event(text, text, text) to anon, authenticated;
