-- Public "apply for access" submissions. Like analytics_events, the ONLY write
-- path is a SECURITY DEFINER door (submit_application) — there is NO insert
-- policy, so an anon caller can't forge rows through PostgREST, and no select
-- policy for non-admins, so submissions aren't publicly readable. Admin manages.

create table public.applications (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  artist_name text,
  link        text,
  notes       text,
  status      text not null default 'new' check (status in ('new', 'contacted', 'approved', 'declined')),
  created_at  timestamptz not null default now(),
  constraint applications_name_len check (char_length(name) between 1 and 200),
  constraint applications_email_len check (char_length(email) between 3 and 320),
  constraint applications_artist_len check (artist_name is null or char_length(artist_name) <= 200),
  constraint applications_link_len check (link is null or char_length(link) <= 500),
  constraint applications_notes_len check (notes is null or char_length(notes) <= 4000)
);
create index applications_created_idx on public.applications (created_at desc);

alter table public.applications enable row level security;

-- Admin-only for everything. No policy for anon/managers → direct read AND write
-- are denied; submit_application is the sole ingest path.
create policy applications_admin_all on public.applications
  for all using (public.is_admin()) with check (public.is_admin());

-- The public door: validate + insert. Raises on bad input so the apply form can
-- surface a clear error (unlike record_event's silent fire-and-forget).
create or replace function public.submit_application(
  p_name text,
  p_email text,
  p_artist_name text default null,
  p_link text default null,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_email), '') = '' then
    raise exception 'Name and email are required.';
  end if;
  if btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  insert into public.applications (name, email, artist_name, link, notes)
  values (
    left(btrim(p_name), 200),
    left(btrim(p_email), 320),
    nullif(left(btrim(coalesce(p_artist_name, '')), 200), ''),
    nullif(left(btrim(coalesce(p_link, '')), 500), ''),
    nullif(left(coalesce(p_notes, ''), 4000), '')
  );
end;
$$;

revoke all on function public.submit_application(text, text, text, text, text) from public;
grant execute on function public.submit_application(text, text, text, text, text) to anon, authenticated;
