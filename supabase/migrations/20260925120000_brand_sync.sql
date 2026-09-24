-- Brand ⇄ sites sync, phase 1: the database half (BRAND_SYNC_PLAN.md), 2026-09-25.
--
-- Sam, 2026-09-24: "websites reading the brand setting. This should be in sync with sites
-- and the editor." Brand becomes the source of truth the published site reads. Colours, the
-- browser-bar colour and Google fonts now go through draft → Publish like the rest of Brand,
-- and get_public_site returns them from the PUBLISHED snapshot:
--
--   brand: { colors: [{ key, name, hex }], theme_color: '#rrggbb' | null }
--   fonts: [...existing fields, source: 'upload' | 'google', google_family (google only)]
--
-- PURELY ADDITIVE, plus backfills:
--   1. brand_colors.key   stable, CSS-safe, unique per artist, immutable (trigger).
--   2. artist_fonts       source ('upload' | 'google') + google_family; a Google row has no
--                         file, so storage_path/format become nullable FOR GOOGLE ROWS ONLY.
--   3. The publish plumbing: two new revision entity types, `brand_color` (one per colour)
--      and `theme_color` (a singleton for artists.theme_color); the fonts view gains the two
--      new columns; the latest font revisions are backfilled.
--   4. get_public_site     re-created whole from 20260911120000 with `brand` added and the
--                          fonts branches taught about Google rows. Nothing else changes.
--
-- GRANTS (AGENTS.md): the new trigger function and the slug helper are revoked from `public,
-- anon, authenticated` or `public, anon` as their callers need (see each). No new table or
-- view. get_public_site stays the anon door it is today, restated below. RLS is unchanged:
-- brand_colors_rw, artist_fonts_rw and artists_select already scope every row this file
-- adds a column to or reads.

-- ===========================================================================
-- 1. brand_colors.key — the name a site's CSS knows a colour by
-- ===========================================================================
-- The bridge emits `--brand-<key>` for every published colour, and a site maps its own tokens
-- onto those variables (`--cream: var(--brand-cream, #f4f1ea)`). So the key is a CONTRACT,
-- exactly like an enquiry kind's slug (20260921120000): renaming "Cream" to "Off-white" must
-- not rename `--brand-cream`, or the site silently falls back to its hard-coded value.
--
--   • Primary and Secondary (the slotted rows) are keyed by their slot: `primary`, `secondary`.
--   • An added colour gets a slug of its NAME AT CREATION, de-duplicated per artist
--     (`cream`, `cream-2`), and never `primary`/`secondary` — those two belong to the slots
--     even before they are picked, or an added colour named "Primary" could take the key the
--     built-in needs and the built-in's first pick would fail.
--   • Charset [a-z0-9-], because it is interpolated into a CSS custom-property name.
--   • Immutable (trigger below). A deleted colour frees its key; a new one may take it.

alter table public.brand_colors add column if not exists key text;

-- The slug rule, in ONE place (the backfill and the insert trigger both call it). Accents
-- fold (NFKD, marks dropped: "Crème" → "creme"), ß → ss, every run of anything else becomes
-- one hyphen, cut to 32 so a de-duplication suffix still fits the 40-char CHECK. Nothing
-- usable left ("🔥") → 'color'. Checked against the live server on 2026-09-25 (read-only):
-- 'Crème Brûlée' → creme-brulee, '  Deep  Sky!! Blue ' → deep-sky-blue, 'Straße' → strasse.
create or replace function public.brand_color_slug(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from left(
        regexp_replace(
          regexp_replace(replace(lower(normalize(coalesce(p_name, ''), NFKD)), 'ß', 'ss'), '[\u0300-\u036f]', '', 'g'),
          '[^a-z0-9]+', '-', 'g'),
        32)),
      ''),
    'color')
$$;

-- A pure helper with nothing to hide, but nobody outside the database calls it: the trigger
-- (security definer, runs as owner) and the backfill (the migration role) are its callers.
revoke all on function public.brand_color_slug(text) from public, anon, authenticated;
grant execute on function public.brand_color_slug(text) to service_role;

-- BACKFILL. Slotted rows take their slot. Added rows, per artist in palette order (the order
-- the page shows them), take their slug, suffixed past anything already taken. There were no
-- brand_colors rows on the live project when this was written (queried 2026-09-25); the loop
-- runs anyway, because a migration that assumes what it found in one environment is how the
-- other environment loses data.
update public.brand_colors set key = slot where slot is not null and key is null;

do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in
    select id, artist_id, name from public.brand_colors
     where key is null
     order by artist_id, sort_order, created_at, id
  loop
    base := public.brand_color_slug(r.name);
    candidate := base;
    n := 1;
    while candidate in ('primary', 'secondary')
       or exists (select 1 from public.brand_colors c where c.artist_id = r.artist_id and c.key = candidate)
    loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    update public.brand_colors set key = candidate where id = r.id;
  end loop;
end;
$$;

alter table public.brand_colors alter column key set not null;

-- CSS-safe: lowercase words joined by single hyphens, ≤ 40.
alter table public.brand_colors drop constraint if exists brand_colors_key_format;
alter table public.brand_colors add constraint brand_colors_key_format
  check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) <= 40);

-- A built-in's key IS its slot; an added colour can never hold a built-in's key.
alter table public.brand_colors drop constraint if exists brand_colors_key_slot;
alter table public.brand_colors add constraint brand_colors_key_slot check (
  (slot is not null and key = slot)
  or (slot is null and key not in ('primary', 'secondary'))
);

-- One `--brand-<key>` per artist. A plain UNIQUE: nothing upserts on it.
alter table public.brand_colors drop constraint if exists brand_colors_key_unique;
alter table public.brand_colors add constraint brand_colors_key_unique unique (artist_id, key);

-- ASSIGN on insert, GUARD on update — one function, the enquiry-kind guard's shape.
--
-- INSERT: a slotted row takes its slot (whatever was sent). An added row with a key already
-- set keeps it — that is a Revert re-inserting a PUBLISHED colour, whose key must come back
-- exactly as the site knows it (the CHECKs and the unique constraint still judge it). Without
-- one, the slug of its name, suffixed past every key this artist holds. Under the same
-- per-artist advisory lock the cap trigger takes, so two concurrent "Cream"s cannot both
-- read `cream` as free: `brand_colors_cap` sorts before `brand_colors_key`, so the lock is
-- already held here (re-taking it is a no-op), and the second writer waits for the first to
-- commit, then — READ COMMITTED, a fresh snapshot per statement — sees its row.
--
-- UPDATE OF key: refused whenever the value would change. A rename changes `name` and never
-- reaches this branch (the trigger is scoped to the column).
create or replace function public.brand_color_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      raise exception 'a brand color''s key cannot change (% → %); rename the color instead', old.key, new.key
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.slot is not null then
    new.key := new.slot;
    return new;
  end if;
  if new.key is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('brand_colors:' || new.artist_id::text));
  base := public.brand_color_slug(new.name);
  candidate := base;
  while candidate in ('primary', 'secondary')
     or exists (select 1 from public.brand_colors c where c.artist_id = new.artist_id and c.key = candidate)
  loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  new.key := candidate;
  return new;
end;
$$;

drop trigger if exists brand_colors_key on public.brand_colors;
create trigger brand_colors_key
  before insert or update of key on public.brand_colors
  for each row execute function public.brand_color_key();

-- `public, anon` only, as for enforce_brand_color_cap: it fires on a MANAGER's insert, and a
-- trigger function is not callable through PostgREST whatever its grant.
revoke all on function public.brand_color_key() from public, anon;

-- ===========================================================================
-- 2. artist_fonts: Google Fonts beside uploads
-- ===========================================================================
-- Sam, 2026-09-24: "Brand gets Google Fonts (pick any Google family by name) alongside
-- uploads." A Google font is an artist_fonts row like any other — it has a label, a family
-- token (lib/fonts.ts sanitizeFamily of the Google name, unique per artist as before), it
-- fills slots through artist_font_slots, and it publishes with the fonts — but it has NO FILE:
-- the site loads it from fonts.googleapis.com by its Google name. So:
--
--   source         'upload' (every existing row, by default) or 'google'.
--   google_family  the Google family AS GOOGLE SPELLS IT ("Big Shoulders Display") — it goes
--                  into a css2 URL and a CSS font-family string on every visitor's page, so
--                  it is held to letters and digits in single-space-separated words. All
--                  1,946 families in Google's catalogue on 2026-09-25 match (longest: 32).
--   storage_path / format   nullable now, but ONLY for a Google row: the shape CHECK below
--                  makes an upload without a file, or a Google row with one, unrepresentable.
alter table public.artist_fonts add column if not exists source text not null default 'upload';
alter table public.artist_fonts add column if not exists google_family text;

alter table public.artist_fonts drop constraint if exists artist_fonts_source_known;
alter table public.artist_fonts add constraint artist_fonts_source_known
  check (source in ('upload', 'google'));

alter table public.artist_fonts drop constraint if exists artist_fonts_google_family_clean;
alter table public.artist_fonts add constraint artist_fonts_google_family_clean check (
  google_family is null
  or (google_family ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$' and char_length(google_family) <= 64)
);

alter table public.artist_fonts alter column storage_path drop not null;
alter table public.artist_fonts alter column format drop not null;

-- Both ways: an upload has its file and format and no Google name; a Google font has its
-- name and neither of the others. (`format`'s own CHECK still names the four formats; a NULL
-- passes it, which is exactly the Google case this constraint allows and no other.)
alter table public.artist_fonts drop constraint if exists artist_fonts_source_shape;
alter table public.artist_fonts add constraint artist_fonts_source_shape check (
  (source = 'upload' and storage_path is not null and format is not null and google_family is null)
  or (source = 'google' and google_family is not null and storage_path is null and format is null)
);

-- One row per Google family per artist: a second "Archivo" row would be a second family
-- token for the same stylesheet. lib/fonts.ts reuses the existing row instead of inserting.
create unique index if not exists artist_fonts_google_once
  on public.artist_fonts (artist_id, google_family)
  where source = 'google';

-- The publishable projection (PUBLISHABLE.artist_font reads it) gains the two columns, so they
-- ride the font's snapshot and reach the door. APPENDED after `slots`: CREATE OR REPLACE VIEW
-- keeps existing columns in place and may only add at the end, and the view's current eight
-- (id, artist_id, label, family, storage_path, format, created_at, slots — queried live
-- 2026-09-25) are listed by name rather than `f.*`, so `weight` (dashboard-only) still stays
-- out. security_invoker is restated; the view's grants are kept by the replace.
create or replace view public.artist_fonts_with_slots
with (security_invoker = on) as
  select f.id,
         f.artist_id,
         f.label,
         f.family,
         f.storage_path,
         f.format,
         f.created_at,
         coalesce(
           (select array_agg(s.slot order by s.slot)
            from public.artist_font_slots s
            where s.font_id = f.id and s.artist_id = f.artist_id),
           '{}'::text[]
         ) as slots,
         f.source,
         f.google_family
  from public.artist_fonts f;

-- BACKFILL the latest live artist_font revision of every font with the two new keys, as
-- they would be snapshotted today ('upload', null) — the 20260911120000 precedent. Without it
-- every published font reads "missing vs 'upload'" at its next publish and is re-written for
-- nothing (lib/content.ts also registers the default in SNAPSHOT_DEFAULTS, for the older
-- revisions a restore-to-a-moment can land on). A Google row cannot exist before this file,
-- so every published font is an upload.
with latest as (
  select distinct on (r.entity_id) r.id
  from public.revisions r
  where r.entity_type = 'artist_font' and r.entity_id is not null
    and coalesce((r.data ->> '_deleted')::boolean, false) = false
  order by r.entity_id, r.published_at desc, r.id desc
)
update public.revisions rv
   set data = rv.data || jsonb_build_object('source', 'upload', 'google_family', null)
  from latest l
 where rv.id = l.id and not (rv.data ? 'source');

-- ===========================================================================
-- 3. Colours and the browser-bar colour are PUBLISHABLE
-- ===========================================================================
-- `brand_color`: one revision per colour (PUBLISHABLE.brand_color reads brand_colors), the
-- snapshot carrying id, key, name, hex, slot, sort_order, created_at — never the note.
--
-- `theme_color`: the browser-bar colour, published BY THE BRAND PAGE. It lives on `artists`,
-- but it cannot ride the profile snapshot (ARTIST_SNAPSHOT): the profile publishes with the
-- whole site, so either the Brand publish would drag a half-written bio live, or the bar
-- colour could not be published from Brand at all. It is not a brand_colors row either (it
-- would join the palette, the cap and the key space). So it is its own singleton type, read
-- straight off `artists.theme_color` (lib/content.ts `themeColorRows`) as ONE row per artist
-- WHEN A COLOUR IS SET and none otherwise:
--   • never set, never published → no row → nothing to publish, no Publish bar;
--   • set → a row → "added" until published;
--   • cleared after publishing → the row is gone → Publish writes a tombstone → the door
--     reports null again.
-- entity_id is the artist's id, as for the `artist` profile singleton (a different entity
-- type, so latest-per-(type, id) never confuses them). No view: the read needs nothing the
-- `artists` row and its RLS (artists_select) do not already give.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media',
                         'site_content', 'video', 'release', 'site_styles', 'artist_font',
                         'brand_color', 'theme_color'));

-- ===========================================================================
-- 4. get_public_site: `brand`, and fonts that know where they come from
-- ===========================================================================
-- Re-created whole from 20260911120000. Changed: the `fonts` and `font_slots` branches read
-- through `fonts_live` (an upload needs its file, a Google font its well-formed name), each
-- font carries `source` (and `google_family` for a Google one — an upload's object is
-- byte-for-byte what it was, plus `source`), and `brand` is new. Everything else is verbatim.
--
-- `brand` is ALWAYS present: { colors: [], theme_color: null } before anything is published,
-- so a site reads it without a guard. Colours come in palette order — Primary, Secondary,
-- then the added ones by their order — and a row whose key or hex is not the shape the bridge
-- interpolates into CSS is dropped here: revisions are jsonb, and the door is the last place
-- that can refuse what a script wrote.
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug from public.artists where slug = p_slug
  ),
  ap as (
    select r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'artist'
    order by r.published_at desc, r.id desc
    limit 1
  ),
  live as (
    select entity_type, data, published_at
    from public.published_revisions((select id from a))
  ),
  -- The published fonts the site can actually load: an upload with its file, or a Google
  -- family with a name the css2 URL and the font-family string can carry. A revision older
  -- than 20260925120000 has no `source`: it is an upload.
  fonts_live as (
    select data, published_at
    from live
    where entity_type = 'artist_font'
      and data ->> 'family' is not null
      and (
        (coalesce(data ->> 'source', 'upload') = 'upload' and data ->> 'storage_path' is not null)
        or (data ->> 'source' = 'google'
            and coalesce(data ->> 'google_family', '') ~ '^[A-Za-z0-9]+( [A-Za-z0-9]+)*$')
      )
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      -- When the site last changed (SEO_GEO_PLAN B1): the newest revision of anything
      -- published for this artist. Sites use it as the sitemap's lastmod instead of the
      -- clock, so Google learns to trust it.
      -- ALL revisions, tombstones included: deleting a show and publishing changes the
      -- page too (20260826170000; `live` filters `_deleted` rows out).
      'published_at', (select max(r.published_at) from public.revisions r where r.artist_id = (select id from a)),
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(
                 -- on_site rides the snapshot now (20260910130000) so the door can read it;
                 -- it is a GATE, not content, and stays off the wire like audio_path.
                 (t.data - 'audio_path' - 'on_site')
                 || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
                 order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
        from live t
        left join public.tracks trk on trk.id = (t.data ->> 'id')::uuid
        where t.entity_type = 'track'
          -- Presence from the SNAPSHOT (20260910130000, PRESENCE_PLAN S1): a tick on the
          -- Music page is a draft until Publish. The live row is only the fallback for a
          -- revision older than the backfill.
          and coalesce((t.data ->> 'on_site')::boolean, trk.on_site, true)), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg((l.data - 'on_site') order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        -- Presence from the SNAPSHOT (20260911120000): a toggle on the Tour page is a draft
        -- until Publish. Live row only as a fallback for a revision older than the backfill.
        where l.entity_type = 'tour_date' and coalesce((l.data ->> 'on_site')::boolean, td.on_site, true)), '[]'::jsonb),
      'merch',      coalesce((
        -- Newest on top (PRESENCE_PLAN S2, Sam 2026-09-10: merch "should just get added to
        -- the front/top of the list"), and a dragged order wins where one exists. It was
        -- created_at ASCENDING — new products went to the bottom, and the editor's drag
        -- order never reached the site at all.
        select jsonb_agg((l.data - 'on_site') order by (l.data ->> 'sort_order')::int nulls last, (l.data ->> 'created_at') desc, l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        -- Same for merch (20260911120000): the toggle is a draft until Publish.
        where l.entity_type = 'merch' and coalesce((l.data ->> 'on_site')::boolean, m.on_site, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.links lnk on lnk.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'link' and coalesce(lnk.on_site, true)), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.on_site, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object(
                           'id', data ->> 'id',
                           'purpose', data ->> 'purpose',
                           'path', data ->> 'storage_path',
                           'orientation', data ->> 'orientation',
                           'site_role', data ->> 'site_role',
                           'label', data ->> 'label',
                           'collection', data ->> 'collection',
                           'alt', data ->> 'alt',
                           'kind', data ->> 'kind')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live
        where entity_type = 'media'
          and (data ->> 'purpose' <> 'gallery_image'
               or coalesce((data ->> 'on_site')::boolean, (data ->> 'visible')::boolean, true))
        ), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb),
      'styles', coalesce((
        select jsonb_object_agg(data ->> 'region_key', data ->> 'class_names')
        from live
        where entity_type = 'site_styles'
          and data ->> 'region_key' is not null
          and coalesce(data ->> 'class_names', '') <> ''), '{}'::jsonb),
      'fonts', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'family', data ->> 'family',
                   'label',  data ->> 'label',
                   'path',   data ->> 'storage_path',
                   'format', data ->> 'format',
                   'source', coalesce(data ->> 'source', 'upload'))
                 || case when data ->> 'source' = 'google'
                         then jsonb_build_object('google_family', data ->> 'google_family')
                         else '{}'::jsonb end
                 order by data ->> 'family')
        from fonts_live), '[]'::jsonb),
      'font_slots', coalesce((
        select jsonb_object_agg(slot, f.data ->> 'family')
        from fonts_live f
        cross join lateral jsonb_array_elements_text(f.data -> 'slots') as slot
        where jsonb_typeof(f.data -> 'slots') = 'array'), '{}'::jsonb),
      'brand', jsonb_build_object(
        'colors', coalesce((
          select jsonb_agg(jsonb_build_object(
                             'key',  data ->> 'key',
                             'name', data ->> 'name',
                             'hex',  data ->> 'hex')
                           order by case data ->> 'slot' when 'primary' then 0 when 'secondary' then 1 else 2 end,
                                    (data ->> 'sort_order')::int nulls last,
                                    (data ->> 'created_at'),
                                    published_at)
          from live
          where entity_type = 'brand_color'
            and coalesce(data ->> 'key', '') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
            and char_length(data ->> 'key') <= 40
            and coalesce(data ->> 'hex', '') ~ '^#[0-9a-f]{6}$'), '[]'::jsonb),
        'theme_color', (
          select data ->> 'theme_color'
          from live
          where entity_type = 'theme_color'
            and coalesce(data ->> 'theme_color', '') ~ '^#[0-9a-f]{6}$'
          limit 1))
    )
  end;
$$;

-- The public door, as it is today (anon, authenticated, service_role; queried 2026-09-25).
-- CREATE OR REPLACE keeps the ACL; restated so this file alone says who can call it.
revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated, service_role;
