# 0010 — Presence per kind: music waits for Publish, tour dates and merch go straight to the site
Status: Accepted (2026-09-10). Amends ADR 0009.

## Context
ADR 0009 split on-site presence into two write paths: live-toggled types (the editor
can pick them) and publish-reconciled types (releases, merch — the editor could not).
Since then the editor's Music panel gained a per-project toggle that wrote songs'
`on_site` live, including songs inside releases — and the next Music-page Publish
reconciled from the page's checkbox state and silently switched them back off. The
exact failure 0009 was written against, reintroduced.

Sam (2026-09-10) settled the model by KIND rather than by surface:

> "I dont know if the user should be able to just add songs to the site through the
> assets page … blindly adding songs to the site seems problematic."

> "tour dates and merch can just go right to the site. The assets work differently
> because they may not necessarily be in a grid or have a standard for listing them.
> They can be versatile and used many ways. Tour dates and merchandise are always going
> to be added to a list."

## Decision
Three registries in `src/lib/content.ts`; a type is in exactly one of the first two
(`tests/integration/site/on-site-paths.test.ts`):

- **DRAFT_PRESENCE — track, release.** A tick or toggle writes the working row's
  `on_site` at once; the editor preview (which renders working rows) shows it; the
  public doors read `on_site` FROM THE SNAPSHOT, so fans see it on Publish. `on_site`
  rides these types' snapshot lists; the doors strip it from what they emit (a gate,
  not content). Fallback order in every door: snapshot → live row → true; the live row
  is only reached by a revision older than the 20260910130000 backfill.
- **LIVE_TOGGLE — tour_date, merch, video, media, link.** The working row IS the site;
  the doors gate on the live row, as in 0009. Merch moved here.
- **AUTO_PUBLISH — tour_date, merch** (a subset of LIVE_TOGGLE by type). Every write —
  add, edit, delete, toggle, reorder, sync — also snapshots the type. There is no
  Publish step for either; those pages have no PublishBar. Synced rows still arrive
  off-site.

The "selection reconciled at publish" machinery (`ON_SITE_ENTITIES`, `reconcileOnSite`,
`publishSelectionAction`, `useOnSiteSelection`) is deleted. Nothing reconciles from a
selection any more; both surfaces edit one draft and Publish commits it.

Where a NEW row lands is a rule per kind (`src/lib/insert-position.ts`): a product on
top (`sort_order = min − 1` once the list has been dragged; newest-first at the door
otherwise), a tour date slotted by date into the dragged order via the same atomic
`reorder_rows` the editor uses.

## Consequences
- The editor's Music toggle and the Music page's tick can no longer fight: same draft,
  same Publish.
- A song must be PUBLISHED before it is on the site, from either surface. The tile's
  check shows "checked, publish to put on site" in between, so the state is never a lie.
- Publishing music no longer changes presence; it snapshots it. `publishReleasesAction`
  became `publishMusicAction` (no selection argument).
- A hand-added tour date or product is on the site immediately. A wrong add is undone
  by deleting it — which also publishes.
- Videos, photos and links keep 0009's behaviour (live toggle, content published
  separately). Moving them to AUTO_PUBLISH is the S2/S3 shape again, if wanted.
- The public payload is unchanged: `on_site` never reaches the wire.
