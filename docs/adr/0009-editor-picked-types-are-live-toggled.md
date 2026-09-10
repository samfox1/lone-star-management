# 0009 — A type the editor can pick is live-toggled, never publish-reconciled

Status: Accepted (2026-07-15). Amended by ADR 0010 (2026-09-10): releases and songs are
DRAFT-PRESENCE now (doors read the snapshot), merch is live-toggled, and tour dates and
merch auto-publish on every write. The reconcile path this ADR describes no longer exists.

## Context

ADR 0002 made publishing a snapshot: working rows → immutable revisions → tombstones.
On top of that, **two different ways to write a row's `on_site` flag** grew up, and
they are not interchangeable:

| Path | Types | Who writes `on_site` | What publish does |
| --- | --- | --- | --- |
| **Live toggle** | photo, track, link | `setOnSiteAction`, immediately, from the editor | snapshot only |
| **Publish-reconcile** | release, video, merch, tour_date | `reconcileOnSite`, at publish, from the page's checkbox selection | reconcile **then** snapshot |

The live toggle takes effect on the public site with no publish, because every door
gates on the **working** row, not the snapshot:

```sql
left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
where l.entity_type = 'tour_date' and coalesce(td.on_site, true)
```

`reconcileOnSite` makes the live set **exactly** the submitted selection: every row
absent from `onSiteIds` is set `on_site = false`. So the two paths actively fight.
A toggle in the editor is silently reverted by the next publish from the Tour or
Videos page — no error, no warning, the date just leaves the site.

ADR 0007 already hit this and moved tracks to the live toggle for the same reason.
The split has also cost us a real bug: `video` and `merch` keys sat in `ON_SITE_TABLE`
with no caller for weeks (removed in the 2026-07-14 purge). Nobody noticed because
the two maps are keyed in **different vocabularies** — `ON_SITE_TABLE` by editor kind
(`photo`, `track`), `ON_SITE_ENTITIES` by entity (`media`, `tour_date`) — so a type on
both paths does not look like a duplicate.

The trigger is the editor gaining a tour-date picker (and the agreed videos picker).
The editor is a direct-manipulation surface with no password gate and no publish step;
it cannot share a flag with a reconcile.

## Decision

- **A type whose on-site set the EDITOR picks is live-toggled.** `video` and
  `tour_date` move: `ON_SITE_ENTITIES` becomes `['release', 'merch']`, and
  `ON_SITE_TABLE` gains `video` and `tour`.
- **A type is on exactly ONE path.** Being on both is the failure mode above, and it
  is invisible to the type system because the maps use different vocabularies — so a
  test asserts the two paths are disjoint (`tests/on-site-paths.test.ts`).
- **`publishEntityAction` stops reconciling the moved types.** Publish is
  snapshot-only for them, exactly as `publishReleasesAction` already snapshots tracks
  without reconciling them.
- **The Tour and Videos pages keep their per-row control, but it writes live.** It is
  the same flag with the same meaning as the editor's, so the two surfaces agree
  instead of racing. Presence is no longer password-gated on these pages; publishing
  the *content* still is.
- **Those pages' `PublishBar` switches from `pendingCount` to `dirty`** — the count of
  a selection⇄live delta is meaningless once the toggle is live. `PublishBar` already
  had the `dirty` prop for this and had never had a caller.
- **`release` and `merch` stay on publish-reconcile**, because the editor cannot pick
  them. The editor shows a read-only `OnSiteBadge` for them, which stays honest.
  Giving either an editor picker means moving it here first.

## Consequences

- New/synced videos and tour dates still land **off-site** (`INSERT_OFF_SITE` is
  unchanged): a synced Bandsintown date or one of 83 YouTube imports must never
  auto-appear. The library is where things arrive; the editor is where they're chosen.
- **A date must be published once before the editor can put it on the site.** The door
  reads the published snapshot and gates it on the working row, so an unpublished row
  is not in `live` and toggling it does nothing. This is the existing model (songs and
  links behave identically), not new friction — but it is the one non-obvious step in
  "enter it on the Tour page, pick it in the editor".
- **Presence changes on these types are no longer password-gated.** That is the point
  of a live toggle and already true for photos, songs and links; the gate now
  consistently guards *content* reaching the site, not *arrangement* of what's already
  published.
- Supersedes the two-path split described in `ON_SITE_TABLE`'s comment and in
  `CONTEXT.md`'s "On-site" section; both are updated. `reconcileOnSite` keeps its
  `scopeToReleased` branch, which only ever applied to `release`.
- The remaining split is now principled rather than accidental: reconcile is for types
  chosen behind the publish gate, the live toggle for types chosen in the editor. If
  the editor ever picks everything, `reconcileOnSite` and `ON_SITE_ENTITIES` are
  deleted outright.
