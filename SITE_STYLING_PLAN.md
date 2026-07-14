# Site Styling Plan — per-region editable class names + skeen as the canonical custom site

_Companion to `SITE_EDITOR_PLAN.md` and ADR-0006. This plan closes the gap ADR-0006
deliberately left open ("No layout / structure / styling editing in v1") and wires the
Vercel **skeen-website** repo in as the first editable **custom site**._

## Goal

No hardcoded per-artist template. Every content section (image, text, video, embedded
video) carries **custom class names** stored as data and edited in the site editor, so each
artist's site formats itself. The Vercel **skeen-website** repo is the canonical public site;
lone-star stops rendering its own template for skeen and instead **edits skeen in place**.

This rides the rails that already exist (ADR-0002 draft→publish revisions, ADR-0006 manifest
+ markers + bridge). It adds exactly one new dimension: **style**, alongside the existing
field / slot / item dimensions.

## Repos

- **lone-star-management** (system of record): DB migration, `get_public_site` change, editor
  manifest/markers/bridge/save/inspector, custom-site wiring, publish path. Bulk of the work.
- **skeen-website** (companion PR): consume the new `styles` payload, mark regions, ship a
  runtime manifest, include the bridge in edit mode, render draft data injected by the parent.

Land lone-star first (payload is additive + backward compatible), then skeen.

---

## Architecture decisions

_Locked with Sam 2026-07-14._ D-A/D-C/D-D recommended; D-B and D-E confirmed below.

- **D-A · Storage = a dedicated `site_styles` table**, mirroring `site_content` exactly, as a
  new publishable `revisions` entity_type. Rejected alt: namespacing `style:*` keys into
  `site_content` (muddies text semantics, forces skeen to filter, different validation).
- **D-B · Value = raw class strings** (Tailwind/arbitrary utilities) — **LOCKED**. Max freedom,
  which is the explicit goal. We sanitize (charset allowlist + length cap), we do **not**
  restrict to a curated class list. Risk is low: the value lands in a `class` attribute, never
  in JS/URLs. (Freeform per-region CSS is a deferred v2 `site_css` entity, not this plan.)
- **D-C · Draft data reaches the skeen frame by injection over the bridge**, not by skeen
  fetching drafts. lone-star already holds the working `SiteData` (RLS-scoped to the manager);
  it posts it into the frame. skeen never needs draft DB access or a service token. Keeps the
  RLS boundary in one place (ADR-0001).
- **D-D · skeen owns its manifest and posts it at runtime** in the `ready` message. The editor
  becomes fully data-driven — it never hardcodes skeen's regions. This is the ADR-0006 phase-5
  "custom site registers its own manifest" contract, made concrete.
- **D-E · Granularity = per-section AND per-item — LOCKED.** Style is editable on whole
  sections (hero wordmark, hero video, a text block, the video list, gallery…) **and** on each
  individual item (a single video/embed/image). Per-item rows reuse the same `site_styles`
  table with `region_key = "<slot>:<itemId>"` (e.g. `videos:<uuid>`); the `:` split is
  unambiguous because item ids are UUIDs, matching the existing `data-lse-item` convention.
- **D-F · Public route = redirect — LOCKED.** For a `site_kind='custom'` artist, lone-star's
  `/[slug]` **301-redirects** to `custom_site_url`. One canonical URL (the Vercel site).

---

## 1 · Data model (lone-star migration)

New migration `supabase/migrations/<ts>_site_styles.sql`, modeled on
`20260624180000_site_content.sql`:

```sql
create table public.site_styles (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists (id) on delete cascade,
  region_key  text not null,               -- a manifest style-region key (e.g. 'hero_wordmark')
  class_names text,                          -- raw class string; null/'' => region's base classes only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (artist_id, region_key)
);
create index site_styles_artist_idx on public.site_styles (artist_id, region_key);
create trigger site_styles_updated_at before update on public.site_styles
  for each row execute function public.set_updated_at();

alter table public.site_styles enable row level security;
create policy site_styles_rw on public.site_styles
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- Publishable entity: allow in revisions.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions add constraint revisions_entity_type_check
  check (entity_type in ('artist','track','tour_date','merch','link','media','site_content','site_styles'));
```

Custom-site columns on `artists` (same migration or a sibling):

```sql
alter table public.artists
  add column site_kind text not null default 'template'      -- 'template' | 'custom'
    check (site_kind in ('template','custom')),
  add column custom_site_url text;                            -- e.g. https://skeen-website.vercel.app
```

Register `site_styles` in the publishable registry so it reconciles into `revisions` like every
other entity: `src/lib/content.ts` (the `PublishableEntity` list) + wherever `listContent` /
`publicSnapshot` enumerate entity types. Snapshot shape: `{ id, region_key, class_names }`,
tombstoned via `_deleted` like the rest.

## 2 · Publish read path (`get_public_site`)

Extend the SQL function (new `create or replace` migration) to emit a `styles` object, exactly
parallel to how `site_content` is built:

```sql
'styles', coalesce((
  select jsonb_object_agg(data->>'region_key', data->>'class_names')
  from live where entity_type = 'site_styles'
    and coalesce(data->>'class_names','') <> ''
), '{}'::jsonb)
```

`SiteData` (`src/lib/site.ts`) gains `styles: Record<string, string>`. `getWorkingSite` builds
the same object from working rows so preview == live (ADR-0004).

## 3 · Editor infrastructure (lone-star `src/lib/site-editor/`)

**markers.ts** — new style marker + helper:
```ts
export const STYLE_ATTR = 'data-lse-style'
export function styleRegion(editable: boolean, key: string): Record<string,string> {
  return editable ? { [STYLE_ATTR]: key } : {}
}
```

**manifest.ts** — new region kind. A style region is any element whose class string is editable:
```ts
export type ManifestStyleRegion = { key: string; label: string; base?: string } // base = non-editable classes
export type TemplateManifest = { template: string; fields: ManifestField[]; slots: ManifestSlot[]; styles: ManifestStyleRegion[] }
```
A field/slot key MAY double as a style-region key (the same element carries both
`data-lse-field` and `data-lse-style`), or a style region can stand alone (a section wrapper
that has no text/slot to edit but should be re-styleable).

**bridge.ts** — bump `BRIDGE_VERSION` to `2`; add the style dimension:
```ts
export type SelectTarget = … | { kind: 'style'; key: string }
// frame → editor: carry the manifest so the editor is data-driven for custom sites
| { v:number; source: typeof FRAME_SOURCE; type:'ready'; manifest?: TemplateManifest }
// editor → frame: optimistic style apply + draft-data injection
| { v:number; source: typeof EDITOR_SOURCE; type:'apply-style'; key:string; className:string }
| { v:number; source: typeof EDITOR_SOURCE; type:'init-data'; site: SiteData }   // D-C injection
```
The receiver still MUST validate `event.origin` (custom-site origin is the artist's
`custom_site_url`; allowlist it) in addition to the `source`/version guards.

**save.ts** — new writer, parallel to `saveEditorField`:
```ts
export async function saveEditorStyle(sb, artistId, regionKey, className): Promise<{ok:boolean;error?:string}> {
  const clean = sanitizeClassName(className)           // charset allowlist + length cap (see below)
  if (clean === '') { /* delete row => back to base classes */ }
  else { /* upsert {artist_id, region_key: regionKey, class_names: clean} onConflict artist_id,region_key */ }
}
```
`sanitizeClassName`: trim, cap length (~500), allow only `[A-Za-z0-9 _:\-\/\[\]().,%#!]` (covers
Tailwind arbitrary values like `text-[clamp(3rem,12vw,11rem)]` and variants like `hover:`,
`sm:`, `!`), strip `<>"'{}` and backticks. Reject on any stripped char rather than silently
mangling. A server action wrapper `saveEditorStyleAction` adds auth + revalidate, like the field one.

**Inspector (Phase 2 panel)** — when the selected target is `{kind:'style'}` (or any region that
is also style-marked), show a "Style" text input bound to the region's current class string.
On change: optimistic `apply-style` to the frame + debounced `saveEditorStyleAction`. Mirrors
the existing debounced field-save (`tests/editor-inspector.test.tsx` shows the pattern).

## 4 · skeen-website (companion repo)

1. **Consume styles.** `lib/backend.ts` `PublicSite` type + `lib/mapSite.ts` map `styles` into
   the view models. Each component merges its region's class string:
   `className={cx("<base classes>", styles.hero_wordmark)}`. The Hero wordmark becomes
   `className={cx("fx-glitch-mono font-glitch …", styles.hero_wordmark)}` — so the font is now
   editor-controlled, which is exactly the change that started this thread.
2. **Ship a manifest.** `lib/site-editor/manifest.ts` exporting the skeen manifest (fields,
   slots, styles) — one `ManifestStyleRegion` per stylable section (hero wordmark, hero video,
   each text block, each video/embed, gallery, etc.).
3. **Mark regions in edit mode.** Thread an `editable` flag (true only when `?lse=edit` + valid
   origin) and spread `styleRegion(editable, key)` / `fieldRegion(...)` onto each section.
   Public renders carry no markers (helpers return `{}` off edit mode).
4. **Bridge + draft injection (D-C).** In edit mode skeen does NOT call `get_public_site`; it
   waits for the parent's `init-data` message and renders that `SiteData`, posts `ready` with
   its manifest, reports clicks as `select`, and applies optimistic `apply-field` / `apply-style`.
   The bridge script loads only in edit mode.

## 5 · Custom-site wiring (lone-star)

- `ArtistTemplate` dispatcher: when `artist.site_kind === 'custom'`, do not render a built-in
  template. Public `/[slug]` for a custom artist redirects to `custom_site_url` (or renders a
  thin canonical-link stub) — canonical is the Vercel site.
- Editor edit-mode frame: embed `custom_site_url` + `?lse=edit`, post `init-data` with the
  working `SiteData`, and drive it over the (now v2) bridge. `event.origin` allowlist =
  the artist's `custom_site_url` origin.
- Flip skeen's artist row: `site_kind='custom'`, `custom_site_url='https://skeen-website.vercel.app'`.

## 6 · Publish path

Nothing new structurally: `site_styles` is a publishable entity, so it flows through the same
draft → review-and-approve → publish window (SITE_EDITOR_PLAN.md Phase 4) and lands in
`revisions`, surfaced by `get_public_site`. Selective per-change publish gets style rows for free.

## 7 · Phasing / build order

- **S0 · Migration + payload** (lone-star): `site_styles` table, registry, `get_public_site` +
  `SiteData.styles`, `artists.site_kind/custom_site_url`. Additive, backward compatible. _Size M._
- **S1 · Editor rulebook for style** (lone-star): markers `data-lse-style`, manifest `styles`,
  bridge v2 (`apply-style`, `init-data`, `ready.manifest`, `select style`), `saveEditorStyle` +
  action + `sanitizeClassName`. Unit-tested, no UI. _Size M._
- **S2 · skeen consumes styles** (skeen): map `styles`, merge into every section's className,
  including the Hero wordmark. Ships value even before the editor UI. _Size S–M._
- **S3 · skeen as editable custom site** (skeen): manifest, markers in edit mode, bridge +
  `init-data` rendering, edit-mode gate. _Size L._
- **S4 · Editor inspector "Style" control + custom-frame embed** (lone-star): inspector input,
  origin allowlist, embed `custom_site_url?lse=edit`, `init-data` post, flip skeen's row. _Size L._
- **S5 · Publish + review** already covered by Phase 4; verify style rows ride the window.

Order: S0 → S1 ‖ S2 → S3 → S4 → S5. S2 can ship independently and immediately makes the site's
classes data-driven (even if edited via SQL) before the visual editor exists.

## 8 · Testing

- lone-star: `site_styles` RLS (owner-only), `get_public_site` emits `styles` and drops
  tombstoned/empty rows, `sanitizeClassName` (accepts Tailwind arbitrary values + variants,
  rejects `<>"'{}`), bridge v2 guards + `origin` check, preview==live parity for styles.
- skeen: mapSite merges styles, sections fall back to base classes when a key is absent,
  markers only present in edit mode, `init-data` renders without a network fetch.

## 9 · Resolved (was: open questions) — 2026-07-14

1. D-A…D-D confirmed. **D-B raw class strings** locked.
2. Granularity: **per-section AND per-item** (D-E). Item rows keyed `region_key="<slot>:<itemId>"`.
   skeen marks items with both `data-lse-item` and `data-lse-style`; the inspector shows the
   Style control for a selected item as well as a section.
3. Custom `/[slug]`: **301-redirect** to `custom_site_url` (D-F).
4. Scope = class strings only. Freeform per-region CSS deferred to a v2 `site_css` entity.
```
