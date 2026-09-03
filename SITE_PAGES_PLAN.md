# Multi-page editor — plan of record (2026-09-03)

> **Status: PLANNED, not started.** Written after Sam asked why skeen's About page and
> Merch page are missing from the editor (2026-09-03).

## The finding

They are not missing. They were never reachable.

lone-star's editor loads ONE url in its iframe — `frameSrc()` in `use-frame-bridge.ts`
returns `${custom_site_url}/edit`. Skeen's `/edit` route renders `<SiteBody>`, which is
the **home page and only the home page**. `/about` and `/merch` are separate Next routes
that the editor has never once loaded.

So this is not a bug with a fix. The editor has no concept of a page, anywhere:

| Layer | Today |
| --- | --- |
| `TemplateManifest` | Flat. `fields` / `slots` / `styles` / `links`, no page dimension. |
| `frameSrc()` | One hardcoded path, `/edit`. |
| skeen `/edit` | Renders `SiteBody` (home) unconditionally. |
| skeen `/about`, `/merch` | Real routes. **Zero** `data-lse-*` markers between them. |
| `SITE_EDITOR_PLAN.md` | Multi-page is not mentioned in any phase. |

Two consequences worth separating, because they have different sizes:

- **About** — the polaroid wall *section* on the home page is fully instrumented
  (`components/About.tsx`). The standalone bio *page* (`app/about/page.tsx`) is a
  different file with no markers. Its CONTENT is already editable — it renders
  `site.bio`, which is the `artist.bio` field — so About needs presentation only.
- **Merch** — `MerchGrid`, `MerchProduct`, `MerchChrome`, `MerchBackground` declare
  nothing at all. The editor's Merch panel (`panels/merch-tools.tsx`) is already a
  Music-style cover grid with product images, drag-reorder and a full item editor, and it
  already works as a content manager. What it cannot do is *select* — clicking a card
  posts a `highlight` for a region that exists in no frame the editor has ever loaded.

## What already exists that this can stand on

Do not rebuild these. They were built for exactly this shape of problem:

1. **`set-mode: 'browse'`** (protocol.ts). Added 2026-08-10 for a tabbed throwaway site
   where the editor's click interception made the site's own tabs unreachable. In
   `browse` the frame stops swallowing clicks and the site behaves as a fan sees it —
   **this is already the navigation gesture**, and it needs no protocol work.
2. **`hello` / `ready` two-way handshake.** Whoever mounts second no longer loses, so a
   frame that reloads mid-session re-announces reliably.
3. **Re-announce after render** (skeen `app/edit/page.tsx`). The frame announces once its
   content is actually in the DOM, because `withDomTextFields()` reads `textContent`.
4. **Publish does not read the manifest.** `editor-publish.tsx` publishes content ROWS.
   So a per-page manifest can never cause a publish to mistake an unseen key for a
   deleted one. This is the single biggest risk this design does *not* have.

## Decisions

**D1 — The site declares its pages. The editor never guesses.**
`TemplateManifest` gains `pages?: ManifestPage[]`, each `{ key, label, path }`. Absent
means a one-page site, which is every site today. This follows the existing rule
(`editor-shows-what-site-sets`): a page the site does not declare does not appear.

**D2 — One page in the frame at a time, selected by URL, not by a new message.**
`frameSrc()` grows a page argument and returns `${custom_site_url}/edit?page=merch`. The
site's `/edit` reads `?page` and renders that page's components.

Rejected: a `set-page` editor→frame message. It would need the site to swap its own
content client-side, re-run its announce, and keep the two sides' idea of "current page"
in sync — three new failure modes to save one iframe reload. A reload re-runs the whole
proven `hello`/`ready`/`init-data` path. Revisit only if the reload is visibly slow.

**D3 — Region keys stay one FLAT global namespace; `page` is a tag, not a prefix.**
Every region type gains an optional `page?: string`. Keys remain globally unique strings
(`merch_card_title`, not `merch.card.title`).

This is the load-bearing decision. Style overrides, `site_content` rows and revisions are
all keyed by the bare region key today. A prefix syntax would mean a migration of stored
overrides and a parser everything has to agree on; a tag means the storage layer never
learns that pages exist. `page` is for GROUPING in the editor, nothing else.

**D4 — The editor merges announcements; it never replaces.**
Each page announces only its own regions, because `withDomTextFields()` can only see the
DOM in front of it. `useFrameBridge` must hold `Record<pageKey, TemplateManifest>` and
merge, or switching to Merch and back would silently empty the Text panel for Home. This
is the trap most likely to be found late and blamed on something else.

**D5 — Panels show the CURRENT page. Site-wide panels do not filter.**
A page switcher sits at the top of the inspector. `images / text / links / videos / music
/ tour / merch` filter to the current page's regions; `style` (site surface) and `site`
(cursor, site-wide settings) show everything, because they belong to no page.

**D6 — Navigation is browse mode, and the page switcher is the same act.**
Clicking Merch in the site's own nav while in `browse` navigates the frame; the editor
reads the change and updates the switcher. Picking Merch in the switcher sets the iframe
src. Both land in the same place. Neither is the "real" one.

## Phases

**P1 — Manifest + editor plumbing (no site changes, nothing visible).**
`ManifestPage`; `pages?` on `TemplateManifest`; `page?` on `ManifestField`,
`ManifestSlot`, `ManifestStyleRegion`, `ManifestLinkRegion`. Per-page manifest map and
merge in `useFrameBridge` (D4). `frameSrc(artistId, url, page)`. Bridge minor bump.
A single-page site must behave EXACTLY as before — that is the test.

**P2 — The page switcher.**
Renders only when the manifest declares 2+ pages. Panel filtering per D5. The frame's
current page tracked so browse-mode navigation moves the switcher.

**P3 — skeen `/edit?page=` and the About page.**
`/edit` renders the requested page. Mark up `app/about/page.tsx`: style regions for the
bio block, the × and the USB link. Content is already wired. This is the small one, and
it proves the whole path on a page whose data already works.

**P4 — The merch pages.**
Declare regions across `MerchGrid` (card image, title, price, sold-out), `MerchProduct`
(title, size boxes, add-to-cart, fact rows, description), `MerchChrome` (× and cart) and
`MerchBackground` (the sky). Two pages, not one: the grid (`merch`) and the product
(`merch_product`) — a product page's regions are real and none of them exist on the grid.

Only then does the Merch panel's card→highlight round trip close.

**P5 — Tooling catches up.**
`scripts/audit-regions.ts` and `checkContract` must both understand pages, or a region
declared on a page nobody loads reads as missing. `CONNECTING.md` gains a pages section.

## Traps

1. **The merged manifest is per-SESSION, not durable.** The editor only knows about a
   page it has loaded. So the Text panel cannot honestly list "every page's text" until
   every page has been visited once. Either accept that (the switcher makes it obvious)
   or have the site declare its fields statically rather than reading them from the DOM.
   Do not pretend the list is complete when it is not.
2. **`withDomTextFields()` is DOM-scoped by nature.** See above. It is the reason D4
   exists.
3. **Region key collisions across pages are now possible and nothing catches them.**
   `checkContract` must fail on a duplicate key across pages, or two pages silently share
   one style override and edits leak between them.
4. **The viewport scaler assumes one tall scrolling page.** `/merch` is a grid and
   `/merch/preview/[handle]` is a centred single screen. Check the scale math on a short
   page before declaring P4 done.
5. **A product page needs a product.** `/edit?page=merch_product` has to pick one — the
   first in `merch` sort order — and show nothing useful when the artist has zero
   products. Decide the empty state before building the page, not after.
6. **`/about` only exists when `aboutPlacement === 'page'`.** The switcher must not offer
   a page the site would 404 on. The manifest's existing `about` block already carries
   the placement; read it rather than adding a second source of truth.
7. **Cross-origin means no URL reading.** The editor cannot read the iframe's
   `location` on a custom site. Browse-mode navigation must be reported BY the frame
   (a `page-change` frame→editor message in P2) — the editor can never observe it.

## Order of work

1. P1, with a single-page regression test as the first thing written.
2. P3 (About) — smallest real page, content already wired, proves the path.
3. P2 (switcher) — now that there are genuinely two pages to switch between.
4. P4 (merch), grid first, product second.
5. P5 (tooling), then publish the bridge and redeploy every site **without build cache**
   (see `bridge-deploy-cache-gotcha`).

## How we will know it worked

Open the editor on skeen, and the panel offers Home / About / Merch. Click a product card
in the Merch panel and the product outlines itself on the merch page in the frame. Change
the merch grid's price colour and it changes on the merch page and nowhere else. A site
that declares no pages looks and behaves exactly as it does today.

---

# Amendments from the deep dive (2026-09-03, later)

Five agents were sent at this plan adversarially; the storage one finished, four died on a
session limit. The findings below are all evidence-backed. **Two of them change the plan.**

## A1 — D2 IS WRONG. The page switch must NOT be a URL reload.

This is the correction that matters, and it comes from the thing D2 never accounted for:
**browse-mode navigation and the URL design are the same problem, and D2 solved only one
of them.**

`/edit` is a Next ROUTE. The bridge is mounted in that route's effect
(`skeen-website/app/edit/page.tsx`, `mountFrameBridge`). So the moment a manager in
`browse` mode clicks the site's own "Merch" link, Next navigates away from `/edit`, the
bridge unmounts, and the editor is left holding a dead frame. Trap 6 in the original plan
("navigation is browse mode") and D2 ("switch by URL") cannot both be true — a nav click
either leaves edit mode or it doesn't.

So every editable page has to live UNDER the edit shell, which means `/edit` renders a
page chosen by CLIENT STATE, not by a route. And once that is true, the reload was never
buying anything.

**The machinery for this already exists and D2 didn't look at it.**
`mountFrameBridge` hands the shell an `announce` handle
(`packages/site-bridge/src/frame.ts:511, 757`) whose entire purpose is re-posting `ready`
with a freshly built manifest. It exists because the first announce scans an unpainted
document. A page switch is the same situation: new DOM, announce again. `onModeChange`
(`frame.ts:518, 721`) already lets the shell react to mode.

**D2 REVISED.** The site's `/edit` holds the current page in state. Two ways it changes,
both landing in one place:
- the manager clicks the site's own nav while in `browse` — the site sets its own state,
  no route change;
- the editor's page switcher posts `set-page` — additive editor→frame message.

Either way the site re-renders, calls `announce()`, and posts `page-change` back so the
editor's switcher follows (this is Trap 7's message, now load-bearing rather than
optional). No reload, no re-handshake, no `init-data` round trip, and the whole class of
"what does a reload lose" questions evaporates.

The original D2's stated reason for rejecting `set-page` — "the site would need to swap
content client-side, re-run its announce, and keep both sides in sync" — described work
that browse-mode navigation forces on us anyway. Getting it for free was an illusion.

## A2 — Merch data ALREADY travels over `init-data`. Not a blocker.

The plan's loudest unknown, dismissed: `PublicSitePayload` carries `merch: SiteMerch[]`
(`packages/site-bridge/src/payload.ts:250`) and skeen's `mapMerch` reads exactly that
(`skeen-website/lib/merch.ts:132-152`) — titles, handles, prices, currencies, images,
variants, `in_stock`. A merch page rendered inside the edit shell has its products.

## A3 — D3 (flat keys) survives the storage layer completely. No migration.

- `site_styles`: `unique (artist_id, region_key)`, no page column, no key CHECK
  (`supabase/migrations/20260714120000_site_styles.sql:15-23`).
- `site_content`: `unique (artist_id, key)` (`20260624180000_site_content.sql:8-16`).
- Both fold to flat maps for public and draft reads (`src/lib/site.ts:238-242, 262-266`).
- Nothing in the DB, the publish path or restore takes a manifest argument.

**And the rejected prefix syntax would have cost MORE than the plan claimed.** The
region-key grammar in `src/lib/site-editor/save.ts:357-359` is
`^[A-Za-z0-9_]+(?::[A-Za-z0-9_-]+)?$` — it rejects `.` outright, so `merch.card.title`
would have needed a save-path change on top of migrating every stored override. D3 was
right for a better reason than it gave.

## A4 — Publish and restore are whole-site, and always will be.

Proven row-based: `publishAll` iterates `Object.keys(PUBLISHABLE)` (`src/lib/content.ts:779-787`),
`publishContent` diffs table rows against `latest_revisions` (`content.ts:670-740`),
`restoreToPublished` walks `EDITOR_RESTORE` per type (`content.ts:570-668`). **No manifest
input on any of them.** So a per-page manifest cannot cause a phantom deletion — the
plan's claim holds.

Two consequences the plan must state plainly, because a manager will meet both:
- Publishing from Home publishes Merch edits too. There is no per-page publish.
- "Restore version" restores every page at once.
- A per-page publish is not merely unbuilt, it is **unbuildable** as designed: the only
  key→page mapping that exists is the session manifest, which is partial by nature
  (Trap 1). If per-page publish is ever wanted, `page` must become durable — a column,
  not a tag. Do not promise it.

## A5 — P5 named the wrong tool. It's `checkContract`, not `audit-regions`.

- `scripts/audit-regions.ts` never loads a page. It reads a static JSON dump each site
  prints from its own registry (`audit-regions.ts:15-21, 35-40`) and runs per-region
  checks only. **It produces no false failures once pages exist.** The plan was wrong
  about this.
- `checkContract` rule 2 (`packages/site-bridge/src/contract.ts:189-212`) demands every
  declared key carry a marker in ONE `editableDom`. Check a multi-page manifest against a
  single page's DOM and **every other page's regions report as `unmarked-key`.** This is
  the tool that must learn pages: one DOM per page, keys checked against the union.

## A6 — The duplicate-key guard we thought we had is vacuous.

`tests/site-editor.test.ts:70-71` asserts region keys are unique — over the built-in
`MANIFESTS`, whose `styles` arrays are EMPTY (`src/lib/site-editor/manifest.ts:180, 197`).
Deleting the assertion changes nothing. Textbook AGENTS.md rule 2: no planted witness.

Nothing else catches it either. The DB's unique constraint makes two pages sharing a key
silently share one override row; `frame.ts:237` applies by `querySelectorAll` on the key,
so it dresses both elements; and the D4 merge adds a second hiding place —
`visibleStyleRegions` returns both entries, `styleRegionForField` picks the first.

**Guard in two layers:** a `duplicate-key` finding in `checkContract` over the union of
pages (site build time), and a drop-plus-surface in the editor's D4 merge (runtime, the
one place lone-star sees every page).

## A7 — NEW TRAP: the "first declared image slot" rule breaks under a per-page merge.

An untagged photo belongs to the FIRST declared image slot
(`packages/site-bridge/src/manifest.ts:89-95`; enforced at
`editor/panels/photo-tools.tsx:433-439, 522` and `src/lib/site-editor/panel-inputs.ts:73-78, 128-130`).
Under D4, "first" would become *whichever page announced first* — so visiting Merch
before Home could move skeen's untagged gallery photos into a different collection in the
panel.

**Fix in the merge itself:** order merged regions by the declared `pages[]` sequence,
never by visit order. Cheap, and only cheap if it is done when the merge is written.

## A8 — The session journal survives, but it is moot now.

`useSessionJournal` is React state in the editor shell
(`editor/use-session-journal.ts:30-31`), not in the iframe, so even the rejected reload
design never endangered it. Under A1 there is no reload at all. Recorded so nobody
re-opens the question.

## Revised order of work

1. **P1** — manifest types + the D4 merge (with A7's declaration-order rule) + `set-page`
   / `page-change` messages. First test written is the single-page regression.
2. **P3** — About, inside the new edit shell. Smallest real page, content already wired.
3. **P2** — the switcher, once there are two pages to switch between.
4. **P4** — merch grid, then the product page. A2 means the data is already there.
5. **P5** — `checkContract` learns pages (A5), the duplicate-key guard lands (A6), then
   publish the bridge and redeploy every site **without build cache**.

## Tests, each seen RED first

1. **Unseen-key witness.** Plant a `site_styles` row whose key is in no manifest; publish;
   assert it appears in `get_public_site.styles`; restore; assert it survives. Pins A4 as
   behaviour instead of a comment.
2. **Duplicate key across pages.** `checkContract` with two pages sharing a key →
   `duplicate-key`. Either fix `tests/site-editor.test.ts:70-71` to run over a fixture
   with a planted duplicate, or delete it — it currently proves nothing.
3. **`checkContract` per-page DOMs.** A region marked only on page B passes when B's DOM
   is supplied; a region marked on NO page still fails (that failure is the witness).
4. **The D4 merge, as a pure `mergeManifests` helper.** Visit A then B keeps A's fields;
   a site declaring no `pages` yields a manifest deep-equal to the single announce (the P1
   regression); the first image collection is `pages[0]`'s regardless of visit order (A7).
5. **`page` is inert on the wire.** A `page`-tagged region writes the same row as today.

Note: `packages/site-bridge` is excluded from Stryker (`stryker.config.json:16`), so tests
2 and 3 get no mutation coverage — they need the manual delete-the-guard check.

## The honest risk

Not the data layer; that came back clean. The risk is that **`/edit` stops being a thin
shell.** Today it renders one component tree from injected data. After A1 it owns a page
router, the site's nav has two behaviours depending on mode, and every new page is a new
branch in it. That file is where this design will rot if it rots — and it lives in the
SITE repo, so it gets copied into site #4 and #5 as-is. Keep the page switch to one
`useState` and one map from page key to component, and put the map next to the manifest
declaration so a page cannot be declared without being renderable.

---

# P1 shipped (2026-09-03) + what the review caught

Test-first throughout: `tests/site-bridge-pages.test.ts` was seen RED (9 of 12 failing on
`mergeManifests is not a function`) before any implementation, and three mutants — drop
the page-order sort, replace instead of merge, skip the dedupe — were each confirmed to
kill tests before being reverted.

A `/code-review high` pass then found **two real defects in this work**, both fixed:

**R13 — `ManifestComponent` and `ManifestVideoSlot` were never page-scoped.** The fold
cast them to `& { page?: string }` and read `.page`, which the types did not have — so
`rank()` was always 0 and their order fell back to VISIT order. That is precisely the A7
failure the fold exists to prevent, for the Videos and Components panels. Both types now
carry `PageScoped` and the casts are gone.

**R14 — the fold could never REMOVE a region.** Accumulating onto `manifestRef.current`
meant a region the site stopped declaring (a redeploy, a reverted draft) stayed in the
panels for the whole session, still selectable, still writing `site_content` rows for
something nothing renders. The old replace-on-`ready` semantics dropped it, so the fold
was a regression.

The fix is the shape D4 originally specified and the first implementation drifted from:
**one held announce PER PAGE**, keyed by a new stated `TemplateManifest.page`, with the
manifest re-derived from that map on every `ready`. Replacing a page's entry is what lets
a region leave. Two consequences fell out of it for free:

- the fold now runs in DECLARED page order rather than arrival order, so first-wins
  duplicate resolution no longer depends on which page the manager opened first;
- `droppedRegions` is replaced rather than appended, so the constant per-page
  re-announces stop growing it without bound.

`page` is STATED on the announce, never inferred from the regions — inference breaks on
the one announce that matters, a page that has just lost its last region.

Six more tests in `tests/use-frame-bridge.test.tsx` pin all of it, seen RED first, and
three further mutants (arrival order, appended drops, accumulate-never-remove) each kill
tests.

**Deliberately NOT done in P1:** `PACKAGE_VERSION` was not bumped. It gates the editor's
"republish to apply" flag, and bumping before anything needs republishing would flag all
three live sites for nothing. It moves when the bridge is actually published, at P5.

Status: typecheck clean, lint clean, 3986 DB-free tests green, full suite (225 files,
4597 tests) green.
