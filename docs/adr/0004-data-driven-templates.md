# 0004 — Data-driven, per-artist selectable site templates

Status: Accepted

## Context

The brief explicitly rules out a drag-and-drop website builder ("a content
dashboard over a clean template you control"). We still need different artists to
have visually distinct sites, and the same data to render in preview and live.

## Decision

- Templates are **React components that render from a single `SiteData` shape**
  (`getPublishedSite` for live, `getWorkingSite` for preview). We never hand-edit
  per-artist markup.
- Each artist has a `template` column; an `ArtistTemplate` dispatcher picks the
  component (`classic` | `cinematic`) for both `/[slug]` and `/preview`. Adding a
  template = a new component + a registry entry; any artist can select any
  template (it's in the draft/publish lane — see ADR 0002).
- A template's theme is **self-contained and scoped** (e.g. the cinematic dark
  palette lives under a `.theme-cinematic` class so it never leaks into the light
  dashboard). Fonts are loaded once in the root layout.
- All untrusted URLs that render on the public site go through `safeHref`
  (scheme allowlist) to prevent `javascript:`/`data:` stored XSS; free text is
  rendered escaped (no `dangerouslySetInnerHTML`).

## Consequences

- Preview is a true visual preview of the live site (same component, same data).
- A future "site editor" lifts hardcoded template strings (taglines, headings)
  into editable per-artist data so they're content too; each template will
  declare its editable field schema (see `DASHBOARD_PLAN.md` §4.5).
- Per-artist media that templates need but the data model doesn't carry yet
  (e.g. hero videos) is bridged via Storage + the `media` table by `purpose`.
