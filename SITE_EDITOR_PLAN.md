# Visual Site Editor — phased implementation plan

_Drafted 2026-07-10 from the /grill-me session. This is the plan of record for the
next phase: an interactive, click-to-edit site editor._

## Goal

Managers edit their artist's website in a live view: the real site loads in an
embedded frame, they click a section, and a side **inspector** edits it. Text and
images/video in v1; fonts/colors and layout in v2.

**This is a CONTENT UPDATER, not a website builder** (clarified 2026-07-10). It does
NOT touch layout, structure, or styling. The only editable things are a fixed set:

- **images / photos**
- **videos**
- **embedded music** (tracks/players)
- **specific declared text** (the artist details that change over time — headings,
  hero copy, about, booking email)

Because the surface is this constrained, a **custom site** only has to _declare its
content groups_ ("this block is the image group, this is the video group, this text
is the hero tagline"). It never has to expose its whole layout. That makes "one
editor works on every site" realistic, and keeps the click-to-highlight simple
(we only ever highlight whole declared groups + declared fields, never arbitrary
nested elements).

## Decisions locked (from the grill)

1. **Interaction:** inspector panel — click a section in the frame → it highlights
   → a side panel edits that section's fields. Not free-form WYSIWYG.
2. **v1 scope:** section text + images/video. Fonts/colors, section add/remove/
   reorder, and rich text are **v2**.
3. **Two surfaces, ONE publish path** (revised 2026-07-10):
   - **Library (Assets pages)** = an asset's _details_ (title, contributors, cover,
     file). **Save = saves the draft only.** Does not control the site, does not go live.
   - **Visual editor** = what's _on_ the site, where it sits, and the site's own
     text/images. Also draft.
   - **Everything** goes live through ONE **review-and-approve window**: a list of
     pending changes → toggle each to approve → type the password → publish only the
     approved ones. No instant-live path.
4. **Released ≠ on-site** (revised 2026-07-10): Released/Unreleased is now purely a
   LIBRARY organizing label with NO effect on the public site. On-site for tracks
   uses an explicit per-track flag (`tracks.visible`, already exists, dormant),
   exactly like merch/videos/tour. The public doors gate tracks on `visible`, not
   on Released. This resolves D1 and unwinds the Released-only door logic.
5. **Content updater, not a builder** (clarified 2026-07-10): editable = a fixed set
   (images/photos, videos, embedded music, declared text). No layout/structure/style
   editing. Custom sites only declare their content groups + fields.
6. **Editor boundary:** clicking an on-site item edits **presence + position**
   (add / remove / reorder / which section). Detail edits shortcut to the library.
7. **Add to site:** each section has **"+ Add from library"** (a picker of that
   type's off-site assets); reorder by **drag within the section**.
8. **Save model:** optimistic live preview + **autosave to a private draft**; go live
   only through the review-and-approve window (decision #3).
9. **Architecture keystone:** a shared **editable-regions rulebook** every site
   (template _or_ custom) tags itself with. One editor reads the tags.
10. **Render:** the real site loads in an **embedded frame** in an "edit mode"
    (draft data + tags + a bridge script). Only approach that supports custom sites.
11. **Placement:** replaces today's form-based Site page. Desktop + mobile toggle.
    Text is plain in v1, field model built so rich text can slot in later.

## How today's code maps to this

- `SiteData` (`src/lib/site.ts`) is the one shape both public (`getPublishedSite`)
  and draft (`getWorkingSite`) render. `ArtistTemplate` picks the template.
- Editable text is already a **per-template field schema** (`site-content-schema.ts`,
  `TEMPLATE_FIELDS`) — the seed of the rulebook.
- `/artists/[id]/preview` already renders **draft** `SiteData` with the real
  template — the seed of the edit-mode frame.
- Publish pipeline: `publishContent(type)` snapshots working rows → `revisions`;
  visibility via a `visible` flag + `reconcileVisibility`; the public doors read
  the latest snapshot. `publishSiteAction` bundles profile + site_content + media.

## Open design decisions (resolve inside Phase 0 — flagged, not yet decided)

### D1 — The "on-site" model — RESOLVED 2026-07-10 (decouple Released from site)

Released/Unreleased becomes a **library-only organizing label**; it no longer gates
the public site. On-site becomes a uniform per-item `visible` flag across ALL types:

| Type       | On-site gate after this change                       |
| ---------- | ---------------------------------------------------- |
| tour_date / merch / video / release | `visible` flag (already used) ✔     |
| link       | `visible` column exists — **wake it** ✔               |
| track      | `tracks.visible` (added `20260708150000`, dormant) — **wake it** ✔ |

Work this implies:
- **Doors flip from Released-gate to visible-gate.** `get_public_site` (tracks
  branch) and `audio_path_for_play` gate on `tracks.visible`, not on
  `music_track_on_platform` / release-inheritance. The Released-only door migrations
  (`20260709120000`, `20260710150000/160000`) get largely superseded; the
  `released` flag survives only as a library filter (`lib/music.ts` stays for that).
- **`getWorkingSite` tracks filter** flips from Released bucket → `visible`.
- **Cutover backfill (one migration):** `tracks.visible` defaults `true`, so at the
  switch, backfill `visible` from each track's current Released state so nothing
  appears/disappears unexpectedly. Same care for links.
- Ordering stays `sort_order`. No new placement table needed for v1; a uniform
  section/slot table is still the v2 option if cross-section moves demand it.

### D2 — Publish granularity — REPLACED 2026-07-10; pressure-tested

ONE publish path: a **review-and-approve window** (decision #3). Pressure-test verdict:
**~70% already built** — `diffUnpublished` (content.ts) already compares each working
row's public snapshot to its latest published revision, field-by-field over a per-type
allowlist, classifying added/edited/deleted with no false positives. It emits COUNTS
today; the window surfaces + phrases + selectively publishes what it already computes.

**Granularity = ENTITY-level** (a revision is a whole-entity snapshot; field-level
mixing would need synthetic snapshots that break ADR-0002's "faithful snapshot"
invariant). Entity-level == field-level for everything EXCEPT the artist profile,
because text is already one `site_content` row per key and every photo/video/song/
merch is its own row. **Unlock:** move the editable profile fields (bio, hero) into
the per-key store → then every editable thing is independently publishable, no
synthetic snapshots.

Three genuinely new pieces:
1. **Item-level diff** — extend `diffUnpublished` to emit `{type,id,kind,
   changedFields:[{key,from,to}]}` instead of counts. It already computes this. Small.
2. **Phrasing + grouping** — raw diffs → human lines. The grouping is fiddly: a
   reorder is N `sort_order` changes that must read as ONE change.
3. **`publishSelected(approvedIds)`** — the core engine change. Replaces the
   whole-type `publishContent` reconcile: snapshot/tombstone ONLY approved entities,
   leave the rest in draft.

Sharp edges:
- **Reorder = one atomic approval per section** (approving half leaves order inconsistent).
- **Diff the EDITABLE surface, not the full snapshot** — the track snapshot carries
  provenance fields; a sync could dirty them and show phantom changes (the #13
  false-dirty bug). Separate _what publishes_ (full snapshot) from _what's a user
  change_ (manifest fields + placement).
- **Deletes** work (not-tombstoning keeps the live copy up = pending removal), but a
  library delete hard-deletes the draft row → "undo before publish" is clumsy;
  consider soft-delete or a confirm.
- **Cross-entity refs** (song.release_id → unpublished release): the door tolerates a
  missing release, so low risk; auto-bundle dependents later.

### D3 — Draft-frame authentication

The edit-mode frame must render **private draft** data (not public). Reuse the
`/artists/[id]/preview` auth model (proxy-protected + RLS): the frame route lives
under `/artists/[id]/…`, so a non-owner 404s. The public `/[slug]` route stays
published-only. The bridge script loads **only** in edit mode, never on the public
site.

## The rulebook + bridge — IMPLEMENTED (phase 0, `src/lib/site-editor/`)

- **Manifest** (`manifest.ts`): per template, editable **fields**
  (`ManifestField` = key, label, type `text|email|image|richtext`, target
  `site_content` key / `artist` column / `media` purpose) and **slots**
  (`ManifestSlot` = key, label, `accepts: LibraryAsset`). Built from
  `TEMPLATE_FIELDS` + profile fields (name/bio/hero) + library slots. `manifestFor`
  / `fieldByKey` / `slotByKey` accessors. Classic is fully specified; cinematic is a
  first cut (confirmed when its DOM is instrumented).
- **DOM markers** (`markers.ts`) the template emits in edit mode — string helpers
  only, no DOM access:
  - `data-lse-field="hero_tagline"` — an editable atom (text/image).
  - `data-lse-slot="tracks"` — a section that accepts library items.
  - `data-lse-item="track:<uuid>"` — a placed item (`itemMarker`/`parseItemMarker`).
- **Bridge protocol** (`bridge.ts`, postMessage): `FrameMessage` (frame→editor:
  ready/select/geometry/deselect) and `EditorMessage` (editor→frame:
  apply-field/highlight/set-device/refresh), each versioned (`BRIDGE_VERSION`) and
  `source`-discriminated. `frameMessage`/`editorMessage` stampers +
  `isFrameMessage`/`isEditorMessage` guards. **Phase 2 must also check
  `event.origin`** — the guards are a shape check, not an origin check.
- Coverage locked by `tests/site-editor.test.ts` (pure, no DB).

A **custom site is editable** the moment it (a) emits these markers, (b) includes
the bridge script in edit mode, and (c) ships a manifest. That's the adoption
contract (Phase 5 writes the guide).

## Phases

### Phase 0 — Rulebook spec + types (keystone, no UI) — DONE 2026-07-10

- ✅ Manifest / marker / bridge typed modules in `src/lib/site-editor/`
  (manifest.ts, markers.ts, bridge.ts), grown from `TEMPLATE_FIELDS`.
- ✅ Coverage test `tests/site-editor.test.ts` (14 cases, pure): manifest covers
  every declared site-text field, slots present, marker round-trip, bridge guards.
- ✅ tsc + eslint clean. **Depends on:** nothing.

### Phase 0.5 — Decouple Released from the site (prerequisite data change)

The whole "on-site" model depends on this (D1). Do it before the editor touches placement.

- Flip `get_public_site` (tracks branch) + `audio_path_for_play` to gate on
  `tracks.visible` instead of the Released helpers. Wake `tracks.visible` +
  `links.visible`. `released` stays as a library-only label.
- Flip `getWorkingSite`'s track filter from Released bucket → `visible`.
- **Cutover backfill migration:** set `tracks.visible`/`links.visible` from current
  Released/public state so nothing appears/disappears at the switch. Push it.
- Move the editable profile fields (bio, hero) toward the per-key store so every
  editable thing is independently publishable (enables clean per-item approval).
- **Verify:** existing music-doors tests updated to `visible`-gating stay green; a
  visible=false Released track is off the site; a visible=true Unreleased track is on.
  **Size:** M–L. **Depends on:** nothing (can start immediately, even before Phase 0).

### Phase 1 — Instrument one template + edit-mode frame — CODE DONE 2026-07-10 (browser-test pending)

- ✅ `markers.ts` region helpers + `bridge-client.ts` (frame side: resolve click →
  nearest marked region, `mountFrameBridge` → `select` postMessage, origin-checked,
  preventDefault on marked clicks).
- ✅ **cinematic** instrumented (Shows/Videos/About emit slot + field + item markers
  via an `editable` flag threaded through `ArtistTemplate`). Classic follows later.
- ✅ `/artists/[id]/edit-frame` — draft `SiteData` + `editable` + the bridge;
  RLS-scoped like `/preview`, never on the public site.
- ✅ Tests test-first (region helpers, click→target, marker emission); 527 green.
- ⏳ **Browser verify:** load the frame, click a heading/song, confirm the `select`
  message. Do before push. **Depends on:** Phase 0.

### Phase 2 — Editor shell + inspector — CHROME + PANEL STRUCTURE DONE 2026-07-11; data-wiring/publish pending

- ✅ Editor shell at `/artists/[id]/editor` (centered "Edit site" nav tab): the
  approved chrome — left inspector + the site frame below the nav, with the device
  select / save status / Publish floating in the gap above the centered window (no
  toolbar bar). Design locked via `/design-variations-html`.
- ✅ **Inspector panel structure** (`editor-inspector.tsx`, test-first, jsdom): two
  states — BROWSE (component-type list: Images/Text/Links/Videos/Music/Merch, real
  `Icon`s) and EDITING (the browse list collapses to a bottom switcher strip; tools
  above). The photo-collection tools render the accordion (Photos grid w/ drag-grip +
  remove + Add, Sizing = collection slider + per-image segmented, Layout = display +
  columns stepper). Design synthesized from the panel `/design-variations` round
  (V4 accordion + V3 grid/columns + V2 slider + V1 no-line rows).
- 🔶 **Wire the tools to real data — Images slice DONE 2026-07-11.** `editor/page.tsx`
  fetches the artist's real `gallery_image` media → the panel's Images shows the real
  photo count + thumbnails (`mediaUrl`), and **remove** is wired to `deleteMediaAction`
  (optimistic, reverts on error). "Add photos" links to the Assets → Photos uploader.
  Still ⏳: **drag-reorder** (needs a `sort_order` write action) and **sizing** (no
  schema — collection/per-image size + display/columns are visual-only for now), plus
  the other component types (Text/Links/Videos/Music/Merch) and reconnecting the text
  write path (`saveEditorField` / `saveEditorFieldAction`, kept in
  `lib/site-editor/save.ts` + `actions.ts`) through the panel.
- ⏳ **Image fields** (hero / profile photo) — media pick/upload control + the
  hero-media mapping TODO (see the TODO in cinematic.tsx).
- ⏳ **Publish** from the editor — button present but inert; edits are draft-only (the
  existing Manager tools → Site → Publish still works). Review-and-approve = Phase 4.
- **Depends on:** Phase 1. **Ships v1 slice A** once the tools + a publish affordance land.

### Phase 3 — List slots: add / remove / reorder on-site items

- Emit slot + item markers for the list sections. Section UI in the editor:
  **"+ Add from library"** picker (off-site assets of that type), remove, and
  **drag-reorder** (writes `sort_order`).
- Persist to draft via existing actions: a uniform `visible` flag + `sort_order`
  across all types (Phase 0.5 made tracks/links use `visible`). Publish via the
  review window (Phase 4).
- **Verify:** add a song from the library to the site, reorder, remove, publish;
  `/[slug]` matches. Tests over the placement actions.
- **Size:** L. **Depends on:** Phase 2 + Phase 0.5. **Ships v1 slice B** (presence +
  position). **v1 is complete after this.**

### Phase 4 — Review-and-approve window + selective publish (D2)

- **Item-level diff:** extend `diffUnpublished` to emit per-change
  `{type,id,kind,changedFields}` over the EDITABLE surface (manifest fields +
  placement), not the full snapshot (avoids the #13 phantom-change bug).
- **Phrasing + grouping:** raw diffs → human lines; group a section reorder into ONE
  atomic change.
- **`publishSelected(approvedIds)`:** snapshot/tombstone only approved entities, leave
  the rest draft. Replaces the whole-type `publishContent` reconcile at the call sites.
- **Window UI:** list pending changes → toggle each → password → publish approved.
  Remove on-site/publish curation from the Assets pages (library only edits details now).
- **Verify:** make several edits, approve a subset, publish; only those go live, the
  rest stay pending; a reorder approves atomically. Tests on `publishSelected` +
  item-diff. **Size:** L. **Depends on:** Phase 2 (real publishing from the editor).

### Phase 5 — Second template + custom-site adoption guide

- Instrument the second built-in template against the same manifest/markers.
- Write "how a custom site adopts the rulebook" (markers + bridge + manifest) so
  bespoke sites become editable. **Verify:** a scratch custom page with the markers
  is fully editable through the same editor. **Size:** M.

### Phase 6 — v2 seeds (not built now)

Fonts & colors theming (needs a per-artist theme-token system — the biggest v2
piece), section add/remove/reorder (likely a uniform section/slot placement model),
and rich text (extend the text field type + a sanitizer). Noted so v1 doesn't paint
into a corner.

## Cross-cutting

- **Testing:** TDD per repo norms — actions/logic get vitest against the hosted DB;
  editor pieces get the jsdom component harness (mocked actions). Full vitest + tsc
  + lint + build before "done."
- **Migrations:** the Phase 0.5 decoupling needs a **door change + cutover backfill**
  migration (waking `visible` on tracks/links). Otherwise v1 leans on existing
  columns; a uniform placement table is a v2 option — all via `supabase db push`.
- **Security:** every rendered URL still routes through `safeHref`; the bridge only
  loads in edit mode; draft frame is RLS-scoped and never public.

## Suggested build order

Phase 0.5 (decouple, standalone) ‖ Phase 0 (rulebook) → 1 → 2 (ship slice A) → 3
(ship v1) → 4 (review window). Phase 0.5 and Phase 4 can each proceed in parallel
with the frame work.
