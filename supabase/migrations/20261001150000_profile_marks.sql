-- PROFILE MARKS: which outside-profile jobs a manager has done for an artist (SEO tool,
-- Profiles tab, 2026-10-01). One row = "done", no row = "not done". First item: the AllMusic
-- bio email ("Mark as sent"); Bandsintown upload, Discogs and RA join the CHECK later.
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. `supabase db push --dry-run` lists this file (plus 20261001130000 / 20261001140000 if
--      those are still unpushed: all three are independent, any order). Then `npm run db:push`.
--   3. `npm run audit:grants`: no function is created or replaced here, so expect no change.
--      Table grants, by eye (expect authenticated: SELECT, DELETE on the table and INSERT on
--      artist_id + item only; service_role: everything; anon: nothing):
--        select grantee, privilege_type from information_schema.role_table_grants
--         where table_schema = 'public' and table_name = 'profile_marks';
--        select grantee, column_name, privilege_type from information_schema.column_privileges
--         where table_schema = 'public' and table_name = 'profile_marks' and grantee = 'authenticated';
--   4. Flip PROFILE_MARKS_PUSHED in tests/integration/manager-tools/seo/profile-marks.test.ts
--      and run that file.
--   5. SEO → Profiles: "Mark as sent", reload, it stays marked; undo, reload, it is cleared.
--
-- ── WHO MAY DO WHAT ─────────────────────────────────────────────────────────────────────
-- Private to the artist's managers (and Tapir admins, as on every manager-owned table). Never
-- in a publish snapshot, never in get_public_site. The policy expression is copied EXACTLY from
-- `brand_colors_rw` (20260924120000_brand_page.sql), the same one `enquiry_kinds_read/_write`
-- (20260921120000_enquiry_recipients.sql) use:
--     public.is_admin() or public.is_manager_of(artist_id)
-- Split per verb (select / insert / delete) rather than FOR ALL, so that if UPDATE is ever
-- granted by mistake there is still no policy that lets it through.
--
-- GRANTS (AGENTS.md): stock Supabase grants every new public table to anon AND authenticated
-- in full, TRUNCATE included, which RLS does not govern. So everything is revoked from
-- `public, anon, authenticated` (not just public) and granted back on purpose:
--   * authenticated: SELECT and DELETE on the table; INSERT on (artist_id, item) ONLY. The
--     stamp (done_at, done_by) is the database's: a manager cannot backdate a mark or put it
--     in someone else's name. No UPDATE: undo is a delete, redo is an insert. That is also
--     why the app marks with ON CONFLICT DO NOTHING (a re-mark keeps the first stamp) rather
--     than DO UPDATE, which would need UPDATE.
--   * service_role: all.
--   * anon: nothing.
--
-- TEARDOWN: `on delete cascade` from artists, so tests/helpers/artist.ts deleteThrowawayArtist
-- needs no change (unlike site_verifications, which restricts). Checked 2026-09-30 on a local
-- Postgres; pinned by the cascade test in the integration file.

create table public.profile_marks (
  artist_id uuid not null references public.artists (id) on delete cascade,
  -- Mirrors PROFILE_ITEMS in src/lib/manager-tools/profiles/marks.ts. Widen both together.
  item      text not null
            constraint profile_marks_item_check check (item in ('allmusic_bio')),
  done_at   timestamptz not null default now(),
  done_by   uuid default auth.uid(),
  primary key (artist_id, item)
);

alter table public.profile_marks enable row level security;

create policy profile_marks_read on public.profile_marks
  for select using (public.is_admin() or public.is_manager_of(artist_id));
create policy profile_marks_insert on public.profile_marks
  for insert with check (public.is_admin() or public.is_manager_of(artist_id));
create policy profile_marks_delete on public.profile_marks
  for delete using (public.is_admin() or public.is_manager_of(artist_id));

revoke all on table public.profile_marks from public, anon, authenticated;
grant select, delete on table public.profile_marks to authenticated;
grant insert (artist_id, item) on table public.profile_marks to authenticated;
grant all on table public.profile_marks to service_role;
