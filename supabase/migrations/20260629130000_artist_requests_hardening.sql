-- artist_requests hardening (review follow-ups). All additive on an empty table.

-- 1. Audit field + trigger, matching every other mutable table. The request has a
--    documented lifecycle (requested → in_build → live), so "when did it move"
--    must be answerable.
alter table public.artist_requests
  add column updated_at timestamptz not null default now();

create trigger artist_requests_updated_at
  before update on public.artist_requests
  for each row execute function public.set_updated_at();

-- 2. Traceability: link a fulfilled request to the artist it produced.
alter table public.artist_requests
  add column artist_id uuid references public.artists (id) on delete set null;

-- 3. Length guards (defense in depth alongside the server action) so the queue
--    can't be spammed with multi-MB rows via the public anon key.
alter table public.artist_requests
  add constraint artist_requests_name_len   check (char_length(name) <= 200),
  add constraint artist_requests_handle_len check (handle is null or char_length(handle) <= 120),
  add constraint artist_requests_link_len   check (link   is null or char_length(link)   <= 500),
  add constraint artist_requests_email_len  check (email  is null or char_length(email)  <= 320),
  add constraint artist_requests_notes_len  check (notes  is null or char_length(notes)  <= 4000);

-- 4. Pin the initial state on self-insert. A manager files at 'requested'; the
--    staff workflow (requested → in_build → live) stays admin-only via
--    artist_requests_admin_write. Without this, a user could POST directly with
--    the anon key and set status='live' on their own row, skipping the build gate.
drop policy artist_requests_insert on public.artist_requests;
create policy artist_requests_insert on public.artist_requests
  for insert with check (requested_by = auth.uid() and status = 'requested');
