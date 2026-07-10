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

## The rulebook + bridge (defined in Phase 0)

- **Manifest** (`lib/site-editor/manifest.ts`): per template, a list of editable
  **fields** (key, label, type: text | image | …, target: site_content key /
  artist column / media purpose) and **slots** (section key, accepted asset type,
  ordering source). `TEMPLATE_FIELDS` grows into this.
- **DOM markers** the template emits in edit mode:
  - `data-lse-field="hero_tagline"` — an editable atom (text/image).
  - `data-lse-slot="tracks"` — a section that accepts library items.
  - `data-lse-item="track:<id>"` — a placed item (for select/remove/reorder).
- **Bridge protocol** (`lib/site-editor/bridge.ts`, postMessage): frame→editor
  `{selected, fieldKey|itemId, rect}`; editor→frame `{applyValue, highlight,
  setDevice}`. Small, typed, versioned.

A **custom site is editable** the moment it (a) emits these markers, (b) includes
the bridge script in edit mode, and (c) ships a manifest. That's the adoption
contract (Phase 5 writes the guide).

## Phases

### Phase 0 — Rulebook spec + types (keystone, no UI)

- Write the manifest type + marker convention + bridge protocol as typed modules
  and a short spec section in this doc. D1/D2/D3 are resolved above — encode them.
- Grow `site-content-schema.ts` into the manifest for the first template.
- **Verify:** types compile; a paper walkthrough maps every section to a field or slot.
  **Size:** M. **Depends on:** nothing.

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

### Phase 1 — Instrument one template + edit-mode frame

- Emit `data-lse-*` markers from the first template (recommend the one a real
  artist runs), driven by the manifest, **only in edit mode**.
- Add the edit-mode render route (draft `SiteData` + markers + bridge script);
  reuse `getWorkingSite`. Keep `/preview` as-is or fold it in.
- **Verify:** load the frame, click a tagged region, see the correct
  `{fieldKey|itemId}` postMessage in the console. No editor UI yet.
- **Size:** M. **Depends on:** Phase 0.

### Phase 2 — Editor shell + inspector (text + image fields) → first usable slice

- Replace the Site page with the full-screen editor: iframe the edit-mode route +
  inspector + device toggle.
- Bridge wiring: click field → inspector shows its control (text input / image
  picker from uploads·Drive·gallery) → optimistic apply in the frame → **debounced
  autosave to draft** (site_content upsert / artist hero / media actions).
- **Publish** button = the existing site publish bundle, behind the password gate
  (interim; Phase 4 swaps in the review-and-approve window).
- **Verify:** edit a heading + swap the hero, see it live in the frame, reload
  (draft persists), Publish, confirm on `/[slug]`. Component + action tests.
- **Size:** L. **Depends on:** Phase 1. **Ships v1 slice A** (site text + media).

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
