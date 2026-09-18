# Changelog — @samfox1/site-bridge

**Sites sit on DIFFERENT versions on purpose.** Sam, 2026-09-04: that is fine "as long as we
are aware with how they differ and we can replicate a site to fit a certain bridge." Today
(re-read from both `package.json` files, 2026-09-18) skeen is on `^0.38.0` and ftbk on
`^0.32.0`, and neither is drift — each site is on the version its own features need.

That policy needs two things written down, and neither existed before this file:

1. **What adopting a version COSTS a site.** ftbk moving 0.32.0 → 0.38.0 crosses the seo
   module, the pages protocol, `FrameHandle`, a music-ordering law and the analytics module.
   The only record was git history. The range is inventoried below as far as 0.35.2; 0.36.0
   through 0.38.0 have their own entries.
2. **What a site pinned to an OLDER version must implement.** `CONNECTING.md` documents the
   LATEST contract only. A builder targeting 0.32.0 has no sheet — §10 and §11 describe
   rules that did not exist there. See [Building against an older bridge](#building-a-new-site-against-an-older-bridge).

**Every entry answers one question: what must a SITE do to adopt this?** Internals that
change nothing for a consumer say *site action: none* — and most do. The version numbers and
dates here were read out of `git log` and the `PACKAGE_VERSION` / `package.json` bumps in
this directory; where history cannot prove something, it says so rather than guessing.

---

## Why a caret cannot cause drift

`@samfox1/site-bridge` is a `0.x` package, and **npm treats the MINOR as the breaking digit
below 1.0**. So `^0.32.0` means `>=0.32.0 <0.33.0` — not `<1.0.0`.

That is the mechanism that makes the policy safe rather than merely tolerated: ftbk's
`^0.32.0` **cannot** resolve to skeen's 0.38.0 on any `npm install`, and skeen's `^0.38.0`
cannot slide back. A version move is a deliberate edit to a `package.json`, never a
side-effect of a lockfile refresh. Verified 2026-09-04 and re-checked 2026-09-18: ftbk's
`node_modules` holds 0.32.0; skeen's holds 0.38.0.

## The two version numbers, and which one you care about

| | what it is | who compares it |
| --- | --- | --- |
| `PACKAGE_VERSION` (`src/manifest.ts:27`) | the npm version, stamped into the manifest a site announces as `bridgeVersion` | the editor, to gate controls and to flag "republish to apply" |
| `BRIDGE_VERSION` (`src/protocol.ts:27`) | the postMessage WIRE version. **Still `2`.** | both sides, to refuse a message from a newer peer |

`BRIDGE_VERSION` has not moved through any release in this file. Every message added since
has been additive, and an older peer ignores an unknown `type` — moving it would start
dropping *every* message from the other side, `ready` included (`protocol.ts:240`).
`check-version.mjs` runs on `prepublishOnly` and refuses to publish when `PACKAGE_VERSION`
and `package.json` disagree; `tests/unit/site-editor/site-bridge-version.test.ts` catches the same drift, but
only on the next test run, which is after a wrong number could already be on the registry.

**The editor's per-version behaviour is exactly seven gates** (`src/lib/site-editor/manifest.ts`),
and nothing else in the editor branches on a site's version:

| gate | since | what an older site loses |
| --- | --- | --- |
| `bridgeSupportsStyleVars` | 0.16.0 | `size-[…]` / `fontfam-[…]` as CSS variables |
| `bridgeSupportsTextVars` | 0.18.0 | weight, align, leading, tracking, case, italic as variables |
| `bridgeSupportsMobileVars` | 0.19.0 | phone-only values |
| `bridgeSupportsMobileText` | 0.22.0 | phone twins for the text set |
| `bridgeSupportsMobileItem` | 0.23.0 | phone twins for item scale |
| `bridgeSupportsDeltas` | 0.24.0 | delta overrides (a stored override REPLACES the base instead) |
| `bridgeSupportsItemDeltas` | 0.25.4 | per-item deltas |

All seven are at or below 0.32.0, so **both live sites clear every gate**. When a site is
behind, the editor keeps writing the older form rather than emitting a token the site cannot
lift — upgrading is safe in either order. A site that stamps no version at all is treated as
old and never gets value tokens.

`bridgeOutdated` (dotted numeric compare; absent or malformed reads as NOT outdated, because
a false alarm is worse than a missed one) drives one banner. **ftbk shows it today**: it
announces `bridgeVersion: '0.32.0'` and the editor is on 0.38.0.

---

## Unreleased

Nothing since 0.39.0.

---

## 0.39.0 — the shows order law

**Site action: order your tour dates with `orderShows`, and pass `mainCss` to
`checkContract`.** Neither is required to keep building. Skipping the first means the
manager's dragged order silently does not reach the page.

**`orderShows(rows, todayIso)`** from `@samfox1/site-bridge/shows` returns
`{ upcoming, past }` from `payload.tour_dates` — your own row objects back, nothing
mapped. `isPastShow(row, todayIso)` is exported beside it.

**Why a site cannot skip this.** `get_public_site` orders `tour_dates` by date and
`published_at` and **ignores `sort_order` entirely**. A site that renders the payload in
the order it arrives therefore drops every drag the manager makes in the Tour panel: the
drag works, it publishes, and the page does not change. Nothing reports it. The rule
existed only in skeen's `lib/mapSite.ts`, so it was correct on exactly one site.

**The law, in full.**
- A show is PAST if `is_past` is true, **or** it has a date that has passed. The flag is
  what lets a DATELESS old show land in Past — there is nothing to compare, so the toggle
  decides. A dateless, unflagged show is a TBA upcoming date. (Sam's real case,
  2026-09-18: skeen listing old shows that never had a date.)
- A show dated TODAY has not happened yet.
- MANUAL MODE (Sam, 2026-08-17): once any row has BOTH a date and a `sort_order`, the
  manager's drag IS the order for that whole bucket, and date only breaks ties for rows
  the drag never numbered. Decided per bucket, so dragging Past does not renumber
  Upcoming.
- Otherwise: dated first (upcoming ascending, past descending), then undated by
  `sort_order`.

Ported from skeen with its comments, and checked against the original on 20,000 random
lists: identical on every one. One asymmetry came with it — in manual mode an unnumbered
dateless show sorts to the FRONT (it tie-breaks on `''`), while the chronological branch
puts undated rows last. It reaches only a partial drag, it is skeen's live behaviour, and
it is pinned by a test named KNOWN ASYMMETRY rather than quietly changed.

**A site on an older pin** keeps whatever ordering it wrote. Nothing about the wire
changed, no field was added, and `BRIDGE_VERSION` did not move — this is a rule the
package now states, not a new thing to announce. To adopt it: bump the pin, call
`orderShows` where you currently sort `tour_dates`, and delete your own block. A site with
no tour surface needs nothing.

### Also in 0.39.0 — four fixes from the 2026-09-18 review

Two of them change what a site's own `checkContract` test can say, so they are listed
rather than folded into "internals".

- **`auditRegions` sees every palette colour.** The `text-*` colour test was an unanchored
  regex listing the sizes and alignments, so any colour whose NAME merely begins with one
  of those words — `text-smoke`, `text-xlarge`, `text-started`, `text-clipped` — read as a
  size and left the audit entirely. `checkContract` runs this audit, so **a site can see
  new findings on upgrade**: an undeclared colour of that shape was always a finding and
  was always silently dropped. Checked 2026-09-18: neither skeen nor ftbk uses a token of
  that shape, so neither gains a finding. The icon-group rule was blind through the same
  path and is fixed with it.
- **The protocol guards check the payload, not just the `type`.** `isFrameMessage` and
  `isEditorMessage` asserted the full union on the strength of source, version and
  `typeof type === 'string'` — so a `select` with no `target` crashed the editor's message
  listener and a `field-change` with no `value` saved `undefined` over a declared field.
  Each type now validates what its consumers read. **An unknown type still passes
  `isEditorMessage`**, so the frame's catch-all and the additive protocol are unchanged; an
  unknown type is refused by `isFrameMessage`, which has no catch-all behind it. A site
  feels this only in a TEST DOUBLE that posts a half-built editor message — the 0.35.0
  lesson in a new place, and the reason it is written down here.
- **`CLAIMABLE_PROPS` is exported from `styles.ts`** and derived from `TEXT_VARS`.
  `contract.ts` restated the same eight rows by hand under a comment claiming a test kept
  them in step; nothing did, and a seventh text family would have been reported as a claim
  nothing supplies.
- **`mergeManifests` cannot silently drop a new manifest key.** A `Record<keyof
  TemplateManifest, true>` ledger sits beside the hand-named merge, so the next key added
  to the type is a compile error here instead of a list the panels never show.

---

## 0.38.0 — a second opinion on our own numbers

**Site action: report views with `landing()`, pass `environment`.** Neither is required to
keep building, but a site that skips them keeps counting its own internal page loads and
its preview deploys as views.

**Behaviour changes a site will SEE on its numbers.**
- Local development (`localhost`, `*.local`, LAN addresses) and any declared
  `environment` other than `production` no longer report. Charts drop by exactly the test
  traffic that was in them.
- With `landing()`, a page load reached from the site itself is not a view. A site whose
  own nav uses plain links that reload the page will see views FALL by those page switches.

**What a view is.** Sam, 2026-09-17: "landing on the site should be the view. I don't think
switching pages should add to the view total." `landing()` sends one `view` per page load,
per slug, unless the referrer is the site's own host (`isInternalReferrer`, `www.` ignored,
whole-host match). Two drafts on the way counted every client-side path change instead; the
first patched `history.pushState` and a review found its cleanup broke Next's router. Both
are gone. Nothing in the bridge patches `history`.

**`isReportableContext` and `hostnameOf`** are exported, and both pipelines call the one
rule. Only `production` counts when an environment is declared: an allowlist of preview
names had already missed Netlify's.

The rest of this entry describes the mirror.

**What it adds.** `createMirror({ key, slug, host? })` loads PostHog from its CDN — no npm
dependency, the package still has zero — and returns `{ capture, shutdown }`. Pass it to
`createAnalytics(config, { mirror })` and every reported event is offered to it, so a site
cannot wire half of its clicks to one pipeline and half to the other. No key, no script, no
request, no cost.

**Why.** The 2026-09-15 accuracy audit found the tallies arithmetically exact — nightly
rollups match the raw rows for every day checked — and still could not answer whether a
recorded view is a real fan. Bot detection reads only the user-agent, preview deploys and
localhost report into production, and anyone who can write a `curl` can post events. None of
that is visible from inside. A second pipeline counting the same traffic by different rules
is the only instrument that shows it.

**The one design detail this hangs on.** `ANALYTICS_PAGE_PLAN.md` originally had PostHog
init with `capture_pageview: false` and the page view MIRRORED from our own `track()`. That
is not a cross-check, it is a copy: send a view twice and PostHog records it twice, and the
two agree precisely when they should be disagreeing. So the mirror REFUSES a `view` —
PostHog captures those itself, one per page load (`capture_pageview: true`), and the
comparison applies the landing rule to them from PostHog's own `$referring_domain`. Clicks are mirrored, because no independent source knows which song an
`entity_id` was; that half tests the door rather than the browser, and catches events lost
to the 60/min per-IP and 120/min per-artist caps.

**Visitors are not comparable, by construction.** Ours is a daily rotating hash of IP +
user-agent, which counts visitor-days; PostHog cookieless issues an id per page load. Views,
sources, countries and the four click kinds are the numbers to compare.

**One loader per page.** Every mirror on a page shares one PostHog: `init` runs once,
`register({ site })` tags every later event (PostHog's own `$pageview`s included) before
anything is captured, an `init` that throws is dead for every mirror rather than half-ready
for the second one, and a mirror naming a different key, host or slug is refused. A draft
kept this state per mirror and had all three of those bugs.

**Single-artist sites only.** PostHog keeps capturing after its page's component
unmounts, with the first slug frozen in, so a multi-artist app must not run a mirror.

**It is meant to be deleted.** Not exported from the package root, so removing it is one
subpath and one env var. Delete `NEXT_PUBLIC_POSTHOG_KEY` and it is inert again.

## 0.37.0 — one way to report what a fan did

**What it adds.** `@samfox1/site-bridge/analytics`: `createAnalytics({ supabaseUrl, anonKey,
slug })` returning `pageview()`, `track(type, { entity?, label? })`, and `attrs()` +
`listen(document)` for server-rendered elements that should stay server-rendered. It posts
to lone-star's `/functions/v1/event` door, which derives the page, the referrer and source,
the location, the device, whether the caller is a crawler, and a visitor hash that rotates
daily. A site sends four facts; everything else is the door's job.

**Why.** Every site hand-rolled its own reporting, and the results diverged without anyone
noticing: skeen has been sending page views, ticket clicks and buy clicks and NOTHING else
for months, so its songs, videos and social links look like content no fan ever touched. A
missing event is indistinguishable from a fan who never clicked, which is why this went
unseen. One helper makes a site's coverage something `checkContract` can check.

**Two details that matter more than they look.**
- `keepalive` is set on every send. A plain fetch started by a click on an outbound link is
  cancelled the moment the browser leaves the page — which silently loses exactly the ticket
  and buy clicks worth the most.
- `label` rides alongside `entity`, and either may be absent. Plenty of real fan actions have
  no row to point at: a social icon, a mailto, a checkout button. Without a label they arrive
  as anonymous `link_click`s among hundreds.

**site action: adopt to report anything.** A site on an older bridge keeps whatever it
hand-rolled; nothing breaks. To adopt:

```ts
const analytics = createAnalytics({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  slug: process.env.NEXT_PUBLIC_ARTIST_SLUG,
})
analytics.pageview()                 // on mount
return analytics.listen(document)    // one delegated listener for every attrs() element
analytics.track('play', { entity: { kind: 'track', id: track.id, label: track.title } })
analytics.track('link_click', { label: 'TikTok' })   // no row to point at
```

**Three things that will reject you.** `entity.id` must be a real UUID — a slug, a handle or
a lower-cased label is a `400 bad_entity`. The page URL you send must live on the request's
`Origin`, or it is a `403`. And the door caps one address at 60 events a minute per site,
answering `429` with `Retry-After`.

**If you set `data-*` by hand, don't.** Use `attrs()`. The names are `data-track`,
`data-entity-kind`, `data-entity-id`, `data-label` — the last two of those are renames from
the template site's older private seam (`data-entity-type`, `data-target`), which no
published bridge ever exposed.

---

## 0.36.0 — `checkContract` catches a key used twice

**What it adds.** One new finding, `duplicate-key`: a key declared twice in the same list
(`styles`, `fields`, `slots`, `links`). Keys are ONE FLAT NAMESPACE across every page
(SITE_PAGES_PLAN.md D3) — `page` is a tag, never a prefix, because `site_styles` rows are
keyed by the bare key and a prefix syntax would have cost a migration of every stored
override. The price of that decision is a collision nothing caught: the DB's unique
constraint makes two pages SHARE a row rather than conflict, `applyStyleToDom` dresses
every element matching the key, and the editor's fold resolves it first-wins. What a
manager sees is one heading changing when they restyle a different one.

`ContractManifest` gains an optional `pages`, and its entries an optional `page` — read
ONLY to name the two pages in the finding, so it can say "on home and on merch" rather
than "on nothing and on merch". `AuditRegion` gains `page` for the same reason; the audit
itself ignores it.

PER LIST, deliberately. A field `usb` and a link `usb` are rows in different tables, and a
site may name a style region after the field it dresses — skeen does. One namespace for
all four would have made the check unusable on the site it was written for.

**What a site must do.** Nothing, unless it has a duplicate — in which case the check now
says so and the fix is to rename one. A multi-page site should make sure the DOM it hands
`checkContract` is the union of every page AND its backdrop, or regions tagged with a page
it did not render report as unmarked (CONNECTING §7 rule 2 now shows how).

*Site action: none required. Adopt when convenient.*

---

## 0.32.0 → 0.35.2 — the range a real site must cross

This is the crossing ftbk faces, so it is written at full detail. Read it as one migration,
not fifteen: the [ftbk upgrade path](#ftbk-upgrade-path-0320--0352) is the ordered version.

### 0.35.2 — `80ac5f5`, 2026-09-04
`probePrompts` now trims the artist name like every other consumer (0.35.1 built the
`artistName()` boundary and left this one caller reading raw), and the no-name guard moved to
the TOP of `autoFaqAnswer` from its old home on `n === 5` alone. The old guard's comment
claimed Q5 was the only branch reachable without a name; it was not, and Q1–Q4 shipped
sentences like `" is a House, Techno musician, based in Chicago."`.

*Site action: none* — behaviour only, inside `seo`. A site not on the seo module is
unaffected.

### 0.35.1 — `c5a0383`, 2026-09-04 · **fixes a BREAKING 0.35.0**
- **`FrameHandle` is exported** from `@samfox1/site-bridge/frame`. See 0.35.0 for what it
  repairs. *Site action (if you mount the frame): type your `onMounted` handle and any test
  double as `FrameHandle` — as an **annotation**, never an `as` cast. The annotation names
  the member you are missing; the cast hides it. `Partial<FrameHandle>` or
  `Pick<FrameHandle, 'pageChanged'>` where you only care about some of it.*
- One `artistName()` boundary in `seo.ts`, and every consumer goes through it. 0.34.1's
  no-name fix had trimmed in two places and left the value raw in nine, so an artist named
  `"Skeen "` rendered `"Who is Skeen , the musician?"` directly above
  `"Skeen's official website is …"` — one artist, two spellings, on the page whose whole job
  is being quoted verbatim by an assistant. The same raw read reached `MusicGroup.name`,
  `WebSite.name`, the event and video nodes and the FAQPage title, so a whitespace-only
  artist could ship `name: "  "` as JSON-LD. *Site action: none.*

### 0.35.0 — `d04e66b`, 2026-09-03 · **BREAKING (in a minor)**
The frame catches up to the protocol 0.34.0 declared. 0.34.0 shipped `set-page` /
`page-change` as message types and stopped there, so a site on it could not be switched by
the editor and its own nav switches were invisible.

- **`onSetPage?: (page: string) => void`** on `mountFrameBridge` — the editor's switcher.
  Optional-chained at the call site, so a site that declares no handler is a no-op, not a
  throw inside the one listener that handles everything else.
- **`pageChanged(page)`** joins the `onMounted` handle. It announces the fresh manifest FIRST,
  then posts `page-change`, in that order and as one call so a shell cannot get it backwards:
  the editor checks `page-change` against the pages DECLARED in the announce, and one that
  lands ahead of its declaration is dropped as a stranger and the switcher never moves.
- **BREAKING:** `pageChanged` was added as a **required member of a type consumers
  construct**. A shell never builds a handle, but its **test double does**, as an object
  literal — and skeen's typecheck went red on the install with no change on skeen's side.
  A required member added to a constructed type is breaking regardless of the digits.
  Fixed in 0.35.1 by exporting `FrameHandle`; if you cross 0.35.0 at all, cross to 0.35.1+.

*Site action, to become multi-page:* declare `pages[]` and tag regions with `page`; handle
`onSetPage` by swapping what you render in **client state** — `/edit` is a route and the
bridge is mounted in that route's effect, so a real navigation unmounts it and leaves the
editor holding a dead frame. Call `pageChanged` after the new page has PAINTED, and
**instead of** `announce`, never as well as. Intercept your own nav in `browse` mode and
report that too. Keys stay one flat namespace: `page` is a TAG, not a key prefix, and two
regions sharing a key share one stored override. Full rules in `CONNECTING.md` §11.
*To stay one-page: nothing.*

### 0.34.1 — `7b834d4`, 2026-09-03
**No artist name, no FAQ sheet.** Every prompt and automatic answer interpolates the name, so
without one the sheet read `"Who is , the musician?"` answered by
`"'s official website is skeenmusic.com."`. Only Q5's guard had been reachable (it tested
`origin`, not the name), so a payload with no artist still produced one truthy answer and
listed `/faqsheet` in the sitemap. **Caught by skeen's own sitemap test the day 0.34.0 was
installed** — which is the evidence that 0.34.0 reached the registry. `auditSeo` gained an
optional `editError` input. *Site action: none.*

### 0.34.0 — `7e00524`, 2026-09-03
The version bump that shipped three landed commits.

- **The pages protocol** (`5482f5b`): `ManifestPage`, `TemplateManifest.page` and
  `.pages[]`, an optional `page` tag on every region type (fields, slots, styles, links,
  components, videoSlots), plus `mergeManifests` / `MergedManifest` / `DroppedRegion` — the
  editor's fold of one announce per page. `set-page` (editor→frame) and `page-change`
  (frame→editor) join the protocol. Additive: `BRIDGE_VERSION` stays 2 and a frame that
  predates them ignores an unknown type. `page` on the announce is **stated, never inferred
  from the regions** — the editor holds one announce per page and REPLACES that page's entry,
  which is what lets a region you stop declaring leave the panels; inference breaks on the
  one announce where it matters, a page that has just lost its last region.
  *Site action: none until you want pages, and the frame half only arrived in 0.35.0.*
- **Merch on the wire** (`1b8cc3b`, `1acffc6`, `cf65f62`, 2026-09-02/03): `SiteMerchVariant`,
  and on `SiteMerch` — `shopify_product_id`, `handle`, `description` (Shopify's plain
  `description`, never `descriptionHtml`), `images[]`, `variants[]`, `shipping_estimate`,
  `preorder_note` (**non-null MEANS pre-order**), `record_label`, `shipping_days` (a duration
  the site turns into a date at render time, so it does not go stale). All optional.
  *Site action: none, unless you render a product page or a cart.*
- **Type-level note:** `ManifestVideoSlot` became `PageScoped & (…)` — an intersection over
  the existing discriminated union. Narrowing on `kind` is unaffected.

### 0.33.6 — `79a2818`, 2026-08-28 · **bumped locally, NEVER PUBLISHED**
Per Sam, this version never reached the registry; the repo cannot prove that either way (the
GitHub Packages registry is private and no lockfile in reach resolves it), so it is recorded
on his word. Its contents shipped to sites as part of 0.34.0.

- **Automatic FAQ answers.** `autoFaqAnswer(n, src)` is new and exported; `faqEntries` now
  falls back to it, and `faq_extra_N_q` / `_a` put up to five of the manager's own questions
  on the sheet.
- **A quiet adoption action.** `faqEntries` and `faqPageJsonLd` changed parameter from
  `Pick<PublicSitePayload, 'artist' | 'site_content'>` to a new **`FaqSource`**. Every added
  member is optional, so a caller passing a whole payload still typechecks — but the
  automatic answers only exist for data you actually pass. `tour_dates` rides along on a
  payload and `faqPageJsonLd` fills `origin` from `opts`; **`releases` and `today` do not**,
  so Q4 ("latest releases") stays empty until you pass `releases` from
  `fetchPublicReleases`. *Site action: pass `releases` and `today` into `FaqSource`.*

### 0.33.5 — `40da998`, 2026-08-28
`probePrompts` + `PROBE_VERSION`, `FaqEntry`, `faqEntries`, `faqPageJsonLd` — the FAQ sheet,
answered from `site_content.faq_answer_N` only (written answers; the automatic ones come in
0.33.6). *Site action: to render one, add a `/faqsheet` route and inline
`faqPageJsonLd(...)`.*

### 0.33.4 — `f99c137`, 2026-08-26
Review round two. `isProfileUrl` (so `sameAs` carries profile URLs and not every link),
`auditJsonLd` + `JSON_LD_REQUIRED` + `JsonLdSummary`, `SEO_RULES`, and `auditGeoFacts` — the
GEO rules as code, which is what the editor's live check runs. `robots.ts` must leave `/edit`
FETCHABLE (noindex is a meta tag; disallow hides the tag itself). Description takes the whole
bio, an event needs a city, and a video's `uploadDate` is the platform's real date:
`SiteVideo.published_at` joins the wire (`created_at` had arrived in 0.33.3 and was the wrong
date — that is when the manager added it, not when it was published).
*Site action: use these in the build-output test (§7 rule 6).*

### 0.33.3 — `7acaec7`, 2026-08-26
Fact-sheet validity: tombstoned revisions move `published_at`, and `SiteVideo.created_at`
joins the wire. *Site action: none.*

### 0.33.2 — `f25750a`, 2026-08-26
One `VideoObject` per on-site video, `homeLocation` for a `Person`, and songs pinned NESTED
inside their `MusicAlbum` rather than floating as siblings. *Site action: none — output
shape, inside `jsonLdGraph`.*

### 0.33.1 — `7b67ebb`, 2026-08-26
`safeHttpUrl` takes `unknown` and never throws on a non-string (a parameter widening; callers
are unaffected). `SiteRelease.links` widened to
`{ label?, url? }[] | Record<string, string> | null` — `[{label,url}]` as the dashboard
actually stores it, with the old record shape still accepted from older snapshots.
**Technically a breaking type change in a patch** for anyone indexing `links` as a record —
but `SiteRelease` did not exist before 0.33.0, so nobody crossing from 0.32.0 is exposed.
*Site action: if you read `links`, handle both shapes.*

### 0.33.0 — `26a29f3`, 2026-08-26 — **the seo module**
The largest single addition in this range, and the biggest gap between skeen and ftbk. Two
new subpath exports, `@samfox1/site-bridge/seo` and `@samfox1/site-bridge/alt`, plus `seo`
work that landed just before the bump (`0e451e8`, `ba69b0f`, `90378be`, `b516d8e`).

The bridge never writes your `<head>` — it hands you values:

- `resolveSeo(payload)` → `title`, `description`, `ogImage`, one precedence everywhere
  (manager's override → the artist's own data → a dull, honest default). `MAX_DESCRIPTION`.
- `jsonLdGraph(payload, { origin, releases, mediaUrl, today })` + `jsonLdScript(graph)` — the
  fact sheet: the artist (`MusicGroup` or `Person`), the site, one `MusicEvent` per dated
  upcoming show, one `MusicAlbum` per release with its songs, and the listed photos and
  artworks. Nothing in it is invented.
- `sitemapEntries(payload, { origin, pages, today })`, `robotsRules(origin)`,
  `lastModifiedFrom(...)` — `lastModified` is `published_at` (or the newest show that has
  passed), never `new Date()`: a lastmod that changes every request is one Google learns to
  ignore.
- `ABOUT_PLACEMENTS` / `ManifestAbout` / `aboutPlacement(...)` — the bio renders at `home`,
  `page` or `hidden`. `TemplateManifest.about` is where you declare it; declare nothing and
  the editor offers only Hidden.
- `auditSeo({ home, edit })` + `SeoFinding` — §7 **rule 6**, which is new in this version and
  is deliberately NOT part of `checkContract`: it needs the BUILT html, not a DOM.
- `recommendAlt(...)` from `/alt`, and `WireMedia.alt` / `.kind` (`MEDIA_KINDS`) on the wire.
- Wire additions: `artist.genre`, `artist.location`, `artist.schema_type`,
  `payload.published_at`, and `fetchPublicReleases` + `SiteRelease` in `/public-site`.

*Site action, to be findable:* `generateMetadata` from `resolveSeo`; inline `jsonLdScript`;
add `sitemap.ts` and `robots.ts`; one `h1` and an `h2` per section (visually hidden is fine —
it is the section's NAME, structure you own); plain `<img>` in server html with `src`
straight at the storage URL (**never `/_next/image`, never a proxy**) and `alt` = `media.alt`
else `recommendAlt(...)`; declare `about`; `robots: { index: false, follow: false }` on
`/edit` from a server layout — but leave `/edit` fetchable in `robots.txt`. Then prove it
with rule 6 over the built html. Full rules in `CONNECTING.md` §10.

### 0.32.0 — `9570011`, 2026-08-21 — ftbk's floor
The one commit worth reading in full if you maintain a site, because it is where a law stopped
living in two repos.

- **`@samfox1/site-bridge/music` is new**: `orderMusicProjects` and `isNewRelease`. Ordering
  had been stated on both sides of the wire and they disagreed — lone-star ordered by the
  manager's drag, skeen's grid re-sorted albums → EPs → singles on top of it, and a
  standalone SoundCloud song counted as a "single" and was flung to the bottom-right however
  Sam arranged the panel. The law: **any two projects holding distinct `minSort` means
  somebody dragged, and their arrangement IS the order**; all tied falls back to newest-first
  with undated projects in a stable tail. Grouping is deliberately NOT in the bridge — each
  side decides what a project IS. `isNewRelease` takes `todayIso` as a **parameter**, never a
  clock read inside: a site renders on the server and caches, so "now" has to be the render's
  now, and a future date is not new.
  *Site action: replace your own project sort with `orderMusicProjects`, and read the NEW
  badge from `isNewRelease` — otherwise the panel and the grid drift apart again.*
- **`checkContract` gained `mainCss` and the `tokens-not-compiled` finding.** The cheapest
  possible check against the biggest recurring failure: everything the editor applies that
  is not a colour is a Tailwind class arriving from the DATABASE at runtime, so the scanner
  never sees it and nothing is compiled. Importing `@samfox1/site-bridge/tokens.css` is what
  makes those classes real. Called "the drift bug of 2026-08-05, three times" in the source;
  **ftbk was the fourth**, and the symptom every time is a manager reporting that the sliders
  do nothing. *Site action: pass your real `globals.css` text as `mainCss`.*
- **`ManifestStyleRegion.controls`** — exactly the controls a region offers, by id,
  overriding its scope. ftbk's dock is one Size slider because everything else about that bar
  is the site's design. **`customControls`** — sliders the site itself implements.
- `tracks.release_date` reaches the wire (it had been an editable field the publisher never
  snapshotted, so a dated SoundCloud single could never be new and always sorted into the
  undated tail), and `live` joins the release types.

> **The docblocks in `manifest.ts` lie about two of these.** `controls` is tagged `(0.29.0)`
> and `customControls` `(0.30.0)`, and **0.29.0, 0.30.0 and 0.31.0 never existed** — no
> commit ever set `PACKAGE_VERSION` or `package.json` to any of them. The bump went 0.28.0 →
> **0.32.0** in this single commit, and all three features shipped there. Trust this file's
> headings over an inline version tag in that range.

---

## Earlier versions, by theme

0.1.0 (`233d0bb`, 2026-08-07) through 0.28.0 (`4b98666`, 2026-08-21). Both live sites are
past all of it, so it is summarised rather than itemised — the commit for any given bump is
in `git log -- packages/site-bridge/package.json`, which is the only anchor that exists
(**there are no git tags per version**; the one tag in the repo is
`pre-site-bridge-migration`).

| range | theme | why it mattered |
| --- | --- | --- |
| **0.1.0 – 0.2.0** | the contract becomes a package (`@samfox1/site-bridge` on GitHub Packages), and the last hand-mirrored copies of it go | a contract two repos each restate is a contract that drifts |
| **0.3.0 – 0.4.1** | `reveal` — the editor can ask a site to bring a region into view it has not put on the page yet | a control for something behind a tab did nothing, silently |
| **0.5.0 – 0.9.8** | the style vocabulary fills in: glow, decoration-line dressing, cursor + pointer trail (`/cursor`), entrance animations and hover states (`/entrances`), scopes (`site` / `chrome` / `item` / `icons`), URL-inferred social platforms, manifest-declared video slots | one edit path per thing; a site stops inheriting another site's slots |
| **0.10.0 – 0.12.1** | vertical padding, hero alignment, gap, styleable social-icon group, content width; `PACKAGE_VERSION` + the `bridgeVersion` republish flag | the flag is what makes a version difference visible to a manager at all |
| **0.13.0 – 0.15.0** | `fetchPublicSite` in the SDK, `auditRegions` (a site checks ITSELF), and **`CONNECTING.md` — the contract as a document, versioned with the code** | if the doc and the package disagree, the package is right and the doc is a bug |
| **0.16.0 – 0.18.0** | size and font become **CSS variables**, then the six text tokens; `checkContract` turns §7 into code | class-writing controls beat a site's breakpoints; §5 "claiming a property" starts here |
| **0.19.0 – 0.23.0** | mobile overrides, and the route to them: a fluid clamp in 0.20.0, **reverted in 0.21.0 (`0ee45a2`, marked `!`)** back to the discrete model, then phone twins for the whole style set | the clamp fused two picks into one value and each slider moved both ends |
| **0.24.0 – 0.25.9** | **delta overrides (`7082d3d`, marked `!`)** — a stored override is a sentinel plus only the changed tokens, so a styled region stops freezing; per-item deltas in 0.25.4; measured selects in 0.25.0 (`getComputedStyle` at select time, so sliders park on reality) | the frozen-region and reset-removes-the-property rough edges both die here; measured selects close a six-sighting bug class |
| **0.26.0 – 0.28.0** | image slots become named photo COLLECTIONS, `itemStyling` (a site can lock its look and keep Replace), site-written fields (`writeField` — 0.27.0, what a manager arranges ON the page), a media region is a picture | an untagged photo belongs to the FIRST declared image slot, so no site needed a backfill |

The two commits marked `!` (0.21.0 and 0.24.0) are the only breaking changes anyone flagged
as breaking at the time. Both are below every live site's floor.

---

## Breaking changes — the whole index

A required member added to a type a consumer **constructs** is breaking regardless of the
digits. That is the class to watch, and it is the class that has bitten.

| version | what broke | who felt it |
| --- | --- | --- |
| **0.35.0** | `pageChanged` became a required member of the `onMounted` handle. A shell never constructs a handle; **its test double does**, as an object literal. Skeen's typecheck went red on install with no change on skeen's side. Fixed in **0.35.1** by exporting `FrameHandle`. | skeen, 2026-09-03 |
| **0.33.1** | `SiteRelease.links` widened from `Record<string, string>` to a union — breaking for a consumer indexing it as a record, in a PATCH. Nobody was exposed: `SiteRelease` first shipped in 0.33.0. | nobody |
| **0.33.6** | `faqEntries` / `faqPageJsonLd` moved to `FaqSource`. Type-compatible (every added member optional), but **silently lossy**: automatic answer Q4 stays empty until the caller passes `releases`. A compile-clean upgrade that quietly renders less. | anyone on 0.33.5's FAQ sheet |
| **0.24.0** (`7082d3d`, marked `!`) | delta overrides changed stored-override semantics. Legacy full-string rows keep replace semantics and self-upgrade on next edit. | below every live floor |
| **0.21.0** (`0ee45a2`, marked `!`) | the 0.20.0 fluid clamp was removed and the discrete mobile model restored. | below every live floor |

**Nothing else in 0.32.0 → 0.35.2 is breaking.** Verified by diffing the exported surface of
every module across the range: `contract.ts` is byte-identical to 0.32.0; `frame.ts` changed
only to add `FrameHandle`, `onSetPage` and `pageChanged`; every `payload.ts` and
`manifest.ts` addition is an optional member; `protocol.ts` gained two message variants and
`BRIDGE_VERSION` did not move; the only `seo.ts` signature changes are the two listed above
plus parameter widenings (`safeHttpUrl(unknown)`, `auditSeo`'s optional `editError`), which
callers never feel.

---

## Version support

| version | site | why it is there | what moving forward takes |
| --- | --- | --- | --- |
| **0.38.0** | **skeen** (`^0.38.0`, resolved 0.38.0 — moved up from 0.35.2 with the analytics module) | It needs everything: the seo module is live on it (Phases 1–3, 2026-08-26), and it is the site the pages work was built for — `/about` and `/merch` exist. `app/edit/page.tsx` imports `FrameHandle`, handles `onSetPage`, calls `pageChanged`, and `lib/sitePages.tsx` renders the switchable pages. Its test double is typed `FrameHandle`, which is the 0.35.1 lesson applied. | Already current. The next handle member is free — the double is typed, so a growth shows up as an error naming the member instead of a mystery. |
| **0.32.0** | **ftbk** (`^0.32.0`, resolved 0.32.0, branch `lone-star-connect`, clean, last commit 2026-08-21) | It is a single-page desktop-metaphor site with no music catalog and no SEO surface, so the entire 0.33 → 0.35 range is features it does not use. 0.32.0 is also the version that gave it `controls` (its dock is one Size slider) and `mainCss` in `checkContract` — ftbk was the fourth site to hit the uncompiled-tokens bug, and the guard against it is at its floor, not above it. | See below. Two required edits (`package.json`, the lockfile) and one that is optional today but is the pattern that broke skeen (`app/edit/page.tsx:34`). Everything else is opt-in. |
| **workspace `*`** | **lone-star** (this repo, `packages/*`) | The editor consumes the package **from source**, so it is always on the working tree — 0.38.0 plus whatever is uncommitted. That is deliberate: the editor is the newest peer by construction and must handle every older site, which the seven gates above are how it does. | Nothing to move. The risk runs the other way: a change here is live in the editor immediately and reaches a site only when the package is published AND the site redeploys **without build cache** (Vercel will otherwise serve a cached build with the old package inside, and new tokens silently no-op). |

Only skeen and ftbk have a `custom_site_url`; juniper-hale and glass-atlas were deleted from
the live DB on 2026-09-04. Any earlier note about "three live sites" predates that.

### What is published

The registry is private, so this file cannot enumerate it. What the repo does prove:
**0.32.0** (ftbk's lockfile resolves it from `npm.pkg.github.com`), **0.34.0** (a `seo.ts`
comment records a bug "caught by skeen's own sitemap test the day 0.34.0 was installed"),
**0.35.0** (skeen's typecheck went red *on the install*), and **0.35.2** (skeen's lockfile
and `node_modules`). Per Sam: **0.33.6 and 0.34.0 were bumped locally, and 0.33.6 was never
published** — so 0.33.6's contents reached sites inside 0.34.0. Everything else is a version
number in this repo's history and nothing more.

---

## ftbk upgrade path, 0.32.0 → 0.35.2

Inventoried read-only on 2026-09-04, and left at that target deliberately: this is what the
range was actually diffed against. skeen has since moved to 0.38.0, so an ftbk upgrade today
crosses 0.36.0-0.38.0 as well — their own entries above say what each one costs, and neither
adds a required member to anything ftbk constructs.

Inventoried read-only on 2026-09-04. ftbk imports nine of the twenty subpaths — `payload`,
`markers`, `manifest`, `protocol`, `bind`, `public-site`, `styles`, `contract`, `tokens.css`
— always subpath-explicit, never the bare entry. `next.config.ts:6` transpiles the package,
which ships raw TS.

**What it already has, and therefore does not need to build:** the bind-once registry
(`lib/registry.ts`), the frame bridge with a thunk manifest and re-announce on content
change, site-written fields via `writeField` (0.27.0), delta overrides with tests
(`test/styleRegions.test.tsx` pins `DELTA_SENTINEL` semantics), `media` scope plus the
`controls` allowlist, `customControls`, `bridgeVersion: PACKAGE_VERSION`,
`styleOptions.bgColors`, `assetBudgets`, `itemStyling: false`, `tokens.css` imported **and
asserted as a test rather than trusted as a comment**, `checkContract` with the real
`globals.css` passed as `mainCss` over a stitched union DOM (it shows one window at a time,
so no single render holds every declared surface), `fetchPublicSite`, and reveal/highlight
handling.

**What it lacks:** the entire seo module and any JSON-LD, `robots.ts` or `sitemap.ts` (its
whole SEO surface is a hardcoded `Metadata` object at `app/layout.tsx:4-7`); any `pages`
declaration or `setPage` / `pageChanged` handling; the `music` module; `social` /
`social-icons`; `vocabulary`, `cursor`, `entrances`, `playback`.

### Required — this is the whole mandatory upgrade

1. **`package.json:15`** — `"@samfox1/site-bridge": "^0.32.0"` → `"^0.35.2"`.
2. **Refresh the lockfile** (`npm install`), then `npm run typecheck` and `npm test`. Expect
   green: nothing ftbk imports changed incompatibly.
3. **Redeploy without build cache.** A cached Vercel build ships the old package inside it
   and every new token silently no-ops.

That is it. Every ftbk import resolves to a real bridge symbol and moves with the package.

### Strongly recommended — the pattern that broke skeen

4. **`app/edit/page.tsx:34`** hand-copies the handle's shape:

   ```ts
   const bridge = useRef<{ announce: () => void; writeField: (k: string, v: string) => void } | null>(null);
   ```

   **Safe today** — 0.35.2 only added `pageChanged`, and a narrower ref type still accepts a
   wider handle. It was also **forced** at 0.32.0: `FrameHandle` did not exist to import, and
   `grep FrameHandle` over ftbk's installed 0.32.0 returns nothing. But this is exactly the
   shape that broke skeen: the handle grows, and a hand-written copy of it under-declares
   silently instead of erroring. Replace with
   `useRef<Pick<FrameHandle, 'announce' | 'writeField'> | null>(null)` — the two members it
   actually uses (`announce()` at :68, `writeField()` at :75, wrapped as `saveArrangement`
   for the 0.27.0 arrangement field) — imported from `@samfox1/site-bridge/frame`. As an
   annotation, not an `as` cast.

### Optional, in the order that pays

5. **`data/loneStar.ts:146`** — `t.released !== false && t.has_audio` is a hand-inlined copy
   of the platform's released door (deliberately legacy-tolerant: `!== false`, not
   `=== true`). No type protects it, so a rule change on the platform side cannot break it
   loudly. It is the one place a music-law change could diverge from ftbk in silence. ftbk has
   no project ordering at all (`works: [...videoWorks, ...imageWorks, ...audioWorks]`,
   positioned by `scatterPosition(w.id)`), so **`orderMusicProjects` buys it nothing** — the
   ordering half of 0.32.0 is genuinely N/A here. Worth a comment pointing at the shared rule
   even if the code stays.
6. **`data/loneStar.ts:46`** — `DOCK_LINK_ROLES` is hand-listed while the bridge ships
   `SOCIAL_PLATFORMS` and `socialPlatform()` in `/social`. The manifest's `links` is derived
   from the local list, so the same fact lives in two places.
7. **The seo module.** The largest gap and the one a client would notice: `resolveSeo` in
   `generateMetadata`, `jsonLdGraph` + `jsonLdScript` inlined, `sitemap.ts`, `robots.ts`,
   `about` declared, real `alt` on every image, and `auditSeo` over the built html as §7
   rule 6. `CONNECTING.md` §10 is the checklist.
8. **Pages: skip it.** ftbk's `app/` tree is four files and it is single-page by
   construction. `pages` absent means one-page, which is the historic behaviour and needs no
   code. **And the editor has no page switcher yet** — `use-frame-bridge.ts:223` posts
   `set-page`, but nothing in the editor UI calls it (P2 of `SITE_PAGES_PLAN.md` is unbuilt
   as of 2026-09-04). Adopting pages today buys a site nothing visible.

**`REGION_BASE` duplicated between `lib/registry.ts:33-42` and each manifest entry's `base`
is fine** — it is guarded by an identity test at `test/styleRegions.test.tsx:57`, which is
what makes it safe drift rather than a mirror.

---

## Building a NEW site against an older bridge

This is the other half of Sam's condition, and the part `CONNECTING.md` cannot answer on its
own: **it documents the latest contract only.** A builder targeting 0.32.0 who follows
today's sheet will implement §10 and §11 against a package that has neither, and find out at
the import.

**The sheet ships with the package.** `CONNECTING.md` is in `package.json`'s `files`, so
`node_modules/@samfox1/site-bridge/CONNECTING.md` **is** the contract for the version you
installed. Read that, not this repo's copy. That is the whole mechanism, and it is why the doc
lives in the package rather than in the repo root.

From inside this repo, the same thing without installing:

```sh
git show 9570011:packages/site-bridge/CONNECTING.md   # the sheet as it stood at 0.32.0
```

There are no per-version git tags, so the commit is the anchor —
`git log -- packages/site-bridge/package.json` maps every version to its commit, and the
headings in this file name them.

### What today's sheet claims that 0.32.0 does not have

Diffed 0.32.0 → 0.35.2. The sheet gained 94 lines and lost none:

- **§10 "Be findable" (0.33.0)** — the whole section. `@samfox1/site-bridge/seo` is not in
  0.32.0's `exports` map at all, nor is `/alt`. Every builder instruction in §10 is
  unimplementable there.
- **§11 "More than one page" (0.35.0)** — the whole section. No `pages`, no `page` tag, no
  `set-page` / `page-change`, no `onSetPage`, no `pageChanged`. A site on 0.32.0 is one page,
  full stop.
- **§7 rule 6, "the public page is findable" (0.33.0)** — §7 has **five** rules at 0.32.0,
  not six. Rules 1–5 and the `checkContract` example are otherwise identical: `contract.ts`
  has not changed since 0.32.0, `mainCss` and `tokens-not-compiled` included.
- **The `FrameHandle` bullet under "Known rough edges" (0.35.1)** — there is no exported
  handle type to reach for at 0.32.0. Hand-copy the inline shape from
  `node_modules/@samfox1/site-bridge/src/frame.ts` and expect to revisit it, which is exactly
  what ftbk did.

Everything else in the sheet — the one principle, bind-once, declare-what-is-editable, the
markers, declare-what-you-set, the variables and property claims, mobile overrides,
read-your-published-content, the two kinds of site, versioning, delta overrides, measured
selects — reads the same at 0.32.0 as it does today.

### How a builder should actually decide

Pick the version by what the site needs, not by what is newest:

- **Needs SEO/GEO** → 0.33.0 or later, and 0.35.2 for the trimmed-name and no-name fixes that
  keep a hole out of a page whose whole job is being quoted verbatim.
- **Needs more than one editable page** → 0.35.1 or later, never 0.35.0 (see the breaking
  table), and know that the editor's switcher UI is not built yet.
- **Needs neither** → 0.32.0 is a complete, current contract. It clears all seven of the
  editor's capability gates, and the only thing a manager sees is the "republish to apply"
  banner.
- **Whatever you pick**, pin it as a caret and let the minor hold it: `^0.32.0` cannot become
  0.33.x. Stamp `bridgeVersion: PACKAGE_VERSION` in the manifest — a site that stamps nothing
  is treated as old and never gets value tokens at all.
- **Verify against the installed copy, always.** The rule from the top of `CONNECTING.md`
  holds per version: if the sheet and the package disagree, **the package is right**. Two
  version tags in 0.32.0's own `manifest.ts` say `0.29.0` and `0.30.0`, versions that never
  existed.
