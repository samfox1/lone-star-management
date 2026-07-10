# 0006 — Visual site editor: editable-regions rulebook + embedded-frame

Status: Accepted (types landed 2026-07-10; UI phases in progress — see `SITE_EDITOR_PLAN.md`)

## Context

ADR 0004 foresaw a "site editor" that lifts hardcoded template strings into
editable per-artist data, with each template declaring its editable field schema.
We're building it. Constraints:

- The brief rules out a drag-and-drop **website builder** (ADR 0004). Managers need
  to update the artist details that change over time — text, images, videos,
  embedded music — and choose what's on the site and where.
- Sites vary: the built-in templates (`classic` / `cinematic`) **and fully custom
  sites**. The editor must work on all of them without knowing each site's layout.
- Preview must stay a true render of the live site (ADR 0004) — the same component
  and `SiteData` shape.

## Decision

- **Content updater, not a builder.** The only editable things are a fixed set:
  declared text, images, embedded music, and library **slots** (tracks / videos /
  photos / merch / tour / links). No layout / structure / styling editing in v1.
- **A shared editable-regions rulebook** (`src/lib/site-editor/`). Every site —
  template or custom — declares a **manifest** (`manifest.ts`): editable **fields**
  (text/image → a `site_content` key, an artist column, or a `media` purpose) and
  **slots** (a section → a `LibraryAsset`). It marks its DOM with
  `data-lse-field` / `data-lse-slot` / `data-lse-item` (`markers.ts`). The one
  editor reads the manifest + markers; it never hardcodes a site's layout.
  `TEMPLATE_FIELDS` (ADR 0004's per-template schema) grows into the manifest.
- **The real site renders in an embedded frame** in an authenticated **edit mode**
  (draft `SiteData` + markers + a bridge script). Only a frame renders a custom
  site faithfully and isolates its CSS/JS from the dashboard. The editor talks to
  the frame over a versioned, `source`-discriminated **postMessage bridge**
  (`bridge.ts`); the receiver MUST also validate `event.origin`. The bridge script
  loads only in edit mode, never on the public `/[slug]`.
- **Two surfaces, one publish path.** The Assets pages are the **library** (an
  asset's details, saved as draft). The editor controls what's on the site +
  placement + site text/images. Everything goes live through a single
  **review-and-approve** window (password-gated, per-change approval) — no
  instant-live path (extends the publish model, ADR 0002).
- **Custom-site adoption contract:** a custom site becomes editable the moment it
  ships a manifest, marks its regions, and includes the bridge in edit mode.

## Consequences

- One editor covers every site; custom sites self-serve without bespoke editor
  work — the cost is that each site must implement the rulebook.
- The manifest is the single home for "what's editable" — adding an editable field
  is a manifest entry + a marker in the template.
- Per-item site placement needs a uniform on-site flag; tracks moved off the
  Released derivation onto `visible` for exactly this (ADR 0007).
- The review-and-approve publish requires **selective, per-entity** publish
  granularity — a departure from the whole-type reconcile in ADR 0002, built in a
  later phase (see `SITE_EDITOR_PLAN.md` phase 4).
- The `event.origin` check + edit-mode-only bridge script are the security
  boundary; draft data is RLS-scoped and never public (ADR 0001).
