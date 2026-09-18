# Multi-page editor — plan of record (2026-09-03)

> **Status: COMPLETE. P1, P3, P2, P4 and P5 all shipped (2026-09-09).** Written after Sam asked why
> skeen's About page and Merch page are missing from the editor (2026-09-03).
>
> **Superseded in part — read the amendments before this body.** D2 was replaced (A1),
> and seven more claims below turned out to be wrong (C1–C5 on 2026-09-04, C6–C7 on
> 2026-09-09). Everything above the first `---` is the original plan, kept as written.

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

---

# P3 shipped (2026-09-04) — and five of this plan's claims were wrong

Twelve commits across the two repos. lone-star: P1 (`5482f5b`), the frame's half of the
two page messages (`d04e66b`, bridge 0.35.0), `FrameHandle` exported after 0.35.0 broke
skeen's typecheck on install (`c5a0383`, 0.35.1), the pages contract as CONNECTING §11
plus a `prepublishOnly` version guard (`ca3585a`), cross-page eviction (`8729eb0`).
skeen: the edit shell holding its page in state (`dfcb552`), the manifest's page dimension
and /about's three regions (`06824ee`), never leave /edit and the announce latch moved
inside its own animation frame (`5fb6115`), re-announce when the set of available pages
changes (`b3b38b8`).

**P2, P4 and P5 are UNSTARTED.** No switcher exists, no panel filters by `page`
(D5 is untouched), skeen's merch components still declare nothing, and `checkContract`
still knows nothing about pages. Two P5 fragments landed early and are listed under C5.

## C1 — Trap 1 is too broad. Only DOM-derived TEXT fields are per-visit.

The trap says the merged manifest "cannot honestly list every page's text until every
page has been visited once", and offers "have the site declare its fields statically" as
the alternative. skeen already does, for everything except text: `STYLE_REGIONS`
(`skeen lib/styles.ts:93`) is one static array carrying `about_bio`, `about_close` and
`about_usb` with `page: "about"`, and slots, links, components and video slots are static
in `EDIT_LIST` the same way. Only `withDomTextFields` (`skeen lib/editList.ts:288`) reads
the live DOM, and it only ever ADDS fields.

So every announce, from any page, carries every page's style/link/slot/video regions with
their tags — and the fold treats the repeats as idempotent rather than as duplicate keys:
`manifest.ts:518` refuses to report a drop when the held side and the incoming side name
the same page, which is the normal case for a static declaration re-announced on every
`ready`. The Style panel is therefore complete before the manager has visited anything.

The honest version of the trap: **a page's TEXT fields appear only after that page has
been announced once**, and nothing else is per-visit. That is a much smaller claim, and
it is the one the switcher has to make obvious.

## C2 — P1's "a region can leave" was only true WITHIN one page.

The P1 section says the per-page map is "what lets a region leave". It let a region leave
its own page's announce. It did not let a PAGE leave: held announces were only ever
`set`, never pruned, and `pages` was picked by a reduce over the held map, so a stale list
naming /about beat the fresh one that no longer did. skeen's /about exists exactly while
the bio is placed there, so that is a live case, not a hypothetical.

Cross-page eviction arrived in `8729eb0` (2026-09-04), a day after P1:
`use-frame-bridge.ts:271-278` takes the list from the LATEST announce and deletes every
held announce whose key is not in it. R14's note promised more than P1 delivered; this is
the commit that made it true.

## C3 — `pages: []` is a declaration. ABSENT `pages` is the one-page case.

Not in the plan at all, and not guessable. `use-frame-bridge.ts:271`: eviction runs only
when the latest announce HAS a `pages` field. No `pages` is a one-page site — every site
before 0.35.0, and it evicts nothing. An explicitly empty list is a site saying "I have
no pages", and it evicts every held announce but the latest.

The latest announce is never evicted whatever its own list says: a page the site TAGS but
does not DECLARE is the site's bug, and the fold's rule for it is misplaced (ranked last),
never invisible.

## C4 — Trap 6's mechanism is wrong. Availability is resolved SITE-side, from `aboutPlacement`.

Trap 6 says "the manifest's existing `about` block already carries the placement; read it
rather than adding a second source of truth." That is not what shipped, and the trap's own
advice would have been the second source of truth.

skeen's `SITE_PAGES.about.available` reads `site.aboutPlacement === "page"`
(`skeen lib/sitePages.tsx:42`), because `mapSite` has already folded the three inputs into
one answer (`skeen lib/mapSite.ts:784`): the manifest's declared default (`SITE_ABOUT`),
the manager's stored choice, and whether there is a bio at all — no bio means `hidden`,
so the footer cannot link and the sitemap cannot list a URL that 404s. `pages` is then
`availablePages(site)` filtered through that (`withPages`, `sitePages.tsx:85`).

The consequence for P2: **the editor does not decide availability and must not try.** It
takes the announced list verbatim, and a page that stops being real stops being announced.
Related, from the 2026-09-03 review (M9, `7208c7e`): no server-side gate can check this
either, because the manifest is announced at runtime and stored nowhere.

## C5 — "PACKAGE_VERSION moves at P5" is already false. The bridge is published at 0.35.2.

P1 deliberately left `PACKAGE_VERSION` alone so the three live sites would not be flagged
"republish to apply" for nothing, and said it would move "when the bridge is actually
published, at P5". P3 needed a published bridge: skeen installs `^0.35.2` from the
registry (`skeen package-lock.json`, resolved URL), and `PACKAGE_VERSION` is 0.35.2
(`packages/site-bridge/src/manifest.ts:27`).

`bridgeOutdated` (`src/lib/site-editor/manifest.ts:56`) compares a site's announced
`bridgeVersion` against that constant, so **any deployed site below 0.35.2 now shows the
flag** — that is the cost P1 was deferring, paid at P3 instead. `BRIDGE_VERSION` is still
2 (`protocol.ts:27`), so nothing is refused on the wire; the two page messages are
additive and an older frame ignores `set-page` via optional chaining.

The two P5 fragments that came with those publishes: CONNECTING §11 documents pages
(`ca3585a`), and `check-version.mjs` refuses a publish whose `PACKAGE_VERSION` disagrees
with `package.json` (`ca3585a`, after `bb23abe` made it a test). §11 currently describes a
page switcher that does not exist yet.

## Claims checked and still TRUE

- **A1, as shipped.** `/edit` holds one `useState<PageKey>` and one map from key to body
  (`skeen lib/sitePages.tsx:36`, `app/edit/page.tsx:60`); a nav click in browse mode sets
  state instead of navigating; the editor's `set-page` lands in the same state. No reload,
  no re-handshake. `5fb6115` had to go further than A1 did: a same-origin link to a page
  the shell CANNOT render (/merch, /faqsheet) is now swallowed too, because navigating
  away unmounts the bridge and leaves the editor holding the public shop.
- **D2's `frameSrc` page argument never shipped**, correctly. `frameSrc(artistId,
  customSiteUrl)` still takes two arguments (`use-frame-bridge.ts:33`). The P1 phase text
  and the P3 heading (`/edit?page=`) are stale prose, superseded by A1.
- **A5.** `checkContract` is the tool that must learn pages, and `scripts/audit-regions.ts`
  is untouched and fine. Confirmed by what skeen had to do instead: its contract test
  renders every page into ONE container (`everyPage`, `skeen components/SiteBody.test.tsx:494-511`)
  so rule 2 sees the union of DOMs. That workaround is the interim; P5 replaces it with
  one DOM per page.
- **Trap 7 is load-bearing, and `page-change` exists.** The editor cannot read a
  cross-origin frame's location, so the frame saying so is the only route. It is checked
  against the declaration on arrival (`use-frame-bridge.ts:345-352`) for the same reason
  `field-change` is, and `pageChanged` posts the announce FIRST so the declaration is
  never behind the claim.
- **A7.** The fold ranks by declared `pages[]` order in both layers (`manifest.ts:491`,
  `use-frame-bridge.ts:284-292`), so the first image collection is `pages[0]`'s regardless
  of visit order.
- **A4 / D3.** Nothing in the storage or publish path learned that pages exist. Keys are
  still one flat namespace and `page` is still a tag.
- **A6's runtime half only.** The fold drops a duplicate and reports it, and
  `droppedRegions` is returned by the hook — but see N3.
- **Trap 4 is weaker than written.** `fitViewport` (`src/lib/site-editor/viewport.ts:71-88`)
  scales by WIDTH alone and derives the frame's height so the canvas fills the panel; a
  short page gets a taller viewport, never a cropped or mis-scaled one. /about is a
  one-screen `min-h-screen` page and needed no viewport change. Still worth a look at
  P4's centred product page, but there is no height-driven scale math to get wrong.

## New hazards the plan never mentioned

### N1 — a CLAIMED `size-[15px]` fluidises to ~11px on a tablet.

`sizeLength` (`packages/site-bridge/src/styles.ts:129-135`) returns the ladder's clamp for
a size on the ladder, and for anything else synthesises `clamp(px*0.7, px/1024*100vw, px)`
— so 15px becomes `clamp(11px, 1.46vw, 15px)`, which renders at about 11px at a 768px
viewport. Fine for a heading, wrong for a paragraph of prose.

So skeen's About bio deliberately does NOT use the usual `size-[15px] lse-owns-[size]`
pattern. Its base carries an UNCLAIMED `text-[clamp(13px,2.35vw,15px)]`
(`skeen lib/styles.ts:336-347`), matching the widths the old `text-[13px] sm:text-[15px]`
pair switched at. Unclaimed is what makes the editor's Size control still work: the bridge
inlines `font-size: var(--lse-size)`, which beats the class the moment a manager sets one.

**The rule for any page of body copy: claim `size` only where the ladder's clamp is
acceptable, otherwise ship your own clamp unclaimed.**

### N2 — skeen's `usb` link is still `rendered: false` on a premise that is now false. OPEN DECISION.

`skeen lib/editList.ts:482-489` declares the USB link region `rendered: false` under the
comment "Rendered on /about, not in the SiteBody the editor frames". /about IS now a page
the editor frames, and `AboutBody` renders that anchor. The link is still declared without
a `data-lse-link` marker, so it configures rather than renders, and `checkContract` rule 2
exempts it.

Left as it is on purpose: whether to mark it is a decision, not a fix. Marking it makes
the URL clickable in the frame; leaving it keeps the Site-links panel as the only way in.
The comment's reasoning is what is stale, and the same question applies to `booking`
(never an element) and the commented-out `merch` entry (P4's).

### N3 — `droppedRegions` is computed and surfaced nowhere.

A6 asked for "a drop-plus-surface in the editor's D4 merge". The drop landed; the surface
did not. `droppedRegions` is returned by `useFrameBridge` and has no consumer in `src/`
outside its own tests. So a duplicate key across pages is currently detected, resolved
first-wins, and silent — which is where it started, one layer up. P5's `checkContract`
finding is the other half and is also unbuilt.

### N4 — nothing yet pins that a region's `page` tag reaches the editor from a real site.

The fold is well tested on both sides in isolation, and skeen pins `withPages` and its own
regions. What no test crosses is the wire: a `page: "about"` region declared in skeen's
registry arriving in lone-star's panels under About. That is P2's first test, and it is the
one that would have caught a tag dropped in `EDIT_LIST`'s style mapper
(`skeen lib/editList.ts:360-365`, where the tag rides along conditionally).

## P2, with what is now known

The two-sided availability fix landed BEFORE P2 (`8729eb0` + skeen `b3b38b8`, both
2026-09-04) precisely because P2 is what makes it bite. Without a switcher, a stale page
list is invisible; with one, it is a menu entry that does nothing — `set-page` moves the
editor's idea of the page, the shell has nothing to switch to, no `page-change` comes back,
and the editor sits latched to a page it is not displaying. The skeen half re-announces
when the SET of available pages changes rather than only when the page on screen does,
which is the case a manager hits by hiding the bio while standing on home.

So P2 inherits:

- `framePage` is already re-validated on every announce and CLEARED when its page is
  evicted (`use-frame-bridge.ts:322-325`). Null is the state the switcher must render
  before the first `page-change` anyway, so it needs no separate "evicted" case.
- The switcher renders from `manifest.pages` verbatim. It never filters, never guesses
  availability (C4), and must not set `framePage` itself — `setPage` posts and waits, so an
  older frame that ignores `set-page` leaves the switcher truthfully on the page still
  showing (`use-frame-bridge.ts:217-223`).
- Panel filtering per D5 is entirely unbuilt: no panel reads `page` today.
- N4's cross-repo test is P2's first test.

---

# P2 shipped (2026-09-09) — and the tab design it started as was WRONG

The first attempt built D5 as written: a page switcher at the top of the inspector, and
panels filtered to the page in the frame. Sam rejected it on sight — "I dont want tabs to
move between screens. There should be a slot in the text page that says about and below
that should have the about text. Clicking it should highlight the about text on the about
page. Likewise, clicking into the about page and then clicking the bio text should
highlight the about text in the text tab."

He is right, and the tab version had a hole he could not have known about but would have
hit within a minute: **the merged manifest is per-SESSION** (Trap 1). With tabs, the panel
for a page you have not visited is empty, so the switcher was the only way to discover a
page — and the only way to make its contents appear. The design was circular.

## C6 — D5 is deleted. Panels do not filter; they GROUP.

The Text panel lists every page's copy at once. Copy on the first declared page renders
exactly as it always has (prefix grouping, no heading); copy on any other page gets a
`GroupLabel` carrying the site's own name for that page. `pageLabel` is set only for a
non-first page, so a single-page site takes the unheaded path for everything and renders
byte-for-byte as before.

## C7 — the click IS the navigation, and it has to wait

`applyHighlight(target, page)`. When the page named is not the one showing, the frame is
asked to move and **the highlight is HELD** until its `page-change` says it arrived —
posting immediately would aim at an element that is not rendered, the frame would answer
with nothing, and the row would look selected while nothing outlined. If the frame lands
somewhere else instead (the manager navigated the site themselves) the request is dropped
rather than fired at the wrong page. It fires exactly once: `page-change` repeats after
paint and on every `hello`.

`framePage` is mirrored in a ref for this, and the ref moves with EVERY write including
eviction — a ref still naming an evicted page would hold a request for a `page-change`
that is never coming, and the row would silently do nothing.

## C8 — Trap 1 is solved by DECLARING, not by visiting

The plan offered a choice: "Either accept that (the switcher makes it obvious) or have the
site declare its fields statically rather than reading them from the DOM." With tabs gone
there is no choice left, and static is the right answer anyway. skeen now declares
`artist_bio` in `EDIT_LIST.fields` with `page: "about"` and
`target: {store:"artist", column:"bio"}`, so it rides EVERY page's announce and the row
exists the moment the editor opens on the home page.

Every other skeen string stays DOM-derived. The rule that replaces the trap: **copy a
manager must be able to reach from another page must be declared statically.**

## C9 — one element wears both markers, and `field` wins

The bio block carries `data-lse-style="about_bio"` AND `data-lse-field="artist_bio"`.
The bridge's `targetOf` resolves field before style, so the click lands on the copy — which
is exactly what Sam asked for. The region is not stranded by that: the field declares
`styleKey: about_bio`, so the Text panel's row carries its Font/Size/Boldness beside the
words. One row, one edit path.

## What was deleted

`page-switcher.tsx`, its test, `CATEGORY_IS_PAGE_SCOPED`, `onPage`, `manifestForPage` and
`tests/editor-page-filter.test.ts`. `resolvePanelInputs` is back to its pre-P2 shape:
narrowing was the whole idea and the whole idea was wrong.

Kept from the first attempt: the cross-page plumbing in `useFrameBridge`, and the rule
that a page MOVE drops the selection (a panel open on an element that no longer exists,
its Size slider writing overrides off screen, with no dead space on the new page to
deselect from). A re-report of the page already showing does not clear, and neither does
learning the page for the first time from null.

## N4 is closed

`tests/editor-page-wire.test.tsx` drives the real chain with no stubs: announce → fold →
`resolvePanelInputs` → `runtimeTextFields` → the props the Text panel renders. Its first
test is the load-bearing one — a single announce from HOME carries About's copy, tagged
and headed — because that is the claim the whole no-tabs design rests on.

## Also learned

`checkContract` is less broken than P5 assumed. skeen's contract test already renders the
UNION of every page (`everyPage`, derived from `SITE_PAGES`), so a field marked only on
/about is seen. P5's work is the duplicate-key guard, not the missing-marker false alarm.

## Still open, deliberately

- **N3 — `droppedRegions` is surfaced nowhere.** Detected, resolved first-wins, silent.
- **Only FIELDS carry a page into the panels so far.** Styles, links, slots and components
  still land ungrouped. The Text panel is what Sam asked for; the others follow the same
  two lines (`page` through the resolver, `pageLabel` for the heading) when their panels
  need it.
- **N2, N1** unchanged. **P4 (merch) and P5 (tooling)** are next.

---

# P4 shipped (2026-09-09) — the merch pages, and what closing the round trip took

Grid first, product second, as the order of work said. Test-first on both sides; the
mutants that mattered are listed at the end.

## What landed

**skeen.** `SITE_PAGES` gains `merch` and `merch_product`, both available exactly while
the shop is — ONE predicate, because `/merch` 404s an empty shop and a product page with
no product is the same 404 (trap 6). The grid is the merch SLOT and every card an ITEM
(`merch:<id>`); the corners, the sky and the product's five surfaces are regions tagged
with their page. Public routes render the same bodies (`MerchGridBody`,
`MerchProductBody`) — the About split, for the same reason.

**lone-star.** `resolvePanelInputs` gains `itemPages`: each library type → the page of
the slot that accepts it. The inspector's highlight effect reads an item's page from it,
and `applyHighlight(target, page)` (P2) does the travelling. A Merch panel card click now
sends the frame to `/merch` and outlines the card once it arrives. That is the round
trip the original plan named as P4's finish line.

## C10 — the product page is chosen by CLICK, not only by "first"

Trap 5 said pick the first product. That is the fallback, not the rule: the declared path
`/merch/[handle]` is a route PATTERN (so the route-exists test can find its file) and
never equals a real href, so `SitePage` gains `match`, `pageForPath` uses it, and the
shell records which product a browse-mode click chose. With none chosen: the first. With
none published: it says so, rather than rendering a product-shaped nothing.

## C11 — a slot's `page` tag is what makes an ITEM travel

The plan's D3 made `page` a tag "for grouping in the editor, nothing else". For items it
is more than grouping: it is the only thing that says merch lives on `/merch`. Three
rules, each with a test that goes red without it: an untagged slot belongs to the first
declared page; the first slot per type wins (A7); an undeclared tag falls back to the
first page — degrade to misplaced, never to a highlight that stalls.

## C12 — one control in three states wears its region on the WRAPPER

"Add to cart" renders as a buyable button, an external link, or a blocked "pick a size" /
"sold out" span. Marking only the buyable one left the region unmarked whenever the
preview showed another state — found by the contract test, whose seeded product has two
sizes and therefore renders "pick a size". The region is now the wrapper, carrying the
type the states share; fill stays on the state element, because a single declared colour
would be a lie the picker then shows. Its colour control reads blank on purpose.

## C13 — the contract fixtures must SEED what a page renders conditionally

Every product-page region exists only with a product on it. The union render
(`everyPage`) fed an empty shop and reported all five unmarked. Both fixtures now seed one
product with two sizes and a description. The first attempt seeded the WRONG fixture — a
replace anchored on a fragment that appeared earlier in the file — and the failing test
list did not change, which is how it was caught. Anchor on something unique.

## Also learned

- `text-charcoal`, `text-cream`, `bg-sky` joined skeen's declared palette. The audit is
  right: a colour the picker cannot name is a control that reads blank.
- No `/55`-style opacity variants in a base — the audit reads them as undeclared colours.
  Dimming lives on wrappers and children, as it now does on the sizes, facts, and
  description.
- Trap 4 (the viewport) needed nothing: `fitViewport` scales by width alone.
- No bridge change, so no publish and no cache gotcha.

## Mutants killed

skeen: slot tag dropped; product-link match dropped; pages always available; handle
ignored. lone-star: itemPages never derived; untagged slot read as no page; item page not
passed to the highlight; first-wins guard dropped; undeclared-tag fallback replaced.

## Still open, deliberately

- **P5 (tooling)**: the duplicate-key guard in `checkContract`, and N3 —
  `droppedRegions` surfaced nowhere. `checkContract`'s per-page DOM is less urgent than
  planned: skeen's union render does the job.
- **Only fields and items carry a page into the panels.** Styles, links and slots still
  land ungrouped in their panels; same two lines when a panel needs it.
- **N2** (skeen's `usb` link `rendered: false`) unchanged.
- **The merch pages are invisible in the editor until a product is ON the site.** skeen
  has none published today. That is the availability rule working, not a bug.

---

# Review of the day (2026-09-09, before anything shipped) — what it found

Sam asked for a review of the whole day's changes: test problems, and shared code to
consolidate. Three real bugs, four test problems, six consolidations. All fixed, both
repos green, and every fix that changes behaviour was seen RED first or killed a mutant.

## Bugs

- **A field tagged with an undeclared page stalled.** `runtimeTextFields` passed the RAW
  tag through as `page`; items already resolved an undeclared tag to the first page.
  A highlight naming a page the site does not declare is held forever — the frame can
  never report reaching it. One `effectivePage(tag, pages)` in panel-inputs now, read by
  fields and items alike.
- **The SEO editor re-guessed `store` from the key's spelling.** The descriptor carries
  `store` precisely so nothing guesses; the persist ignored it and matched `seo_` — the
  commit message even said guessing was the bug. The debounce key is `<store>:<key>` now
  and the session's edits are keyed by store, so nothing reads a prefix.
- **`setFramePage` updaters had side effects** (three other `setState`s, a ref write).
  React may run an updater twice. The ref mirrors the state on every write, so the
  previous page is read from the ref and the clears happen outside.

## Tests

- The Videos A–Z test could not tell A–Z from newest-first: 'Just Added' / 'Middle' /
  'Oldest' sort alphabetically into exactly the newest order. Retitled.
- The site-tools FLUSH test's "witness" comment described an assertion that was not
  there. A plain `EditRow` is now rendered and shown to still pad.
- The MerchBodies "surfaces are regions" test hand-listed five of eight product regions;
  it derives every `merch_product` region from the registry now, on a furnished fixture.
- Three suites carried their own copy of the actions mock — one as a Proxy minting a
  fresh `vi.fn` per property read, so `vi.mocked(x)` could never be the fn the component
  called. One `tests/helpers/editor-actions.ts`.
- Two skeen contract fixtures carried the same product literal; three skeen suites
  hand-rolled a product row. One `lib/merch.fixture.ts`.

## Consolidations

- **`src/lib/library-order.ts`** — the Music and Videos browsers each had a newest-first;
  one pure module now (date, undated-first, then created_at), and it joins the Stryker
  slice: 100% of its mutants die. The music copy had drifted (the sentinel bug) and
  neither copy was mutation-tested, because a .tsx component is not in the slice.
- **`onSiteOnly`** in inspector-shared — the on-site rule, stated once, read by the Music
  and Merch panels.
- **`EMPTY_FACTS`** exported from site-tools and used as its own default; the inspector's
  copy is gone.
- **`MerchShell`** (skeen) — the five pieces of furniture both merch bodies assembled.
- **`CORNER`** (skeen) — the fixed-corner wrapper classes, copied three times.

## Still worth knowing

- Only fields and items carry a page into the panels. A Style-panel click on an About
  region does not travel yet; same two lines when it needs to.
- `pageLabel` groups in the Text panel follow field order, not declared page order —
  fine at two pages, worth deriving from `pages` at three.

---

# P5 shipped (2026-09-09) — the plan is complete

The duplicate-key guard A6 asked for, in the two layers it asked for. The DROP had
landed with P1; neither half of the TELLING had.

**Build time** — `checkContract` gains a `duplicate-key` finding (bridge 0.36.0), per
LIST. A field `usb` and a link `usb` are rows in different tables and skeen names style
regions after the fields they dress, so one namespace across all four would have made the
check unusable on the site it was written for. The detail names both pages: the fix is to
rename one, and the reader has to know which two are fighting.

**Runtime** — `droppedRegions` is a banner in the inspector. Not a block: the editor
works, the region is still editable, first-wins is a defensible resolution. What was
missing was anyone being told.

## C14 — `audit-regions` needed nothing, and `checkContract`'s per-page DOM was the wrong fix

A5 named two tools. `scripts/audit-regions.ts` was already fine. And the per-page DOM
`checkContract` was supposed to grow turned out to be unnecessary: a site renders the
UNION of its pages into one container (skeen's `everyPage`) and rule 2 sees everything.
That workaround was called "the interim" — it is the answer. CONNECTING §7 documents it,
including the two things that bit during P4: the union must include each page's BACKDROP,
and the fixture must be FURNISHED or a conditionally-rendered region reports as unmarked.

## The miss that showed up three times in one day

Every new surface this week was first tested against the component that renders it, never
against the thing that FEEDS it — so deleting the wiring left a green suite three separate
times: `fromShopify` (the mapping flattened to `false`), the `itemPages` rules (Stryker),
and this banner (the shell's prop). Each was caught by mutation, not by review, and each
is now pinned at the source the same way. Worth remembering as a shape: **a test that
renders the consumer proves nothing about the producer.**

## What is left, and it is not this plan

- **N2** — skeen's `usb` link `rendered: false` on a stale premise. A decision, not a bug.
- **Only fields and items carry a page into the panels.** Styles, links and slots still
  land ungrouped; the same two lines when a panel needs it.
- **The bridge is at 0.36.0 and UNPUBLISHED.** No site needs it — `duplicate-key` is a
  build-time check a site opts into by upgrading — so this is not urgent, but the merch
  work will want a publish eventually.
