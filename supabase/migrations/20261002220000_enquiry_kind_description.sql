-- A DESCRIPTION on every enquiry kind, editable by the artist's managers (Sam, 2026-10-02: "if I
-- add a new type of email name, I should be able to add and edit the description for it").
--
-- Until this file the grey line under a kind on Settings › Email ("For shows, festivals and
-- private events") was a fixed map in the dashboard (KIND_GUIDES in src/lib/enquiries/kinds.ts),
-- keyed by slug, for the three seeded kinds only. Now it is a column: the backfill below copies
-- those three lines in for every artist, and the seed trigger writes them for every new artist,
-- so nothing visibly changes after the push. A kind with no description shows no line.
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. Full suite green (AGENTS.md: always before a migration push).
--   2. `supabase db push --dry-run` lists this file (after 20261002210000 if that one is not
--      live yet; neither depends on the other). Then `npm run db:push`.
--   3. `npm run audit:grants`: one REPLACED function, seed_default_enquiry_kinds (a trigger),
--      whose grants `create or replace` keeps and the revoke below restates. Expect NO change.
--   4. Flip KIND_DESCRIPTION_PUSHED in tests/integration/enquiries/enquiry-kind-description.test.ts
--      and run that file.
--   5. Delete what only held before this push:
--        - the 42703 re-read in settings/email/page.tsx (`KIND_SELECT_OLD`) and its test in
--          tests/components/manager-tools/settings/settings-email-page.test.tsx;
--        - `missingColumn` and its sentence in src/lib/enquiries/kind-save.ts;
--        - KIND_GUIDES / kindGuide in src/lib/enquiries/kinds.ts, toKindRows' fallback to it, and
--          their unit tests ("kindGuide", "falls back to the fixed line when the column is not
--          there yet").
--   6. Settings › Email: the three lines read as before. Click Booking, change its line, ✓,
--      reload: it stays. Clear it, ✓: the line goes.
--
-- ── WHO MAY WRITE IT ────────────────────────────────────────────────────────────────────
-- Nothing new. `enquiry_kinds_write` (20260921120000) is `for all` with USING and WITH CHECK
-- `is_admin() or is_manager_of(artist_id)`, a ROW policy, so it covers every column, this one
-- included. No column-level grant exists on this table (every grant is Supabase's stock
-- table-level one), so `authenticated`'s UPDATE reaches the new column without a grant here,
-- and anon's, while granted, is row-filtered to nothing by the policy. The save goes through
-- PostgREST with the manager's own session (saveEnquiryKind, src/lib/enquiries/kind-save.ts),
-- like the rename it replaces: there is no SECURITY DEFINER function listing columns to extend.
-- The ONE function that names enquiry_kinds' columns is the seed trigger, extended below.
--
-- ── WHAT IT MAY HOLD ────────────────────────────────────────────────────────────────────
-- One line, at most 120 characters, no leading or trailing whitespace; NULL for "no line".
--   * One line: it is read as the grey line under the name, and if stage 3 ever puts it on a
--     site's contact form, a line break is a layout bug at best. Every Unicode mandatory break
--     is refused (CR, LF, VT, FF, NEL, LS, PS), not just \r\n.
--   * Trimmed, and never '': an empty or blank description is NULL, so "no line" has one
--     spelling and `is null` finds every kind without one. The dashboard trims and sends NULL
--     for an empty field (kindDetailsUpdate); the CHECK holds it for every other writer.
--   * 120: about two of the current lines. char_length counts characters (code points), and
--     DESCRIPTION_MAX in kinds.ts mirrors it.
--
-- Checked on a throwaway local Postgres 2026-10-02, each guard broken once: see the header of
-- tests/integration/enquiries/enquiry-kind-description.test.ts.

alter table public.enquiry_kinds add column description text;

alter table public.enquiry_kinds add constraint ek_description_clean check (
  description is null
  or (
    char_length(description) between 1 and 120
    and description !~ '[\r\n\v\f\u0085\u2028\u2029]'
    and description !~ '^\s|\s$'
  )
);

comment on column public.enquiry_kinds.description is
  'What this kind of enquiry is for, one line (≤120, trimmed), shown under its name on Settings › Email. NULL: no line. Managers edit it (enquiry_kinds_write).';

-- ── The three seeded kinds keep the lines they show today ───────────────────────────────
-- Keyed by SLUG, like the map it replaces, so a renamed Booking keeps its line (the map never
-- read the label). `description is null`: safe to re-run, and never overwrites an edit.
update public.enquiry_kinds k
   set description = d.description
  from (values
    ('booking', 'For shows, festivals and private events'),
    ('demo',    'For music and demo submissions'),
    ('other',   'For everything else')
  ) as d(slug, description)
 where k.slug = d.slug
   and k.description is null;

-- ── And every new artist starts with them ───────────────────────────────────────────────
-- Same function as 20260921120000 plus the column; see that file for why this is a trigger.
create or replace function public.seed_default_enquiry_kinds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.enquiry_kinds (artist_id, slug, label, sort_order, description)
  values (new.id, 'booking', 'Booking', 0, 'For shows, festivals and private events'),
         (new.id, 'demo',    'Demo',    1, 'For music and demo submissions'),
         -- Slug 'other', LABEL 'Contact': see 20260921120000.
         (new.id, 'other',   'Contact', 2, 'For everything else')
  on conflict (artist_id, slug) do nothing;
  return new;
end;
$$;

-- Restated, though `create or replace` keeps them: the same `public, anon` as 20260921120000
-- (NOT authenticated, for the reason given there), so `npm run audit:grants` sees no change.
revoke all on function public.seed_default_enquiry_kinds() from public, anon;
