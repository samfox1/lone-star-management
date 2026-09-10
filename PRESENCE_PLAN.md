# Presence: what "on the site" means, per kind of thing

Plan of record, 2026-09-10. Supersedes the presence half of ADR 0009 for the types
named here (ADR 0010 records the decision).

## The rule, in Sam's words

> "I dont know if the user should be able to just add songs to the site through the
> assets page … blindly adding songs to the site seems problematic." — so a song ticked
> on the Music page goes into the **site draft**, shows up in the editor where you can
> see where it lands, and reaches fans only on **Publish**.

> "tour dates and merch can just go right to the site. The assets work differently
> because they may not necessarily be in a grid or have a standard for listing them.
> They can be versatile and used many ways. Tour dates and merchandise are always going
> to be added to a list." — so adding or toggling one of those **is** the site change.

> Tour dates: "append in the correct part of the list (fitting around the other dates)".
> Merch: "just get added to the front/top of the list".

## Three kinds of presence (registries in `src/lib/content.ts`)

| kind | types | a tick / toggle means | reaches fans |
| --- | --- | --- | --- |
| **DRAFT_PRESENCE** | track, release | the working row's `on_site` changes; the editor preview shows it | on Publish — the door reads `on_site` **from the snapshot** |
| **LIVE_TOGGLE** | tour_date, merch, video, photo, link | the working row's `on_site` changes | immediately — the door reads the **live row** (as today) |
| **AUTO_PUBLISH** | tour_date, merch | any write (add / edit / delete / toggle) also snapshots the type | immediately — no Publish step exists for them |

A type is in exactly one of DRAFT_PRESENCE / LIVE_TOGGLE (`on-site-paths.test.ts`).
AUTO_PUBLISH is a subset of LIVE_TOGGLE. `ON_SITE_ENTITIES`, `reconcileOnSite`,
`publishSelectionAction` and `useOnSiteSelection` — the "selection reconciled at
publish" machinery — go away: nothing reconciles from a selection any more.

## What changes, by slice

**S1 — music waits for Publish.**
- `on_site` joins the track and release SNAPSHOT lists. Migration backfills it into each
  entity's latest revision from the working row, so no artist wakes up "dirty".
- Doors read `coalesce((data->>'on_site')::boolean, <live row>, true)` for tracks and
  releases: `get_public_site`, `get_public_releases`, `get_release`,
  `audio_path_for_play`. The live-row fallback is only for revisions older than the
  backfill.
- Music page: a tick writes the working row at once (`setReleaseOnSiteAction` cascades
  to the release's songs — the "songs follow their home release" rule moves from
  publish-time to tick-time; orphans via `setTrackOnSiteAction`). The check shows
  **"checked, publish to put on site"** until Publish, because the page is told each
  row's PUBLISHED `on_site` as well as its working one. PublishBar lights on `dirty`.
- `publishReleasesAction` → `publishMusicAction`: password, snapshot release + track,
  no reconcile.
- Editor: unchanged in code; its Music toggle was already a working-row write, and is
  now honestly a draft.

**S2 — merch goes straight to the site, newest on top.**
- `merch` moves to LIVE_TOGGLE + AUTO_PUBLISH. The Merch page's check toggles live; the
  Add modal inserts ON-site; every merch write snapshots merch. No PublishBar.
- Shopify sync still inserts OFF-site (the library is where things arrive).
- New product = top: `sort_order = min(existing) - 1` on insert. Door orders merch by
  `sort_order nulls last, created_at desc` (today it is `created_at asc` — new products
  went to the bottom, and drag order never reached the site).

**S3 — tour dates go straight to the site, slotted by date.**
- `tour_date` joins AUTO_PUBLISH (already LIVE_TOGGLE). Every tour write snapshots.
- Slotting: the door and Skeen already order dated shows by date until the manager has
  dragged. Once dragged (any dated row carries `sort_order`), a new date is inserted at
  its date position — after the last row whose date ≤ its own — and later rows shift by
  one. Undated rows keep their dragged order at the end.

**S4 — prove it.** Full suite, `mutation:changed`, and a browser pass of each page.

## Not in scope
Videos, photos and links keep today's behaviour (live toggle, content published
separately). If Sam wants them on AUTO_PUBLISH too it is the S2/S3 shape again.
