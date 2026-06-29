-- Artist requests — a manager (or a public applicant, later) asks us to build a
-- new artist's site. Onboarding is high-touch (we build the site), so this is a
-- request queue, not a self-serve insert into `artists`. Same deny-by-default
-- RLS posture as the rest of the schema.

create table public.artist_requests (
  id           uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users (id) on delete set null,
  name         text not null,
  handle       text,
  link         text,
  email        text,
  notes        text,
  status       text not null default 'requested'
                 check (status in ('requested', 'in_build', 'live', 'declined')),
  created_at   timestamptz not null default now()
);

create index artist_requests_requested_by_idx on public.artist_requests (requested_by, created_at desc);

alter table public.artist_requests enable row level security;

-- A manager sees and files their own requests; admin sees and manages all.
-- (Status transitions — requested → in_build → live — are staff-side, hence
-- admin-only writes beyond the manager's own insert.)
create policy artist_requests_select on public.artist_requests
  for select using (public.is_admin() or requested_by = auth.uid());

create policy artist_requests_insert on public.artist_requests
  for insert with check (requested_by = auth.uid());

create policy artist_requests_admin_write on public.artist_requests
  for all using (public.is_admin()) with check (public.is_admin());
