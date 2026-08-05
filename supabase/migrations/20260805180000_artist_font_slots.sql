-- Font SLOTS become their own table, and the platform owns the slot vocabulary.
--
-- WHY THIS UNDOES `artist_fonts.role` (shipped hours ago, 20260805140000): the role lived
-- ON THE FONT ROW, which makes the relationship one-font-one-slot by construction. A
-- manager who wants the same typeface for headings AND body had to upload the same file
-- twice under two names — two @font-face blocks, two downloads, two rows to keep in step,
-- and a rename of one that silently diverges from the other. A slot is a property of the
-- SITE ("what is the heading font?"), not of the font ("what am I used for?"), so it
-- belongs in its own table keyed by the slot.
--
-- WHY FIVE NAMED SLOTS AND NOT FREE TEXT: lone-star now owns ONE vocabulary that every
-- consuming site speaks — `primary`, `secondary`, `custom_1..3`. Free text would mean
-- each site inventing its own names, and a payload key nobody on the other side reads is
-- indistinguishable from a font that failed to load. The CHECK is the contract; extending
-- it later is a migration plus one line in FONT_SLOTS (lib/fonts.ts), which is exactly the
-- friction a shared vocabulary should have.
--
-- LIVE DATA AT MIGRATION TIME: one artist_fonts row existed, with role NULL, and zero
-- published `artist_font` revisions. The backfill below still runs — a migration that
-- assumes what it found in one environment is how the other environment loses data.

-- 1. A font is addressable by (id, artist_id), so a slot can be pinned to BOTH.
--    Without this the composite FK below is impossible and `font_id` could name any
--    artist's font — a slot on A's site pointing at B's typeface, served from B's folder.
alter table public.artist_fonts
  add constraint artist_fonts_id_artist_key unique (id, artist_id);

-- 2. The slots themselves. PK is (artist_id, slot): one font per slot, per artist, and
--    the same font may fill as many slots as the manager likes — the exact inversion of
--    what the `role` column could express.
create table public.artist_font_slots (
  artist_id  uuid not null references public.artists (id) on delete cascade,
  -- The platform vocabulary. Mirrored by FONT_SLOTS in lib/fonts.ts, which also DERIVES
  -- the reserved family names from it — a slot added here without adding it there leaves
  -- `.font-primary` claimable by an uploaded font, which would silently outrank the
  -- slot's own rule on every page.
  slot       text not null check (slot in ('primary', 'secondary', 'custom_1', 'custom_2', 'custom_3')),
  font_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (artist_id, slot),
  -- ON DELETE CASCADE on the composite FK: deleting a font FREES its slots automatically.
  -- The alternative (a dangling font_id) is a published slot pointing at a face no
  -- stylesheet defines — headings falling back browser-by-browser with nothing to click
  -- on in the UI to explain it.
  constraint artist_font_slots_font_fk
    foreign key (font_id, artist_id) references public.artist_fonts (id, artist_id) on delete cascade
);

create index artist_font_slots_font_idx on public.artist_font_slots (font_id);

alter table public.artist_font_slots enable row level security;

-- Mirrors artist_fonts exactly. Which typeface an unlaunched site is set in is a fact
-- about that site, and it stays owner-only until it is published.
create policy artist_font_slots_rw on public.artist_font_slots
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- 3. Carry every existing role across before the column goes. `on conflict do nothing`
--    because the old partial unique index guaranteed at most one row per (artist, role)
--    anyway — this is belt and braces, not a real collision path.
insert into public.artist_font_slots (artist_id, slot, font_id)
select artist_id, role, id
from public.artist_fonts
where role is not null
on conflict (artist_id, slot) do nothing;

-- 4. The column and its index are now dead. Dropped rather than left nullable-and-unused:
--    a second place a slot could be recorded is a second place they can disagree, and the
--    disagreement would only ever be visible on the live site.
drop index if exists public.artist_fonts_one_role_per_artist;
alter table public.artist_fonts drop column role;

-- 5. The publishable projection: a font plus the slots it fills.
--
-- WHY A VIEW rather than publishing slots as their own revision entity_type: publishing
-- is per-entity-type and sequential (lib/content.ts publishContent), so two entity types
-- means a window in which a slot revision is live and the font revision it names is not —
-- a published site referencing a family with no @font-face. Riding the FONT's snapshot
-- makes that unrepresentable: a slot only ever exists inside a published font row, so
-- "slot references an unpublished font" cannot be expressed. It also means assigning a
-- slot marks the Fonts section dirty, which is what a manager expects.
--
-- security_invoker so the CALLER's RLS applies — same shape as enquiry_counts_by_artist.
-- Without it the view would be a SECURITY DEFINER read of every tenant's fonts.
create or replace view public.artist_fonts_with_slots
with (security_invoker = on) as
  select f.*,
         coalesce(
           (select array_agg(s.slot order by s.slot)
            from public.artist_font_slots s
            where s.font_id = f.id and s.artist_id = f.artist_id),
           '{}'::text[]
         ) as slots
  from public.artist_fonts f;

comment on view public.artist_fonts_with_slots is
  'artist_fonts plus the slots each font fills (sorted). The publishable projection — PUBLISHABLE.artist_font reads this, so slots ride the font revision and can never be published without it.';

grant select on public.artist_fonts_with_slots to authenticated, service_role;

-- NOT widened: `revisions.entity_type` still admits exactly the eleven types it did after
-- 20260805140000. Slots are part of the artist_font snapshot (see 5), so there is no
-- twelfth type to allow — and adding one would reintroduce the split-publish window the
-- view exists to prevent.
