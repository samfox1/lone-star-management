# 0008 — Per-region style overrides + the custom-site contract

Status: Accepted (shipped 2026-07-14/15; S0–S4 of `SITE_STYLING_PLAN.md`)

Supersedes the **styling clause** of ADR 0006 ("No layout / structure / styling
editing in v1"). The rest of ADR 0006 — content-updater-not-builder, the
editable-regions rulebook, the embedded frame, two-surfaces-one-publish — stands.

## Context

ADR 0006 ruled styling out of v1 to keep the editor a content updater rather than a
website builder. Two things changed that:

- **skeen is the real target, and it's a custom site.** Its look *is* the product;
  the parts a manager most wants to change (the hero wordmark, section rhythm) are
  class strings, not copy. Editing them meant a code change in a second repo.
- **ADR 0006 already promised custom sites would self-serve** via the rulebook. That
  contract had never been exercised end-to-end, and "the editor can edit everything
  except the thing this artist actually wants to change" is not self-serve.

The `site_kind` / `custom_site_url` half is here rather than in its own ADR because
it exists only to make the editor reach a custom site: the same decision, both ends.

## Decision

- **D-A · A dedicated `site_styles` table**, mirroring `site_content`, as a new
  publishable `revisions` entity_type. Rejected: namespacing `style:*` keys into
  `site_content` (muddies text semantics, forces the site to filter, different
  validation). Publish/diff pick it up for free (ADR 0002).
- **D-B · The value is a raw class string** (Tailwind/arbitrary utilities). Maximum
  freedom is the explicit goal. We sanitize (charset allowlist + 500-char cap,
  `cleanClassText`); we do **not** curate an allowed class list. The value lands in a
  `class` attribute, never in JS or a URL. A stored string **REPLACES** the region's
  base classes; clearing it restores the base. (Freeform per-region CSS is a deferred
  v2 `site_css` entity, not this.)
- **D-C · The draft reaches a custom frame by INJECTION over the bridge**, not by the
  site fetching drafts. lone-star already holds the working data RLS-scoped to the
  manager and posts it in `init-data`. The custom site never needs draft DB access or
  a service token — the RLS boundary stays in one place (ADR 0001). The payload is
  the **wire shape** (`PublicSitePayload`, media as raw `path`), not `SiteData`.
- **D-D · A custom site owns its manifest and posts it at runtime** in `ready`. The
  editor is fully data-driven and never hardcodes a custom site's regions. This makes
  ADR 0006's "custom site registers its own manifest" contract concrete.
- **D-E · Granularity is per-section AND per-item.** Per-item rows reuse
  `site_styles` with `region_key = '<slot>:<itemId>'` (e.g. `videos:<uuid>`); the
  first `:` splits unambiguously because item ids are UUIDs, matching the existing
  `data-lse-item` convention.
- **D-F · A custom artist's public `/[slug]` redirects to `custom_site_url`.** One
  canonical URL. `site_kind` / `custom_site_url` are **config, not content** — not in
  `ARTIST_SNAPSHOT`, never in `get_public_site`.

## Consequences

- ADR 0006's "no styling" line is void. The editor is still not a builder: a manager
  restyles **declared regions**; they cannot add, remove, or reorder structure.
- **Raw classes are a deliberate trust choice.** A manager can make their own site
  ugly or broken. That's accepted — it's their site, the blast radius is one artist's
  `class` attribute, and the sanitizer keeps it out of script/URL contexts.
- Custom sites carry real weight now: a bridge, an edit-list, an `/edit` route, and
  `NEXT_PUBLIC_EDITOR_ORIGIN` pinned to lone-star's origin. The protocol is
  **duplicated** in both repos (no shared package), so `BRIDGE_VERSION` only moves by
  coordinated edit — the pressure to keep the message set minimal is real, which is
  why unbuilt variants were deleted rather than left declared.
- The public route for a custom artist is a redirect, so lone-star renders no
  template for them — and `public_custom_site` had to become a SECURITY DEFINER door
  (`20260714170000`), because `/[slug]` is anonymous and `artists_select` RLS hides
  the row from a visitor (ADR 0001).
- Built-in templates gain nothing yet: their manifests declare `styles: []` and no DOM
  is style-tagged, so the editor's Style panel shows an empty state for them.
