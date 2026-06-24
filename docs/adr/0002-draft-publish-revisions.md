# 0002 — Draft → publish via a `revisions` snapshot layer

Status: Accepted

## Context

Managers edit content, then want to review it before fans see it. The public
site must show only what was deliberately published, never in-progress edits.

## Decision

- **Working rows** (the content tables + the `artists` profile row + `media`)
  hold the editable/draft state.
- **Publishing** snapshots the public-safe projection of each working row into a
  `revisions` table (`entity_type`, `entity_id`, `data` jsonb, `published_at`).
  `get_public_site` serves the **latest non-tombstone revision per entity**.
- **Reconcile-on-publish**: publishing a type snapshots every current working row
  AND writes a `{"_deleted": true}` **tombstone** for any previously-published
  entity that no longer has a working row, so deletes leave the live site. The
  public read drops entities whose latest revision is a tombstone.
- **What is content vs config** (the field-classification decision, locked by the
  user): everything **fan-visible** is content and waits for publish — including
  the artist's name, bio, hero image, **template**, and `spotify_artist_id`, plus
  all tracks/tour dates/merch/links and media. They version together so the site
  changes as one coherent unit. Operator **config** (SEO, account, future custom
  domain/visibility) applies instantly, outside the draft/publish flow.
- The artist profile is published as a **singleton** (`publishProfile` → one
  `entity_type='artist'` revision, no tombstone). Media + content publish through
  the **row-reconcile** loop (`publishContent`). `publishAll` publishes content +
  media first, then the profile **last** — a site is "live" exactly when its
  profile revision exists, so a partial failure can't flip a never-published site
  live with empty content.
- A site is **not live** until its profile is published at least once
  (`get_public_site` returns null → `/[slug]` 404s). Seeds/backfills publish
  profiles so existing/seeded artists render.
- **Preview** (`getWorkingSite`) renders the SAME `SiteData` shape from the live
  working rows, so `/preview` matches `/[slug]` after publish (a parity test is
  the canary).

## Consequences

- One mechanism (snapshots in `revisions`) powers draft/publish, history,
  preview parity, and admin revert. Adding a publishable entity = a registry
  entry + a CHECK-constraint value (see ADR 0003).
- Media draft is **reference-level**, not object-level: the `media` bucket is
  public, so an unpublished/just-deleted file is still fetchable by URL — it is
  simply not *referenced* by the published site. Deleting media keeps the storage
  object until the deletion is published (so the live site never points at a
  404'd asset); orphaned objects need GC (TODO).
- `revisions` grows over time (history is the point); `get_public_site` reads the
  latest per entity with a deterministic tie-break (`published_at desc, id desc`).
