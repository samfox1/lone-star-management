-- Per-artist email list ("subscribers"). A fan's email is captured under one
-- artist, so — like analytics_events — the row is keyed by artist_id (resolved
-- from the public slug), and the ONLY write path is a SECURITY DEFINER door,
-- `subscribe`. There is NO anon insert/select policy, so an anon caller can't
-- forge a signup for an arbitrary artist or read anyone's list through PostgREST.
-- The artist's managers (and admins) can read their own subscribers, matching
-- how analytics_events is scoped.

create table public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  constraint subscribers_email_len check (char_length(email) between 3 and 320)
);

-- Dedup per artist, case-insensitively: re-subscribing is a no-op, not a second
-- row. Also backs the `on conflict` target in subscribe().
create unique index subscribers_artist_email_idx
  on public.subscribers (artist_id, lower(email));
create index subscribers_artist_created_idx
  on public.subscribers (artist_id, created_at desc);

alter table public.subscribers enable row level security;

-- Owner-read only. No INSERT/UPDATE/DELETE policy → direct writes are denied for
-- everyone (anon + managers); subscribe() is the sole ingest path.
create policy subscribers_read on public.subscribers
  for select using (public.is_admin() or public.is_manager_of(artist_id));

-- The public door: resolve the artist from its slug, validate the email, insert.
-- Raises on bad input so the signup form can surface a clear error; a duplicate
-- is a silent success (on conflict do nothing) so re-subscribing never errors.
create or replace function public.subscribe(p_slug text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
begin
  if btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    raise exception 'Unknown artist.';
  end if;
  insert into public.subscribers (artist_id, email)
  values (aid, left(btrim(p_email), 320))
  on conflict (artist_id, lower(email)) do nothing;
end;
$$;

revoke all on function public.subscribe(text, text) from public;
grant execute on function public.subscribe(text, text) to anon, authenticated;
