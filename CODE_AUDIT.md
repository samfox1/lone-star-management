# Code audit — the standing pass

Started 2026-09-18. Purpose: go through the codebase in chunks and **improve, consolidate,
audit, and delete**. Not a rewrite. Not a feature. The measure of a good pass is lines
removed and rules that got easier to see.

54k lines of src + bridge, 56k lines of tests, 149 migrations, 18 scripts, 22 root plan
docs. Too big to hold at once, which is why it is cut into silos.

## The rules of the pass

1. **Survey is read-only.** A survey agent reads and reports. It never edits. Every finding
   lands in the ledger below before a single line changes.
2. **One silo edits at a time.** Two agents editing `src/lib` at once produces a merge no
   one reviewed. Fixes are dispatched per silo, serially, after triage.
3. **A deletion needs proof it is dead.** Grep `src`, `tests`, `packages`, `scripts`,
   `supabase` — and for anything exported from `packages/site-bridge`, also
   `~/Desktop/skeen-website`. The bridge is a published package: its exports are public API
   and "unused here" means nothing.
4. **Test discipline still applies** (AGENTS.md). Deleting a guard means deleting its test,
   and that is exactly the move that silently drops a rule. Any consolidation that touches a
   guard runs `npm run mutation:changed` before it is called done.
5. **A finding without a file:line is not a finding.**

## Model rubric — which agent runs on what

The conductor (this session) assigns a tier per unit of work. The tier follows the *kind* of
judgement needed, not the size of the file.

| Tier | Use it for | Why |
| --- | --- | --- |
| **haiku** | Mechanical inventory: list every export and its call sites, find files no import reaches, tabulate duplicate string literals, read 22 plan docs and say which describe shipped work. | No judgement, high volume, cheap. Its output is a table someone else reasons over. |
| **sonnet** | Consolidation with a known shape: three near-identical helpers into one, a hand-listed set that should derive from a registry, a component split that follows an existing pattern. | The answer is discoverable from the code. Needs care, not invention. |
| **opus** | Architecture calls: does this module earn its existence, is this abstraction load-bearing or ceremony, is this test pinning the wrong rule, should this boundary move. | Wrong answers here cost a week. |

Escalation is allowed in one direction: a sonnet agent that finds an architecture question
reports it rather than deciding it, and the conductor re-runs it on opus.

## Silo map

| # | Silo | Territory | Lines | Survey tier |
| --- | --- | --- | --- | --- |
| 1 | **site-bridge** | `packages/site-bridge/src` (22 modules) | 6.7k | opus |
| 2 | **Site editor** | `src/app/artists/[id]/(dashboard)/editor`, `src/lib/site-editor` | ~7k | opus |
| 3 | **Dashboard actions + tools** | `(dashboard)/actions.ts` and the tool pages | ~9k | sonnet |
| 4 | **Analytics** | `src/lib/analytics*`, `map*`, `geo-*`, `compare-posthog`, `posthog-check` | ~3k | sonnet |
| 5 | **Content + sync** | `content.ts`, `sync*.ts`, `site-content-schema`, `music/releases/tracks/song-*` | ~3.5k | opus |
| 6 | **Integrations** | `spotify`, `apple`, `deezer`, `bandsintown`, `ticketmaster`, `youtube`, `drive*`, `merch/shopify`, `integrations-registry` | ~2.5k | sonnet |
| 7 | **Media + storage** | `upload`, `resumable-upload`, `storage-*`, `media-rename`, `video*`, `audio`, `cover-url` | ~1.5k | sonnet |
| 8 | **Public site render** | `src/app/[slug]`, `src/components` incl. `templates` | ~4k | sonnet |
| 9 | **SQL** | `supabase/migrations` (149), functions, grants | — | sonnet |
| 10 | **Tests + harness** | `tests/**`, `vitest*.config.ts`, `stryker.config.json` | 56k | opus |
| 11 | **Scripts + docs** | `scripts/`, 22 root `*.md` | 7k md | haiku |

## Ledger

Findings land here per silo, ranked, each one `DELETE` / `CONSOLIDATE` / `SIMPLIFY` /
`TEST-GAP` / `RISK`, with file:line and evidence. Nothing is actioned straight from a survey
— the conductor triages first.

### Wave 1 — surveys

#### Silo 11 — scripts + docs (haiku) — REPORTED

**Scripts (18).** All 18 accounted for, no npm script points at a missing file, no two
scripts duplicate each other. Six are not wired to npm and are run by hand with `npx tsx`:
`build-major-cities.ts`, `build-map-data.ts` (one-off data generation) and `pull-skeen.ts`,
`seed-skeen.ts`, `skeen-cinematic.ts`, `upload-skeen-media.ts` (the destructive Skeen
setup sequence). That is deliberate and the destructive four should STAY unwired.

**Docs (23 root files, 7k lines).** Verdicts:

| Verdict | Files |
| --- | --- |
| REFERENCE (stays at root) | AGENTS.md, CLAUDE.md, PLAN.md, README.md, CONTEXT.md, CODE_AUDIT.md |
| LIVE | TODO.md, steaksauce.md, BRAND_COLORS_PLAN.md, MERCH_PLAN.md, PRESENCE_PLAN.md, SEO_GEO_PLAN.md, SITE_BRIDGE_PLAN.md, SITE_BRIDGE_REVIEW.md, SITE_EDITOR_PLAN.md, SITE_STYLING_PLAN.md, REDESIGN_PRD.md |
| SHIPPED (historical record) | ANALYTICS_PAGE_PLAN.md, ANALYTICS_STATS_PLAN.md, DASHBOARD_PLAN.md, SITE_PAGES_PLAN.md, REVIEW_2026-09-03.md, REVIEW_2026-09-11_ANALYTICS.md |
| STALE | SERVICE_MODEL_PLAN.md (354 lines, "Paused 2026-08-21. Nothing here is built." — verified: no code, no routes) |

Two contradictions worth a decision, not a fix:
- `REDESIGN_PRD.md` says "draft for approval, no code until decisions settled" while the
  multi-page dashboard it describes is already live. The PRD is really a reskin of an IA
  that shipped underneath it.
- `BRAND_COLORS_PLAN.md` puts colour choice in onboarding; `REDESIGN_PRD.md` puts
  onboarding out of scope.

Nothing here is dead enough to delete. The move that pays is **archiving the six SHIPPED
docs to `docs/archive/`**: it takes ~2,000 lines of finished plan out of the root, and the
root then lists only what is still true. Their names are cited from test comments
(`REVIEW_2026-09-03 H3`, etc.) but by NAME, never by path, so the citations survive a move.
`docs/` already holds 12 ADRs and 4 contracts and is the right home.

CONDUCTOR NOTE: the haiku pass hedged to "nothing is safe to delete", which is the expected
failure mode of the cheap tier on a judgement question. The inventory itself is sound and
that was the job. The archive call is mine.

#### Silos 6+7 — integrations + media/storage (sonnet) — REPORTED

The headline is a NEGATIVE, and it is the good kind: the thing this silo was most likely to
be rotten with is already clean. Six provider clients (Spotify, Apple, Deezer, Bandsintown,
Ticketmaster, YouTube) all route through the one `httpGetJson` primitive in `src/lib/http.ts`
— ADR-0005 did that consolidation and it held. `integrations-registry.ts` is a real single
source: `connections.ts` and the dashboard both derive from it with `Record<IntegrationKey, …>`,
so adding a provider without wiring its actions is a compile error rather than silent drift.
`safeHref` is applied at every render site checked. No dead providers.

Eight findings, all small, all removing lines:

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | TEST-GAP | `src/lib/video-render.ts` has DB-free tests but is missing from `stryker.config.json` `mutate` — never mutation-checked | S |
| 2 | CONSOLIDATE | `{origin}/storage/v1/object/public/{bucket}/{path}` hand-built in 4 places; `video-render.ts:44` reads `process.env` unguarded, the exact shape `cover-url.ts:49` documents as a past bug | S |
| 3 | CONSOLIDATE | `SHOPIFY_KEY = 'shopify'` declared twice (`connections.ts:31`, `sync-sections.ts:40`) | S |
| 4 | CONSOLIDATE | 3 identical storage-GC functions in `storage-gc.ts:48/74/105`, differing only by table+bucket | S |
| 5 | CONSOLIDATE | byte-identical `coord()` in `bandsintown.ts:37` and `ticketmaster.ts:39` | S |
| 6 | CONSOLIDATE | Retry-After guard copied from `http.ts:35` into `merch/shopify.ts:160` (comment admits it) | S |
| 7 | CONSOLIDATE | Deezer track-id regex written twice in one file (`song-links.ts:44` and `:77`) while Apple's is already factored | S |
| 8 | CONSOLIDATE | `drive-import.ts:37` hand-copies `AUDIO_UPLOAD_RULES` from `upload.ts:45` | S |

#### Silo 3 — dashboard actions + tool pages (sonnet) — REPORTED

`actions.ts` is 1,758 lines and 75 exported actions. Ten findings.

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | DELETE | `refreshSpotifyAction:1496`, `refreshYouTubeAction:1108`, `saveSeoAction:280` — zero callers in src or tests; each duplicates a live sibling | S |
| 2 | DELETE | `(dashboard)/toolbar.tsx` — 38 lines, its only export `ToolbarIconLink` has no importer | S |
| 3 | CONSOLIDATE | `GridCard`'s comment claims 4 users; it has 1. Tracks/Videos/Releases each rebuild the same open-state + CardModal + SelectToggle, and `track-card.tsx:62` says so in a comment | M-L |
| 4 | CONSOLIDATE | Brand and Settings, the owner's own reference pages for the row grammar, each hand-roll a local `Row` instead of `KvRow` — and have drifted to 3 label widths (100/120/120px) | M |
| 5 | CONSOLIDATE | 6 editor actions repeat the same auth+ownership block; `callerOwns`, built for exactly this, has 1 call site | M |
| 6 | CONSOLIDATE | 5 password-gated publish actions repeat gate → publish → gc → revalidate | M |
| 7 | CONSOLIDATE | `setMediaAltAction` / `setMediaKindAction` / `setMediaLabelAction` are one single-column update written 3× | S |
| 8 | TEST-GAP | `deleteMediaAction:525` deletes by id alone, no `artist_id` scope, relying purely on RLS — and no cross-tenant delete test for `media` exists anywhere | S |
| 9 | SIMPLIFY | `actions.ts` splits cleanly into integrations (20 fns, already treated as one unit by `integrations.ts`), music (10), site-editor (11), leaving a ~600-line core | L |
| 10 | SIMPLIFY | the row-label class string is copy-pasted raw in 12 files, 20 hits, inconsistent widths | S |

CONDUCTOR NOTE: finding 8 plus its architecture question is the real one. Some actions call
`callerOwns`, some hand-roll an artist refetch, and some (`deleteMediaAction`,
`setReleaseOnSiteAction`, `setMediaAltAction`, `saveArtistFactAction`) do neither and lean
entirely on RLS. That may be the intended convention — `DASHBOARD_PLAN.md` §1 says RLS is the
boundary — but AGENTS.md rule 3 is explicit that a row-filtered write returns `error: null`
with zero rows, so a denied delete and a successful one are indistinguishable to the caller.
Deciding that convention is Sam's call and it gates finding 5. Finding 9 must NOT start until
silo 2 reports: 11 of those actions back the editor surface.

#### Silo 4 — analytics (sonnet) — REPORTED

The most disciplined report of the wave: four findings and a refusal to invent a fifth.

**The eight map/geo files are five concerns, and the split is deliberate.** Each boundary has
a stated reason and most have a test pinning them: `map-constants.ts` is severed from
`map-projection.ts` so client components can read `MAP_W`/`HEAT_R` without pulling in `d3-geo`
(`tests/unit/analytics/client-imports.test.ts` pins it); `map-view.ts` is d3-free by design
because the flat map and the globe share it; Mercator and orthographic are different maths;
`geo-distance.ts` is shared between runtime and build script precisely so the two radii cannot
drift. No merge removes lines without breaking a tested boundary. Answered, not actionable.

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | CONSOLIDATE | `src/app/roster-data.ts:80-95` re-derives day-bucketing and zero-fill that `lib/analytics.ts:69-89,232` already owns — AND reads the OLD `analytics_summary`/`analytics_daily` RPCs while the per-artist tab reads the newer `analytics_timeline` family. Two live reader surfaces over overlapping data. | M |
| 2 | TEST-GAP | `roster-data.ts` window/day maths has zero coverage; the one test that names it mocks the single function it does not test | S |
| 3 | CONSOLIDATE | `entity-sparkline.tsx:30,43` hand-rolls a 30-day zero-filled series while music/videos/tour/merch pages all call the shared `daysAgo(30)` | S |
| 4 | CONSOLIDATE | `MONTHS` array defined verbatim twice (`lib/chart.ts:63`, `app/analytics/page.tsx:26`) | S |

Verified clean, so nobody re-litigates it: the view=landing rule exists in exactly the two
places it is supposed to and nowhere else; `ANCHORS` and `FRAMES` derive from generated data
rather than hand-lists; `analytics.isolation.test.ts` follows AGENTS.md rules precisely
(planted witness, exact denial code, scoped teardown); the exports that look unused are all
used inside their own module, so un-exporting them removes no code.

None of this touches what either pipeline RECORDS, so all four are safe inside the live
30-day PostHog window.

CONDUCTOR NOTE: finding 1 is the seed of a bigger question — whether the roster page should be
migrated onto the same RPC family as the per-artist tab, retiring `analytics_summary` and
`analytics_daily` entirely. That is a real architecture call and it belongs with silo 9's
migration archaeology; HOLD until that lands.

#### Silo 5 — content + sync (opus) — REPORTED

The richest silo of the wave, and the only one that turned up **live bugs** rather than tidying.

**Three things are wrong right now:**

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | RISK | `PUBLISHABLE[type].orderBy` says it is "also the published order, kept in sync" — for merch it is not. Preview orders merch oldest-first, the live door newest-first (`content.ts:269` vs `20260911120000…sql:102`). `20260910160000_merch_newest_first.sql` changed the door and nothing changed the TS. For `tour_date` the documented undated tie-break is not implemented at the door at all. `grep -rn "orderBy" tests` → **zero hits**, and the parity test is deliberately order-insensitive. | M |
| 2 | DELETE | The "Manager tools" tab watches `dirty['links']`, a segment that stopped existing when Links and Sources merged into Connections (`cbcba6c`, 2026-09-13). Always undefined, so unpublished Connections edits never show a dot. | S |
| 3 | TEST-GAP | `DIFF_SECTIONS` hand-lists 9 of the 11 `UnpublishedDiff` keys, missing `site_styles` and `artist_font`. A site with only unpublished styles reports "Live / everything published". Zero tests: `grep -rn "DIFF_SECTIONS\|dirtyBySeg\|dirtySegs" tests` → no matches. The sibling registry in `editor-publish.tsx` learned this exact lesson and derives its fixture from `Object.keys(PUBLISHABLE)`; this one got neither. | S |

**One latent data-loss path:**

| 11 | RISK | `listContent` has no `.limit()` or `.range()`, so it carries the same silent 1,000-row PostgREST cap that `publishContent` documents and works around two functions away. `publishContent` tombstones every published id NOT in that list — so a truncation reads as "these were deleted" and removes real content from the live site. Not live today (largest set found is ~83 rows), latent. | S |

**Clean deletions:**

| 4 | DELETE | `parent_release_id` was retired 2026-09-11 and is still SELECTed, still written by the merge, and pinned by `song-merge.test.ts:190` — a test defending retired behaviour | S |
| 5 | DELETE | `src/lib/tracks.ts`, 68 lines, zero production callers; only two test files import it, so a live-DB suite is exercising a facade the app never calls | S |
| 8 | DELETE | Four references to `reconcileOnSite`, a function that no longer exists, including a docblock attached to nothing at `content.ts:15` | S |

**Structure and rule-4 shapes:** [6] five modules have DB-free tests but are absent from
`mutate` — `custom-site.ts` (the SSRF guard, hand-written IPv4/IPv6 range arithmetic),
`music.ts`, `song-links.ts`, `sync.ts`, `content.ts`. [7] `content.ts` is four concerns in
1,006 lines and the consumers already split along the seam. [9] `DRAFT_PRESENCE` is a
hand-written array beside its union where `LIVE_TOGGLE` thirty lines above gets it right.
[10] `MERGE_COLUMNS` is asserted non-overlapping but never TOTAL — the exact failure its own
docblock names. [12] `on-site-paths.test.ts:63` hand-lists the gated types in a file whose
header promises nothing is hand-listed.

Verified NOT drifted: `releaseIsReleased`/`trackOnPlatform` agree with their SQL mirrors and a
test feeds identical fixtures through both; `orderMusicProjects`/`isNewRelease` have no second
copy; `library-order.ts` is a genuine de-duplication with no surviving twin.

CONDUCTOR NOTE: [6] is now the THIRD silo to land on the same hole. Silos 6+7 found
`video-render.ts` missing from `mutate`; silo 5 found five more including the SSRF guard; both
observed that `mutation-config.test.ts` polices where tests LIVE but never that a module with
DB-free tests is IN the slice. That is one fix, not seven, and it is the highest-leverage item
in the audit so far. Still holding for silo 10, which owns that config.

#### Silo 8 — public site render (sonnet) — REPORTED

First, two things it cleared: `artist-template.tsx` and `artist-site.tsx` are NOT duplicates
(the first is a 39-line dispatcher, the second is the classic body), and `components/ui/**` is
not part of this silo at all — nothing under `[slug]`, the templates or `artist-site.tsx`
imports it. It is exclusively the dashboard's UI kit. My scoping error, not a finding.

**The headline is a product question, not a cleanup.** `classic` is the DB-level default
template for every new artist (`20260624130000_artist_templates.sql:4`) and
`grep -c "data-lse" src/components/artist-site.tsx` returns **0**. It has no editor markers at
all, so click-to-select is dead for the default tier, while `MANIFESTS.classic` still declares
fields and slots the editor believes are clickable. Both built-in manifests also declare
`styles: []`, so the Style tab — rendered unconditionally — is empty for every built-in artist,
classic or cinematic.

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | RISK | `classic`, the default template, ships zero `data-lse` markers; the editor's click-to-select is non-functional for it | M |
| 2 | RISK | Both built-in manifests declare `styles: []`; the Style tab is always shown and always empty for them | S or L |
| 3 | DELETE | `MANIFESTS.cinematic` declares a `work` slot accepting tracks; the template never reads `data.tracks` and no panel reads that key | S |
| 4 | TEST-GAP | The cinematic marker test mocks out `CinematicWork` entirely, so it cannot notice that `work_heading` — a declared, manager-editable field — has no marker while its four sibling headings all do | S |
| 5 | TEST-GAP | No test renders classic and checks for markers; the adjacent uniqueness test carries its own comment calling itself "VACUOUS here. Deleting it changes nothing." | S |
| 6 | RISK | The in-repo template satisfies none of the bridge's findability contract (no sitemap, no robots, no JSON-LD anywhere in `src/app`), yet the SEO tool's "Run check" audits exactly that contract against it — so every template-hosted artist gets a permanently red check with no path to green | M |
| 7 | TEST-GAP | `seo-live-audit.test.ts` runs only against hand-authored fixture HTML modelled on skeen, never the template's real output, which is why nothing caught [6] | M |
| 8 | CONSOLIDATE | `src/lib/seo.ts:22` hand-rolls title/description/og precedence that the bridge's `resolveSeo` exists to own ("ONE precedence everywhere"). Agent did not diff the branches — unverified, needs checking before acting | M |
| 9 | ? | `/welcome` and `/apply` are public routes linked only to each other; nothing else in the repo links in. If there is no external link, that is a dead funnel including `/admin/applications` | — |

CONDUCTOR NOTE: [1], [2] and [6] are one question wearing three hats — **is the in-repo
template still a product, or has it been quietly superseded by bridge-connected custom sites?**
It is the DB default, it cannot be clicked in the editor, it has no style regions, and it fails
the findability contract that custom sites must pass. Every individual fix is cheap; deciding
whether to make them is Sam's. [9] needs a person, not code. Silo 1 owns the bridge half of
[8]; hold it for their report.

#### Silo 2 — site editor (opus) — REPORTED

Fifteen findings. One live bug, ~250 lines of provable dead code, and the clearest answer yet
on `style-controls.ts`.

**Live bug.** [1] `closeEditors()` (`editor-inspector.tsx:413`) clears four editors and not the
fifth. `editingSite` (the SEO/facts panel) was added 2026-09-09 and missed it, so with that
panel open a frame click on a heading cannot dismiss it — the panel renders on top. The
function's own comment says it exists as "ONE dismissal for every routed select, so the next
editor added here cannot be missed by one of the branches". It was missed by one of the
branches. Same class as two incidents already recorded in the test file (2026-08-09, repeated
2026-08-18). [2] The dismissal test hand-lists ONE editor, so it structurally cannot see it —
and its own comment records that an earlier version passed with the bug in place.

**Dead code, all verified by grep:**

| # | Claim | Lines |
| --- | --- | --- |
| 3 | `styleOnly` is structurally unreachable — `textPanelEntries` never emits a field-less entry, so `!e.field` is always false. Two instructional paragraphs and their branches are dead, plus a `void claimed` remnant | ~30 |
| 4 | `isTextRegion` + its whole predicate stack (`CASING`, `bare`, `setsType`) has **0 references in src**; all 12 are in one test whose comment claims it "still decides which region can PAIR with a field" — it does not, and has not since the region-only loop went. A textbook wrong-rule test | ~45 |
| 5 | `/artists/[id]/edit` is an orphan route and `updateArtistAction` exists only to serve it; Settings replaced both, and its own comment admits it duplicates the validation | ~81 |
| 7 | An unreachable duplicate block in `buildTextItemStyleControls:971-978` — the same four lines written twice, the first returning unconditionally | 4 |
| 15 | 12 dead re-export shims + `INVALID_RING` | ~15 |

**`style-controls.ts` (1,818 lines) is five modules,** and the seams are already commented as
separate concerns: token predicates + ranks (~400), five control builders, region scoping,
and the read/apply/delta engine (~205, the only part `rebase-styles.ts` consumes). On the
"derive from the bridge" question the agent was precise: the option TABLES already do — 30 step
arrays are imported from `@samfox1/site-bridge/vocabulary`. What is hand-listed is the control
layer, which is legitimately editor-side. One genuine registry gap remains:

| 12 | RISK | the phone-twin `TWIN` set hand-lists control ids in front of a `phoneTwin` that is fully generic and whose comment says "the twin can never drift from its desktop original". The set in front of it IS the drift: a new text control renders desktop-scoped in phone view with nothing saying so. `size` and `pad` are also twinned by hand, 40 lines of ternaries computing what `phoneTwin` already computes | M |

Plus consolidations: [8] `SelectableTile`/`TileEditButton` were built to end per-panel card
drift and only `photo-tools` uses them (music and merch still hand-roll byte-identical
wrappers); [9] five panels hand-build the `item:<type>:<id>` focus key instead of calling the
bridge's `selectTargetKey`; [10] seven `bridgeSupports*` gates differing only by a constant;
[11] four `toggle*OnSite` + three `remove*` copies in the inspector, in a file that already
proves the pattern generalises (`reorderBy` collapsed four reorders into one); [13]
`MEASURE_BY_ID` vs `StyleControl.measure` are two mechanisms for one job and the by-id one is
documented as wrong (it cannot tell a rem text-size `size` from a percent item scale `size`);
[14] three React idioms hand-copied 5×/3×/3×.

CONDUCTOR NOTE: **two silos have now independently asked the same question.** Silo 8 found the
default template has no editor markers; silo 2 finds both built-in manifests declare
`styles: []` and asks whether `manifestFor`, `MANIFESTS`, `edit-frame`, `preview` and
`ArtistTemplate` are a second rendering path kept alive for nobody. Neither agent queried the
database, and both correctly refused to decide it. That is now the single biggest open
question in the audit.

Also flagged: **the no-instruction-copy rule has no enforcement.** Six live instructional
paragraphs remain (`site-tools.tsx:226,258,211,220`, `style-tools.tsx:355`,
`merch-editor.tsx:116`, `text-field-editor.tsx:174`), and `style-tools.tsx:364` carries a
comment recording that such a line was deliberately removed once — so the rule was applied by
hand and everything added since drifted past it.

#### Silo 1 — site-bridge (opus) — REPORTED

**Correction to my brief, and it killed a finding.** There is a THIRD consumer:
`~/Desktop/ftbk-website`, pinned to `^0.32.0`. The agent re-ran every dead-export sweep across
all three repos, and the finding it had ranked #1 — delete `public-site.ts` — died on that
check, because ftbk is its only user. This is exactly why rule 3 of this audit exists.

**The big one.** [1] The entire bridge is excluded from mutation testing — `styles.ts`,
`frame.ts`, `vocabulary.ts`, `seo.ts`, `contract.ts`, `manifest.ts`, `protocol.ts`, `cursor.ts`,
~5,300 DB-free-tested lines, none of it on the `mutate` list. Worse, `stryker.config.json`
contains two notes that contradict each other inside the same file: the caveat says the bridge
is absent, and the comment above it says "NOTE the workspace caveat below no longer says
'packages/site-bridge is absent'". It still says exactly that. The blocker is named AND solved
in the same config — a test must import by RELATIVE path, because the `@samfox1/site-bridge`
alias reports the whole file as no-coverage — but ~50 bridge test imports use the alias and
only 6 use relative paths.

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 2 | RISK | `checkContract`'s `mainCss` — its own docblock calls it "the single most valuable thing a connecting site can pass", citing "the drift bug of 2026-08-05, three times; ftbk was the fourth" — is passed by NEITHER site and appears in no doc. The check short-circuits on `undefined`. The guard is simply disarmed. | S |
| 3 | CONSOLIDATE | `contract.ts`'s `CLAIMABLE` hand-copies `styles.ts`'s `TEXT_VARS`; both files' comments claim a test couples them, but the fixture is a literal string and `TEXT_VARS` is module-private, so the coupling is prose. A seventh text family would be un-claimable with nothing firing. | S |
| 4 | RISK | `auditRegions`' "is this a size?" regex is UNANCHORED (`/^text-(xs|sm|...)/ ` with no `$`) where `styles.ts` uses set membership. Any palette colour starting `text-sm…`, `text-xl…`, `text-start…` is invisible to the audit that exists precisely to catch undeclared colours. Latent: neither site's palette collides today. | S |
| 5 | RISK | `mergeManifests` enumerates the keys it carries, so a future optional key on `TemplateManifest` compiles clean and is dropped on every multi-page site. No `keyof TemplateManifest` guard exists anywhere. The module's own comment admits nearly making this mistake once. | S |
| 6 | CONSOLIDATE | "there are five FAQ prompts" stated in 4 places across 2 packages; the test pins it with a hand-written `[1,2,3,4,5]`. A sixth prompt gets no manager field and silently never renders. Dormant — `PROBE_VERSION` is frozen. | M |
| 7 | CONSOLIDATE | skeen hand-rolls the `get_public_site` read that `fetchPublicSite` exists to retire — and ftbk, pinned three minors back, uses the bridge version. The module's docblock says it was written BECAUSE "Skeen hand-rolled it". It still does. | M |
| 8 | TEST-GAP | `VOCABULARY` (40 rows) and `MANAGED_STYLE_PROPS` (71 properties) have no derived sweep, while the sibling test beside them already builds exactly the machinery to do it. Agent ran both sweeps: **0 gaps today**. Missing guard, not a live bug. | S |
| 9 | RISK | `generate-bridge-tokens.ts` docblock says "nothing here is hand-written: ask the editor's own control builders" — it imports no control builder. It reads the hand-listed `VOCABULARY`. That comment is what stops a reader finding the gap in [8]. | S |
| 10 | RISK | CHANGELOG's version-support table — the file's stated reason for existing — says skeen is on `^0.35.2`. It is on `^0.38.0`. Three entries were added above those lines without updating them. | S |
| 11 | RISK | `isFrameMessage` asserts a full discriminated union from a three-field check, so `{v,source,type}` with no `target` narrows to the `select` variant, and `use-frame-bridge.ts:368` dereferences `msg.target.kind` unguarded. The FRAME side solved exactly this and documented why; the editor side never got it. | M |
| 12 | DELETE | ~22 duplicated lines of docblock in `frame.ts` that have already drifted (one copy documents `pageChanged`, the other does not). Also swept all 265 exports across three repos: 27 have no external consumer, and the agent correctly recommends LEAVING them — a site needs `ContractInput`, `MirrorConfig` etc. to type its own call sites. | S |

CONDUCTOR NOTE: [1] makes this the FOURTH silo to land on the mutation-slice hole, and the
most serious instance: it is not one module missing, it is 5,300 lines of the published
contract package. Combined with silo 5 (five modules incl. the SSRF guard), silos 6+7
(`video-render.ts`) and the shared observation that `mutation-config.test.ts` only polices
where tests LIVE — this is now unambiguously the #1 item in the audit. Silo 10 reports next and
owns the config.

#### Silo 9 — SQL, 149 migrations (sonnet) — REPORTED

**The result here is a clean bill of health, and it is the most valuable finding in the silo.**
All 149 migrations read chronologically. No live grants gap. That is not a shortfall of effort;
it is backed by specifics:

- Every live non-door function's last revoke uses the complete `from public, anon[, authenticated]`
  form. The only ones using the incomplete `from public` alone are the 7 intentional anon doors,
  each explicitly `grant execute … to anon, authenticated` immediately after.
- All three historical incidents are already closed by later migrations: `submit_enquiry`,
  `record_event_v2` (both named in AGENTS.md) and a third the agent found in the history —
  `reorder_rows`/`set_release_link`, closed in `20260911180000`.
- **Every** SECURITY DEFINER function sets `search_path` in the same statement. No exceptions.
- `get_public_site` is redefined 34 times, `get_release` and `audio_path_for_play` 7–10 times
  each, and none ever drifted in security mode or search_path across any version.
- Every rename is fully propagated with zero stale references in `src/`: `visible→on_site`
  across 7 tables, `visitor→visitor_hash`, `geo_cache_get/put→lookup_geo_cache/cache_geo`.
- All 27 tables with policies have RLS explicitly enabled. Both pg_cron jobs still resolve.
  Both Edge Functions' RPC calls match live signatures.

Three findings, all small:

| # | Kind | Claim | Effort |
| --- | --- | --- | --- |
| 1 | CONSOLIDATE | `analytics_summary` has no multi-artist mode, so `roster-data.ts:52` loops one RPC round trip per owned artist — while its sibling `analytics_daily` in the same file takes `p_artist_id default null` and is called both ways. `analytics_summary` now has exactly ONE caller, using it in the one mode it cannot do efficiently. | S |
| 2 | TEST-GAP | `audit-grants.ts:26` allowlists `rls_auto_enable` — a function that **does not exist in any of the 149 migrations**. A phantom allowlist entry is pre-authorisation: create a real function by that name for any reason and `npm run audit:grants` waves it through as known-safe. | S |
| 3 | CONSOLIDATE | The anon-lockdown loop for analytics readers is a hand-listed array; the two readers added after it was written got their own copy-pasted one-off revokes instead of joining it. Both correct today, and `audit:grants` is a real backstop, so this is drift risk, not a gap. | S |

CONDUCTOR NOTE: finding [1] **answers the question silo 4 held for me.** Silo 4 asked whether
the roster page should migrate onto the `analytics_timeline` family and retire
`analytics_summary`/`analytics_daily`. The answer from the SQL side is: not yet — the timeline
family has no nullable-artist variant either, so retiring the old pair outright needs that
capability BUILT first, not removed. The minimal fix is to give `analytics_summary` the same
`default null` shape its sibling already has. Two silos, one coherent answer; that is the
conductor pattern working.

Also note silo 9 independently raised silo 3's ownership question from the database side: none
of the RLS policies are wrong, but the schema gives a caller no way to distinguish a denied
write from a no-op write. It belongs in the same single decision.

#### Silo 10 — tests + harness (opus) — REPORTED

**Scale, corrected.** 56,237 test lines is 41,310 code + 9,375 comment + 5,552 blank, against
37,560 lines of source code. The real ratio is 1.10:1, not 1.5:1. The suite is not bloated by
an order of magnitude; it is bloated in about four identifiable families.

**[1] `npm test` destroys real data, on every run.** 46 teardown statements across 39
integration files use `delete().eq('artist_id', …)` — AGENTS.md rule 6 forbids exactly this —
and the seven sync files do it in `afterEach`, against BOTH seed artists. So every `it` wipes
`lone-pine` and `gulf-static`'s entire tour list, songs and videos. `enquiry-door.test.ts`'s
`clearRungs()` runs 20+ times and deletes the booking link, the `booking_email` row and the
whole `artist_mail_settings` row — the row another test carefully snapshots and restores.
`brand.isolation.test.ts:52` nulls `favicon_zoom`/`favicon_offset_y`, discarding real favicon
framing. `fonts.isolation.test.ts:57` wipes in `beforeAll`, before anything is planted. The
knock-on is the one AGENTS.md names: `sync.apple.test.ts:245` asserts artist B has 0 tracks,
guaranteed true because a prior `afterEach` emptied the table. The denial has no witness left.
`tests/helpers/rls.ts:106` already exports `deleteAddedSince`, and
`content.isolation.test.ts:63` already does it right.

**Tests that cannot fail** — each verified against its implementation:

| # | Claim |
| --- | --- |
| 2 | A test named for an `on delete cascade` never deletes anything; `expect(data).not.toBeNull()` passes on `[]`. Drop the cascade clause entirely and it stays green |
| 3 | Two storage-denial tests upload to a FIXED path nothing cleans up. Run 1 after the door breaks: object lands, test fails once. Run 2 onward: 409 already-exists, green forever, door open. The same file uses a fresh path per run for its fixtures but not for its attack |
| 5 | `expect(weight.kind === 'slider' && weight.owns(…)).toBe(false)` — `weight` is a select, so `&&` short-circuits and `owns` is never called. Its comment says "If that changes, this fails." It cannot |
| 6 | The size-ladder test rebuilds the implementation's map character-for-character and compares it to itself. Change a label from 176px to 200px and both maps agree, suite green |
| 10 | Three anon-denial assertions destructure `error` away; a re-grant to anon still yields `[]` and passes. One is `expect(error !== null \|\| length === 0)`, which passes on ANY error including a rename |
| 11 | The subscribe door's three distinct refusals are all P0001 under bare not-null — and the per-artist flood cap has NO test anywhere, the exact shape AGENTS.md cites as how "the flood cap vanished for a day" |
| 12 | `checkContract`'s root-inclusive branch is unreachable in all 437 lines of its tests; every caller builds a bare host that never carries a marker |
| 13 | The TS-vs-SQL music mirror hand-lists fixtures, and its own header names that as how `deezer_url` slipped once already |
| 15 | Four absence assertions in `editor-inspector.test.tsx` name strings that exist nowhere in `src/` — no deletion can turn them red |

**[4] The mutate list, quantified at last:** 2,115 lines of fully pure, DB-free-tested `src/lib`
absent from the slice, including **`custom-site.ts` (the SSRF host guard)**,
**`site-editor/save.ts` (the XSS refusal on the style-save path)** and **`fonts.ts` (the
CSS-injection sink)**. **[14]** The CI workflow's `paths:` filter has ALSO drifted — six modules
added to `mutate` in September were never added to the filter, so changing
`packages/site-bridge/src/analytics.ts`, which the config itself calls "the one way every site
reports a fan action", runs no mutation job. And no workflow runs the test suite at all; the
only `vitest` in CI is Stryker's dry run.

**Consolidations, ~970 lines:** [7] the CSS-variable family, 3 files / 542 lines, each
hand-typing a table that already exists in `styles.ts` (~420 out); [8] four tenant-isolation
files that are five copies of one block against byte-identical policies, where the registry
pattern already exists two folders over (~200 out); [9] five sync-provider files repeating one
conflict test and one tenancy test verbatim (~350 out); [15] `editor-inspector.test.tsx` is NOT
mostly boilerplate — a full census found 496 assertions and 510 mostly load-bearing comments —
but ~170 lines come out mechanically.

**Answered directly:** `mutation-config.test.ts` genuinely bites in BOTH directions today and
has its own precondition test. One consequence it cannot see: `cleanClassText`'s only biting
negative assertions are pure but live in a file that touches the DB elsewhere, so the folder
rule cannot flag them.

**Scheduled deletion, dated:** the whole PostHog cross-check — 2,398 lines, 1,344 of it test —
is marked for deletion "when the comparison passes", which `TODO.md` puts at the end of the
30-day window opened ~2026-09-15. Worth a dated reminder before it becomes permanent furniture.

**What held up:** the font CSS-injection sink, `jsonLdScript`'s `<` escaping, the on-site check
call-site sweep, the draft-presence registry derivation and the client-import walker all bite,
several with their own precondition assertions. One gap: the colour-control rule is pinned by
hand for `bgColor`/`textColor`/`borderColor`, while `hoverColor` and `decoColor` are
kind-checked by nothing.

---

## TRIAGE — the whole audit, ranked

All ten surveys in. ~120 findings. This is the order I would work them.

### Tier 0 — stop the bleeding

1. **Teardowns destroy real data on every `npm test`** (silo 10 [1]). 46 statements, 39 files.
   Actively harmful today; the helper and the correct pattern both already exist.
2. **Two storage-denial tests self-heal into permanent green** (silo 10 [3]). If the
   cross-tenant document door is open, nothing will ever say so again.

### Tier 1 — the disarmed guards (cheap, highest leverage)

3. **The mutation slice.** Four silos found this independently. 5,300 bridge lines + 2,115
   `src/lib` lines + a drifted CI path filter + a config that contradicts itself. Contains the
   SSRF guard, the XSS style-save guard and the CSS-injection sink. One coherent fix.
4. **`audit-grants.ts` allowlists a function that does not exist** (silo 9 [2]) — pre-authorisation.
5. **`checkContract`'s `mainCss` is passed by nobody** (silo 1 [2]) — its own docblock calls it
   the most valuable input a site can pass, citing four separate incidents.
6. **The nine tests that cannot fail** (silo 10) + the hand-listed dismissal test (silo 2 [2])
   + the hand-listed gated-types list (silo 5 [12]).

### Tier 2 — live bugs, all small

7. `closeEditors()` misses the SEO panel (silo 2 [1]).
8. Merch is ordered differently in preview than live (silo 5 [1]).
9. Unpublished Connections edits never show a dot (silo 5 [2]).
10. "Everything published" lies when only styles are unpublished (silo 5 [3]).
11. `auditRegions`' unanchored regex blinds it to whole palette colours (silo 1 [4]).
12. `listContent`'s missing row cap can read truncation as deletion (silo 5 [11]).

### Tier 3 — free deletions, ~700 lines

Editor dead code ~250 (silos 2 [3][4][5][7][15]), `tracks.ts` 68, `toolbar.tsx` 38, three
zero-caller actions, `parent_release_id`, `reconcileOnSite` remnants, the `work` slot, the
duplicated `frame.ts` docblock, six shipped docs archived out of the root.

### Tier 4 — consolidations, needs sequencing

Test families ~970 lines (silo 10 [7][8][9]); `content.ts` → 4 modules; `style-controls.ts` →
4 modules; `actions.ts` → 4 files (BLOCKED on decision A); the small duplicate helpers from
silos 6+7.

### Decisions — ANSWERED by Sam, 2026-09-18

| | Question | Answer |
| --- | --- | --- |
| **A** | Are the built-in templates still a product? | **No. Every artist gets a custom site from now on, built to fit the editor.** BUT NOT YET DELETABLE: FTBK's `custom_site_url` is `http://localhost:3004`, and the host guard demotes a localhost value in production, so FTBK currently RENDERS through the built-in template. The template path stays until FTBK has a real URL. Do not retire `artist-site.tsx`, `artist-template.tsx`, `templates/`, `MANIFESTS`, `edit-frame` or `preview` before then. |
| **B** | Ownership: RLS-only, or explicit checks? | **Explicit checks.** `requireOwnedArtist` goes into `_owns.ts` and every write that currently scopes by id alone gets it. In flight. |
| **C** | Does skeen adopt `fetchPublicSite`? | Not yet asked. Still open. |
| **D** | Are `/welcome` and `/apply` reached from outside the repo? | **Keep them.** Not built out yet; they will become full pages reached from the new landing page. Not dead code — unfinished code. |
| **E** | What is the seed artists' lifetime? | **`lone-pine` and `gulf-static` are pure test fixtures.** Sam does not need them as demo artists; only Skeen and FTBK matter. They CANNOT be deleted — `SEED.artistASlug`/`artistBSlug` in `tests/helpers/supabase.ts:32` are those slugs and 85 test files sign in against them. Their content no longer needs preserving, but the teardowns are still being narrowed, because a broad teardown makes the suite's own denials vacuous. |

### Wave 2 — fixes in flight (launched 2026-09-18)

Six agents, non-overlapping territories, one owner per file:

| Agent | Territory | Doing |
| --- | --- | --- |
| tests + harness (opus) | `tests/**`, `stryker.config.json`, `mutation.yml`, `audit-grants.ts` | Tier 0 teardowns (86 sites), the nine tests that cannot fail, the whole mutation slice incl. the bridge relative-import conversion |
| content + sync (opus) | `content.ts`, `song-merge.ts`, `sections.ts`, `artist-tabs.tsx`, `tracks.ts` | merch order parity, the dead `links` segment, `DIFF_SECTIONS` completeness, the `listContent` cap guard, `parent_release_id`, deleting `tracks.ts` |
| editor (sonnet) | `editor/**`, `site-editor/**`, `edit/**` | the `closeEditors` bug + a derived dismissal test, `styleOnly`, `isTextRegion`, the orphan route, the duplicated block, dead shims |
| site-bridge (opus) | `packages/site-bridge/**` | `auditRegions`' unanchored regex, `CLAIMABLE` derivation, `mergeManifests` exhaustiveness, protocol guards, CHANGELOG, docs |
| dashboard actions (sonnet) | `actions.ts`, `_owns.ts`, brand, settings | decision B, the unscoped `deleteMediaAction` + its missing test, 4 deletions, publish/media consolidations, the row grammar |
| helpers + docs (sonnet) | small `src/lib` helpers, root `*.md`, new migration | 8 small consolidations, the roster N+1 migration, archiving 7 finished docs |

#### Conductor notes carried across silos

CROSS-SILO: finding 1 of silos 6+7 is the one that matters beyond its size. AGENTS.md says a module
missing from `mutate` "is never looked at, which is the one way this whole apparatus can
quietly stop working" — and the meta-test that guards the config only checks test-file
placement, never that every module reached by a DB-free test is on the list. That is a gap in
the guard itself, and silo 10 is looking at the same config from the other side. HOLD both
until silo 10 reports, then fix once.
