-- The Brand page rebuild (BRAND_PAGE_PLAN.md, "Data model"), 2026-09-24.
--
-- Everything the new page SAVES, and nothing it publishes that it did not publish before.
-- The brand publish is still `media` + `artist_font`; every column added here is either
-- dashboard-only (notes, titles of font slots, the icon sources and framing, the browser-bar
-- colour, the palette) or rides a snapshot that already exists (a logo's title is
-- `media.label`, which PUBLISHABLE.media already carries). The websites start reading the
-- new things in a later round, which will be its own migration and its own bridge release.
--
-- What stays OUT of every publish snapshot and out of get_public_site, on purpose:
--   media.note, media.source_path, artist_font_slots.label/note, artist_fonts.weight,
--   artists.{favicon,home_icon}_source_media_id, home_icon_zoom/offset_y, theme_color,
--   and the whole brand_colors table.
-- None of those names appear in PUBLISHABLE (lib/content.ts) or ARTIST_SNAPSHOT, and
-- get_public_site cherry-picks its media/fonts keys, so this file does not touch the door.
-- The new media purposes DO flow through it (a published `logo` row arrives with
-- purpose 'logo'); every site filters media by an explicit purpose, so they are inert
-- until a site asks for them.

-- ---------------------------------------------------------------------------
-- 1. media: a note, the original behind a background cut-out, three new purposes
-- ---------------------------------------------------------------------------

-- The manager's note on an added logo. Dashboard-only: never in the media snapshot.
-- One line (the field saves on Enter), bounded so a pasted document cannot become one.
alter table public.media add column if not exists note text;
alter table public.media drop constraint if exists media_note_clean;
alter table public.media add constraint media_note_clean
  check (note is null or (char_length(note) <= 500 and note !~ '[\r\n]'));

-- The ORIGINAL file, kept after "Remove background" swaps `storage_path` for the cut-out.
-- Storage GC treats it as referenced (lib/storage-gc.ts gcMediaObjects), or the original
-- would be swept at the next publish and the cut-out could never be undone.
alter table public.media add column if not exists source_path text;

-- `logo`        an ADDED logo (the Brand page's third and later rows); `label` is its title.
-- `home_icon`   the generated 180px home-screen PNG, single occupancy like `favicon`.
-- `icon_source` an image uploaded only to be framed into the tab or home-screen icon.
alter table public.media drop constraint if exists media_purpose_check;
alter table public.media add constraint media_purpose_check check (
  purpose = any (array[
    'hero_video', 'profile_photo', 'gallery_image', 'bio_video',
    'logo_primary', 'logo_secondary', 'favicon',
    'logo', 'home_icon', 'icon_source'
  ])
);

-- An added logo always has a title: the row exists to be told apart from the others, and
-- an untitled one would render as a blank row label. Scoped to `logo` so the gallery's
-- works-pool names (the other use of `label`) keep their own rules.
alter table public.media drop constraint if exists media_logo_title;
alter table public.media add constraint media_logo_title check (
  purpose <> 'logo'
  or (label is not null and btrim(label) <> '' and char_length(label) <= 40 and label !~ '[\r\n]')
);

-- The target of the icon-source FKs below. A media row is addressable by (id, artist_id)
-- so an artist's icon can only ever name ITS OWN media — same trick as artist_fonts
-- (20260805180000) and enquiry_kinds.
alter table public.media drop constraint if exists media_id_artist_key;
alter table public.media add constraint media_id_artist_key unique (id, artist_id);

-- ---------------------------------------------------------------------------
-- 2. artists: where each icon comes from, how the home-screen icon is framed, the bar colour
-- ---------------------------------------------------------------------------

-- NULL = the primary logo (the old, implicit behaviour, so every existing artist is
-- already correct). Composite FK, so pointing at another artist's media is unrepresentable.
-- `on delete set null (col)` (PG15+): deleting the source falls back to the primary logo
-- and leaves `artists.id` alone — a plain SET NULL on a composite key would null both.
alter table public.artists add column if not exists favicon_source_media_id uuid;
alter table public.artists add column if not exists home_icon_source_media_id uuid;

alter table public.artists drop constraint if exists artists_favicon_source_fk;
alter table public.artists add constraint artists_favicon_source_fk
  foreign key (favicon_source_media_id, id) references public.media (id, artist_id)
  on delete set null (favicon_source_media_id);

alter table public.artists drop constraint if exists artists_home_icon_source_fk;
alter table public.artists add constraint artists_home_icon_source_fk
  foreign key (home_icon_source_media_id, id) references public.media (id, artist_id)
  on delete set null (home_icon_source_media_id);

-- The home-screen icon's framing. CONFIG, like favicon_zoom/offset_y (20260804160000):
-- the generated PNG is what publishes; these only restore the sliders. Same bounds.
alter table public.artists add column if not exists home_icon_zoom real;
alter table public.artists add column if not exists home_icon_offset_y real;

alter table public.artists drop constraint if exists artists_home_icon_zoom_range;
alter table public.artists add constraint artists_home_icon_zoom_range
  check (home_icon_zoom is null or (home_icon_zoom >= 1 and home_icon_zoom <= 6));

alter table public.artists drop constraint if exists artists_home_icon_offset_range;
alter table public.artists add constraint artists_home_icon_offset_range
  check (home_icon_offset_y is null or (home_icon_offset_y >= -1 and home_icon_offset_y <= 1));

-- The browser-bar colour (`<meta name="theme-color">` once sites read it). Lowercase
-- #rrggbb only, so two spellings of one colour cannot both be stored.
alter table public.artists add column if not exists theme_color text;
alter table public.artists drop constraint if exists artists_theme_color_hex;
alter table public.artists add constraint artists_theme_color_hex
  check (theme_color is null or theme_color ~ '^#[0-9a-f]{6}$');

-- ---------------------------------------------------------------------------
-- 3. brand_colors: the artist's palette
-- ---------------------------------------------------------------------------
-- A plain list (Color 1, Color 2, …), no roles. Dashboard-only this round: not a
-- revisions entity type, not in any payload. The database is the authority on the hex
-- shape, the name and the cap; lib/brand-colors.ts only normalises and translates.
create table if not exists public.brand_colors (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  name       text not null,
  hex        text not null,
  note       text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint brand_colors_hex check (hex ~ '^#[0-9a-f]{6}$'),
  constraint brand_colors_name
    check (btrim(name) <> '' and char_length(name) <= 40 and name !~ '[\r\n]'),
  constraint brand_colors_note
    check (note is null or (char_length(note) <= 500 and note !~ '[\r\n]'))
);

create index if not exists brand_colors_artist_idx on public.brand_colors (artist_id, sort_order, created_at);

alter table public.brand_colors enable row level security;

drop policy if exists brand_colors_rw on public.brand_colors;
create policy brand_colors_rw on public.brand_colors
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- AGENTS.md: by ROLE, not just PUBLIC. Stock Supabase grants every new public table to
-- anon and authenticated in full (TRUNCATE included, which RLS does not govern). Anon gets
-- nothing; a signed-in manager gets the four verbs RLS scopes.
revoke all on table public.brand_colors from public, anon, authenticated;
grant select, insert, update, delete on table public.brand_colors to authenticated;
grant all on table public.brand_colors to service_role;

-- 24 per artist, in the database: the dashboard is not the only writer (service_role, the
-- copilot, a future import), and the site editor's swatch row has to stay a row. A CHECK
-- cannot count, so it is a trigger — and it takes a per-artist lock BEFORE counting, or
-- two concurrent adds both count 23 and both pass (the enquiry-recipients cap learned
-- that, 20260922120000).
create or replace function public.enforce_brand_color_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap constant int := 24;
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('brand_colors:' || new.artist_id::text));
  select count(*) into n
    from public.brand_colors c
   where c.artist_id = new.artist_id
     and c.id is distinct from new.id;
  if n >= cap then
    raise exception 'brand color cap reached: at most % colors per artist', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- INSERT, and an UPDATE that moves a row to another artist (the same overflow by another
-- route). A rename or a hex change does not touch artist_id and never takes the lock.
drop trigger if exists brand_colors_cap on public.brand_colors;
create trigger brand_colors_cap
  before insert or update of artist_id on public.brand_colors
  for each row execute function public.enforce_brand_color_cap();

-- `public, anon` only, as for enforce_enquiry_recipient_cap: it fires on a MANAGER's insert,
-- and a trigger function is not callable through PostgREST whatever its grant.
revoke all on function public.enforce_brand_color_cap() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Font slots get a title and a note; fonts get a weight
-- ---------------------------------------------------------------------------
-- A custom slot's title is what the site editor's font list shows. Built-in slots
-- (primary, secondary) have a fixed title and no note, so both are custom-only here.
-- Neither is in the artist_font snapshot: the view's `slots` is the slot NAMES only.
alter table public.artist_font_slots add column if not exists label text;
alter table public.artist_font_slots add column if not exists note text;

alter table public.artist_font_slots drop constraint if exists artist_font_slots_label_custom;
alter table public.artist_font_slots add constraint artist_font_slots_label_custom check (
  label is null
  or (slot in ('custom_1', 'custom_2', 'custom_3')
      and btrim(label) <> '' and char_length(label) <= 40 and label !~ '[\r\n]')
);

alter table public.artist_font_slots drop constraint if exists artist_font_slots_note_custom;
alter table public.artist_font_slots add constraint artist_font_slots_note_custom check (
  note is null
  or (slot in ('custom_1', 'custom_2', 'custom_3')
      and char_length(note) <= 500 and note !~ '[\r\n]')
);

-- The file's weight (OS/2 usWeightClass, or what the manager says for a woff2). Nullable:
-- fonts uploaded before today have none, and "unknown" is not "Regular".
-- The view `artist_fonts_with_slots` is NOT recreated: it was built with `f.*`, which
-- Postgres expanded at creation, so it keeps its eight columns and the publish snapshot
-- cannot pick weight up by accident. The Brand page reads weight from the table.
alter table public.artist_fonts add column if not exists weight smallint;
alter table public.artist_fonts drop constraint if exists artist_fonts_weight_range;
alter table public.artist_fonts add constraint artist_fonts_weight_range
  check (weight is null or (weight >= 100 and weight <= 900));
