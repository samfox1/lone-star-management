-- A manager can delete an enquiry (Sam, 2026-09-28: "a manager can delete an inquiry").
--
-- Mostly spam. Until now `enquiries` had NO delete policy, so RLS refused every delete by
-- a signed-in user (silently: zero rows, no error) and only the service role could remove
-- one. The inbox gains a Delete button behind the app's confirm dialog; this is the
-- database half of it.
--
-- WHO: the artist's own managers and admins — the same predicate as `enquiries_read`. A
-- manager may delete only what they can already see.
--
-- GRANTS (AGENTS.md): stock Supabase grants DELETE on every public table to anon and
-- authenticated BY ROLE. RLS already refuses anon here (no policy admits it), but a grant
-- nobody needs is a door someone can open later with one careless policy, so anon loses
-- it; `authenticated` keeps it explicitly, because the policy below is useless without it.
--
-- WHAT GOES WITH IT: the enquiry's `enquiry_attachments` rows, by their `on delete
-- cascade` (FK cascades are not subject to the child's RLS). The audio OBJECTS in the
-- private bucket are removed by deleteEnquiryAction, which reads their paths first — the
-- 90-day sweep only finds objects through those rows, so nothing else ever would.
--
-- RATE LIMITS are unaffected where it matters: the per-IP windows count
-- `contact_attempts`, which a manager cannot touch (no policy). Deleting an enquiry does
-- free a slot in the per-artist flood cap, which counts `enquiries` — but only for the
-- manager's own artist, and the per-IP windows still bound any one sender.

drop policy if exists enquiries_delete on public.enquiries;
create policy enquiries_delete on public.enquiries
  for delete using (public.is_admin() or public.is_manager_of(artist_id));

revoke delete on public.enquiries from public, anon;
grant delete on public.enquiries to authenticated;
