# Analytics page — plan

Grilled + decided 2026-09-11. Goal: the artist's Analytics tab answers "where do my
fans come from, where are they, and what do they click" from ONE database, for every
site, wherever that site is hosted. PostHog runs beside it as a cross-check only and is
removed once the numbers agree.

Builds on ANALYTICS_STATS_PLAN.md (per-item stats, DONE 2026-07) and ADR 0010 (an
Edge Function may be a public door when Postgres provably cannot be).

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where the data lives | **Lone Star's Supabase.** Third-party dashboards (Vercel Analytics) cannot be read by API, so they can never feed this page. |
| 2 | The door | **A Supabase Edge Function, `POST /functions/v1/event`.** Only the edge sees the visitor's IP, referrer and browser. Postgres cannot, which is ADR 0010's test. |
| 3 | The old door | **Cut over, then close.** Skeen + the template site move to the edge door; then `record_event`'s anon grant is revoked. One door. |
| 4 | Visitor id | **Daily rotating hash** `sha256(salt + date + ip + user-agent)`. Nothing stored on the device, no banner. The Plausible / Vercel / Cloudflare standard. Returning visitors across days are NOT tracked, by design. |
| 5 | Location | **Country + region + city.** City from IP is approximate. Enough for tour routing. |
| 6 | Bots | **Stored, flagged** (`is_bot`), counted as bots on `daily_total.bots`, excluded from every traffic number. Auditable, tunable, comparable with PostHog. |
| 7 | Sources | **Music-first bucket list** (below) computed at ingest, PLUS the raw referrer host, so buckets can be recomputed. `utm_source` overrides the referrer. |
| 8 | PostHog | **Cross-check only.** One project for all sites, loaded by a bridge component in memory-only (cookieless) mode, tagged with the slug. No API pulls, no page code. Removed when the comparison passes. |
| 9 | Click helper | **One bridge `track()` sends to the door and mirrors to PostHog** with the same entity ids. Fixes Skeen's missing play / video / social clicks in the same change. |
| 10 | Page v1 | **Four blocks, per artist:** timeline (views + visitors, release/show markers), sources, places, top content. Window picker 7 / 30 / 90 days. Roster page unchanged for now. |
| 11 | Retention | **Tally daily, keep raw 90 days.** Nightly roll-up into small tally tables; the page reads tallies; raw rows older than 90 days are deleted. |
| 12 | Organisation | **One table per kind, `artist_id` on every row, RLS isolates (ADR 0001) — NOT a schema or database per artist.** The NEW analytics tables live in their own `analytics` schema, NOT exposed through PostgREST (defence in depth; it also groups them in the dashboard); RPCs stay in `public`. **ADR 0012.** |
| 13 | Speed | **The page never reads old raw rows.** Tallies for anything beyond the raw window, a partial index `(artist_id, created_at) where not is_bot` for the window, distinct-visitor counts computed nightly. Partitioning by month + a 60s Next cache are the next tools, not needed at v1. |

Current scale (2026-09-11): 2,740 raw rows since 1 July, 1,255 in the last 30 days.
A year of enriched rows for one artist is ~15k rows. Retention is a design choice, not
a storage emergency.

## Source buckets (v1)

`instagram · tiktok · youtube · facebook · x · spotify · apple_music · soundcloud ·
bandcamp · google · bing · ai · linktree · bandsintown · songkick · email · direct · other`

`ai` = chatgpt.com, chat.openai.com, perplexity.ai, gemini.google.com, copilot.microsoft.com,
claude.ai, you.com. This bucket is the one direct GEO signal that costs nothing.

Rules: `utm_source` present → bucket by it (lower-cased, mapped; unknown → `other`).
Else referrer host → bucket by suffix table. Empty referrer → `direct`. Host stored
raw either way. The table lives in ONE place: `supabase/functions/event/derive.ts`
(`SOURCES`, `bucketForHost`, `sourceFor`) — the function directory cannot import from
`src/`, but `src/` and the tests CAN import from it (tsconfig includes it, as it does
`contact/validate.ts`), so the page's labels come from the same list. The event-type and
entity-kind allowlists are pinned copies of `src/lib/events.ts` and the unit test diffs them.

## Data model

**A. `analytics_events`** (migration) — add nullable columns:

| column | what |
|---|---|
| `path` text | page path (`/`, `/about`, `/r/<slug>`), query stripped |
| `referrer_host` text | raw host, no scheme, no `www.` |
| `source` text | bucket, from the list above |
| `utm_source` / `utm_medium` / `utm_campaign` text | as given, 100 chars max |
| `country` char(2), `region` text, `city` text | from IP, best effort |
| `device` text | `mobile` · `tablet` · `desktop` |
| `browser` text | family only (`safari`, `chrome`, `instagram` for the in-app browser …) |
| `visitor_hash` text | daily hash, 64 chars max |
| `is_bot` boolean not null default false | |

Index `(artist_id, created_at) where not is_bot` for the window queries.
`entity_type` / `entity_id` / `target` unchanged.

**B. `record_site_event(...)`** — `security invoker`, granted to `service_role` ONLY (the
ADR 0010 inverse). Takes every column above. Separate per-artist burst caps for real and
bot traffic. The edge function is its only caller. `record_event` (anon) stays until
step 5, then is DROPPED (not merely revoked): one door, one name.

**Schema.** Everything new below (A's new columns aside) lives in `create schema analytics`: `analytics.daily_total`, `analytics.daily_source`, `analytics.geo_cache`, `analytics.event_attempts`, … Grant `usage` to `authenticated` + `service_role`; RLS on every table; the read RPCs stay in `public` so PostgREST exposure does not change (`db.schemas` in config.toml is NOT widened, so NOTHING — tests included — can address the schema directly; tally state is asserted through the readers, where it is used). `analytics_events` itself stays in `public` — moving a live table buys nothing.

> **As built (2026-09-11).** The sections below are the pre-build sketch. The migrations are the record; where they differ: two burst caps (120 real / 60 bot per artist per minute), `daily_total(views, visitors, bots)`, `visitor_hash` not `visitor`, `record_site_event` not `record_event_v2`, `roll_up_pending` (re-rolls the last two days), `rolled_days.pruned_at` (a pruned day is never re-rolled), prune in whole UTC days with a 3-day floor, FK from every tally to the ledger, advisory lock per roll-up.

**C. Tally tables** — one row per (artist, day, dimension value), `views int`,
`visitors int` (count distinct visitor on that day), `security invoker`, owner-read RLS
like `analytics_events`:

- `analytics.daily_type (artist_id, day, type, count)` — every non-bot event, entity or
  not; the only tally `analytics_summary` can be rebuilt from (`20260912120000`)
- `analytics.daily_source (artist_id, day, source, referrer_host, views, visitors)`
- `analytics.daily_place (artist_id, day, country, region, city, views, visitors)`
- `analytics.daily_device (artist_id, day, device, browser, views, visitors)`
- `analytics.daily_path (artist_id, day, path, views, visitors)`
- `analytics.daily_campaign (artist_id, day, utm_source, utm_medium, utm_campaign, views, visitors)`
- `analytics.daily_entity (artist_id, day, entity_type, entity_id, type, count)` — so
  per-song / per-date history survives the 90-day raw window. `analytics_entity_daily`
  and `analytics_by_entity` read tallies for days older than the raw window.

**D. `roll_up_analytics(p_day date)`** — idempotent (`delete` the day, re-insert from
raw, bots excluded). **E. `prune_analytics(p_keep interval)`** deletes raw older than
90 days ONLY for days already rolled up.

**Schedule:** `pg_cron` is not enabled on the project. Step 4 tries
`create extension pg_cron` (Pro supports it) and schedules both at 03:10 UTC. If the
project refuses, the door runs them opportunistically, ~1 request in 200, the way the
contact door prunes attachments. Either way the roll-up is idempotent, so a double run
is harmless.

**F. Read RPCs** for the page, all `security invoker`, `(p_artist_id, p_since, p_until)`:
`analytics_timeline` (views + visitors per day, raw for recent days, tallies beyond),
`analytics_sources`, `analytics_places`, `analytics_devices`, `analytics_paths`,
`analytics_campaigns`. Each unions raw (last 90 days) with tallies (older), so a window
that straddles the boundary is exact.

## The door: `supabase/functions/event`

Thin, like `contact`, and sharing its helpers: `_shared/cors.ts` (CORS, origin rules),
`_shared/hash.ts` (the one SHA-256), `_shared/request.ts` (`clientIp` — the gateway's
`cf-connecting-ip` only — and `normalizeIp`, IPv6 → /64). Salted hashing with
`ANALYTICS_SALT` (refuses to start below 32 chars), service key to service-only RPCs,
`verify_jwt = false` with the same config.toml note. Runbook: docs/event-endpoint.md.

Request: `POST { slug, type, url, referrer, entity?: {kind, id, label} }` — `url` is
`location.href`; path, UTM and the site's own host (for same-site → direct) are derived
from it, never trusted separately.
Response: `204` always on the happy path (and for the edit shell, an unknown slug, or a
per-artist cap — the browser has no use for the difference); `429` on the per-IP cap;
`400` on bad shape; `401` without the anon key.

Per event it derives, server-side, never trusting the client for any of it:

1. `ip` (normalised; IPv6 → /64) → per-(site, IP) cap (60 / minute, `bump_event_attempt`
   on the `analytics.event_attempts` ledger, one statement) → visitor hash.
2. `user-agent` → `is_bot` (a maintained list: known crawlers, headless, `HeadlessChrome`,
   empty UA) → `device` → `browser`.
3. `referrer` (the body field) → `referrer_host` (same-site → null) → `source`.
   `utm_source` wins. The page URL must live on the request's `Origin` host, or 403.
4. Location. **Probe result (2026-09-11, step 1 DONE):** the gateway is Cloudflare-fronted
   but supplies NO location header. Headers that arrive: `cf-connecting-ip` (the clean
   client IP — prefer it over the first `x-forwarded-for` hop), `x-forwarded-for`,
   `referer`, `user-agent`, `cf-ray`. So country, region and city ALL come from an IP
   lookup service, cached two days in `analytics.geo_cache(ip_hash, country, region, city,
   fetched_at)` behind a global budget of 500 lookups an hour: one outbound call per
   visitor per two days, and a flood of fresh addresses cannot spend the quota. Service:
   ipinfo (free tier 50k lookups / month incl. city; volume today ~1.3k events / month,
   far fewer distinct IPs). Needs `IPINFO_TOKEN` in the function env (Sam creates the
   account; unset today, rows carry no location). Location failure is cached as "no
   location" and never drops the event.
5. `record_site_event(...)`.

What it will NOT do: read cookies, set cookies, store the IP, store the full UA, store
the full referrer URL.

## The bridge: `@samfox1/site-bridge/analytics`

```ts
createAnalytics({ supabaseUrl, slug, posthogKey? })
  .pageview()                          // on mount, not on /edit
  .track(event, entity?, label?)       // ticket_click, play, video_click, buy_click, link_click
  .attrs(event, entity?)               // data-* for delegated listeners, same as trackAttrs today
```

- Fires the door; mirrors to PostHog (`posthog-js`, `persistence: 'memory'`,
  `capture_pageview: false`, `$set: { site: slug }`) while `posthogKey` is set.
- `/edit` and any path under it never report — the manager opening the editor is not a
  visit (the rule Skeen's `Analytics.tsx` already applies).
- Fire-and-forget; a failed report never blocks navigation.
- CONNECTING.md gains a rule: every site mounts `pageview()` once and uses `track()` /
  `attrs()` for every fan action; `checkContract` verifies the four click kinds appear
  on a site that declares tour / music / videos / merch.

The template site (`src/components/site-analytics.tsx`) uses the same module through
the workspace package, so template and custom sites are one code path.

## The page (artist Analytics tab, `(dashboard)/page.tsx`)

Design rules from memory apply: black/white, Inter + Space Mono, icons over words, no
instructional copy. `dataviz` skill before drawing anything.

1. **Timeline** — views and visitors per day (two lines, `AreaChart`), release dates
   and show dates as markers from `releases.release_date` / `tour_dates.date`.
2. **Sources** — bucket bars with counts; expand a bucket → its raw hosts; campaigns
   (UTM) as a second list. An `ai` row is the GEO signal.
3. **Places** — countries; expand → regions → cities.
4. **Top content** — the existing `entityCounts` / `ON_SITE_METRIC` reused: songs,
   dates, videos, merch, links by clicks in the window.

Window picker 7 / 30 / 90 in the toolbar; URL param `?days=`. Existing KPIs stay.

## PostHog cross-check

- One project, one key in each site's env (`NEXT_PUBLIC_POSTHOG_KEY`), bridge component
  in the layout. Cookieless, so both count visitors the same way.
- Run for 30 days after step 5. Compare per day: views, visitors, top 5 sources, top 5
  countries, and the four click kinds.
- **Exit criterion:** every compared number within 10% for the last 14 of those 30 days.
  Then delete the env var on each site (the component no-ops without a key) and the
  PostHog project. The larger, systematic gap that WILL show first is bots; tune the
  UA list until it closes.

## Sequencing

1. ✅ **Probe** (2026-09-11) — `supabase/functions/event` deployed as a header echo, called
   once, removed with `supabase functions delete event` (only `contact` is deployed). No
   location header; IP lookup + cache it is. `cf-connecting-ip` is the IP to trust.
2. ✅ **Schema** (2026-09-11) — `20260911170000/171000/172000/180000`; suite
   `tests/integration/analytics/analytics-context.test.ts` (17, mutation-checked live);
   reviewed in REVIEW_2026-09-11_ANALYTICS.md, all findings closed. Decisions in ADR 0012.
3. ✅ **Door** (2026-09-11) — `supabase/functions/event` deployed. `derive.ts` holds every
   decision (validation, path, referrer host with same-site → direct, UTM, source bucket,
   UA → device/browser, bot list, client IP, both hashes, ipinfo shaping) and is in the
   Stryker `mutate` slice; `index.ts` is plumbing. RPCs `bump_event_attempt` (one-statement
   per-IP cap, 60/min), `geo_cache_get/put` (`20260911190000`). Secrets: `ANALYTICS_SALT`
   set; `IPINFO_TOKEN` NOT yet (rows carry no location until Sam sets it; nothing else
   waits on it). Tests: `tests/unit/analytics/event-derive.test.ts` (43; Stryker 93% on derive.ts, the
   rest equivalent mutants), `tests/integration/analytics/event-door.test.ts` (8, hits the
   DEPLOYED function).
   Contract: `POST { slug, type, url, referrer, entity? }` → 204 / 400 / 401 / 429;
   `url` = `location.href`, everything else is derived at the door.
4. ✅ **Roll-up schedule** (2026-09-12). Two parts.
   - PREREQUISITE (`20260912120000`): all four older readers use tallies for rolled days and
     raw for the rest, in whole UTC days on both sides so an answer never moves when a day
     is rolled. It needed a NEW tally, `analytics.daily_type` (artist, day, type, count):
     `daily_total` holds views only and `daily_entity` needs an entity, so an entity-less
     `play` or `ticket_click` — 265 of them in the last 90 days — sat in no tally at all.
     Pinned by `tests/integration/analytics/reader-parity.test.ts` (raw → rolled → pruned,
     same answer; 3 live mutants killed).
   - THE SCHEDULE (`20260912130000`): `pg_cron` turned out to be available (1.6.4), so the
     opportunistic fallback was not needed. `analytics-roll-up` at 03:10 UTC runs
     `roll_up_pending()`; `analytics-prune` at 03:40 runs `prune_analytics()`. Both
     idempotent, so a missed night self-heals. The schedule rests on ONE assumption — cron
     runs as `postgres`, which holds BYPASSRLS, because both functions are `security
     invoker` and a runner that could not see `analytics_events` would write EMPTY tallies
     over good ones. `analytics_schedule()` (`20260912140000`, service-only) reports the
     jobs, the runner, whether it bypasses RLS, and the last run's status;
     `tests/integration/analytics/schedule.test.ts` asserts all of it (unscheduling a job
     and deactivating one both turned it red).
   - Verified on REAL data: backfilled 72 days and skeen's `analytics_summary`,
     `analytics_daily` and `analytics_by_entity` answers were byte-identical before and
     after. Nothing is deleted yet — the oldest real row is 73 days old, inside the window.
5. **Bridge + cut-over.** Built 2026-09-12, NOT yet live.
   - ✅ `@samfox1/site-bridge/analytics` published as **0.37.0** (CHANGELOG + CONNECTING §12).
     `createAnalytics` → `pageview()`, `track(type, { entity?, label? })`, `attrs()` +
     `listen()`. `keepalive` on every send, or a click on an outbound link is cancelled by
     the navigation it caused.
   - ✅ The door gained a top-level `label` — a gap in step 3, not a feature: a click with no
     row behind it (a social icon, a mailto, a checkout button) had nowhere to put its name.
   - ✅ Template site moved over; `trackAttrs` re-exports the bridge's, so the attributes a
     site writes and the listener that reads them cannot drift. Attribute names changed with
     the move (`data-target` → `data-label`, `data-entity-type` → `data-entity-kind`).
   - ✅ Skeen moved over and INSTRUMENTED (`901381c`, local): every merch card, add-to-cart,
     buy-on-store, the tour MAP's ticket links and the hero's social icons were silent;
     ticket clicks and song link-outs named only a city or a platform. All now carry the
     published row's UUID. `components/reporting.test.tsx` pins it (3 of 4 go red when
     reverted). Verified live against the deployed door from skeen's production origin: a
     play attributed to a real song id, source `instagram`, device and browser derived.
   - ✅ **Skeen pushed and live** (2026-09-12). Verified on the deployed site: a page view
     arrived carrying `source`, `device`, `browser`, `path` and a visitor hash, and a
     headless browser was correctly flagged as a bot. The lockfile bump forced a fresh
     install, so the build cache could not ship the old bridge.
   - ✅ **`record_event` dropped** (`20260912150000`). One ingest path now. Checked first:
     skeen is the only artist that has ever recorded an event and it is on the door; `ftbk`
     points at a localhost URL with zero events; nothing else calls it. The three suites that
     used it now drive `record_site_event` with the service key, which is what the door does —
     no rule dropped, including the one only `analytics-rate-limit.test.ts` pins (the cap is
     per ARTIST, so flooding one cannot silence another).
   **Judgement calls, so they are not re-litigated as bugs.** Skeen's music covers and
   tracklist rows stay unreported: they open a modal, and counting them would inflate
   "listens", which is plays + link-outs. The listen is the link-out, and it now carries the
   SONG's id — never the release's, since a release grouped from loose songs by cover art
   carries that cover's URL as its id, which is not a UUID. Socials send a label and no
   entity because `mapConfig` flattens links to label and href.

   **Known gap, needs a decision (not a wiring fix): skeen's video tiles.** A click inside a
   YouTube iframe belongs to the embedded document and never reaches the page — the same
   reason the edit-mode shield exists. Measuring it needs either a click-to-load facade (the
   template site's approach; changes how a video behaves) or the YouTube JS API
   (`enablejsapi=1` + a postMessage listener; no visual change, more code). Until then video
   is the one content type with no signal from skeen.

6. **Page.** ✅ FIRST PASS (2026-09-12). The artist's Analytics tab now reads the
   window RPCs from step 2.
   - ONE filter row (7 / 30 / 90, `?days=`) above everything it scopes — never a
     control per block.
   - Headline stays VIEWS, because views are the one figure that runs unbroken across
     the cut-over; visitors and bots-filtered join the stat row beside the click kinds.
   - Timeline: views as a filled track, visitors as a line over it, on ONE scale that
     starts at ZERO. Monochrome dashboard, so the series are told apart by FORM. A
     hover readout names one day at a time; an `sr-only` table carries every value, so
     nothing is reachable only by pointer.
   - Three ranked lists: where they came from, where they are, what they used. Same
     weight on every bar — shading by size would encode the length twice.
   - When the window reaches before 2026-09-12 the page SAYS so, rather than drawing
     one line across a boundary where the measure changed.
   - `tests/unit/analytics/traffic-window.test.ts` (11) + `tests/components/analytics/
     traffic-blocks.test.tsx` (13). Mutation-checked: dropping the zero-fill and
     min-normalising the scale both go red. The zero-scale test had to be REWRITTEN to
     bite — its first fixture contained a 0, which made a min-normalised scale draw
     identically, so it passed against the exact bug it named.
   - LEFT for the next pass: top content (songs / dates / videos / merch by clicks —
     it needs a title lookup per kind, which the section pages already do), release and
     show markers on the timeline, and the roster-wide view.

7. **PostHog** — env var on Skeen, 30-day comparison, exit or tune.
8. **Search Console** (already hooked on Skeen, `GOOGLE_SITE_VERIFICATION`) — a later
   phase pulls impressions / clicks / queries via its API into the same page.

## Tests that must bite (AGENTS.md rules)

- Denials need a witness: the closed anon door is asserted with a planted call and error
  code 42501, not `not.toBeNull()`.
- `record_event_v2` is service-only: a test calls it as anon and expects 42501 AFTER
  proving the function exists (a service call succeeds).
- Bot rows are planted and asserted ABSENT from every read RPC; delete the `is_bot`
  filter once, watch the suite go red, restore.
- The source list lives in `src/lib/analytics-sources.ts`; the edge copy is diffed against
  it. The host/UTM lookup TABLES are checked entry by entry against an independent
  expected table in the test (the map under test is never its own oracle).
- Roll-up idempotence: run twice, counts equal.
- Window straddling: plant rows on both sides of the raw/tally boundary, assert the
  timeline sums both.
- Mutation config: the pure derivation modules join `mutate`; the served-function and
  RPC tests live under `tests/integration/analytics/`.

## Open items

- ~~Which location headers the gateway supplies~~ — RESOLVED: none; IP lookup + cache (see door §4).
- Sam: create an ipinfo account and set `IPINFO_TOKEN` as a function secret before the page shows places (step 6).
- Whether `pg_cron` can be enabled on this project (step 4 decides schedule vs opportunistic).
- Roster-wide sources / places view — after v1 is proven with one artist.
- Engagement (time on page, scroll depth) — deliberately out of v1.

## Status / lessons

- 2026-09-12 (later): **step 6 first pass DONE** — the Analytics tab reads the window
  RPCs: filter row, two-series timeline, and three ranked lists. Top content next.
- 2026-09-12 (later): **step 5 DONE** — bridge 0.37.0 published, both sites moved, skeen live
  and reporting with full context, `record_event` dropped. Next: step 6, the page. Sam wants
  the old view history KEPT with the boundary marked, not wiped: rows before the cut-over
  have no source, no visitor and were never bot-filtered, and never can be (the user agent
  was never stored), so views may run continuously but visitors and sources start at the line.
- 2026-09-12: step 4 DONE — readers on tallies, and the roll-up + prune run nightly on
  pg_cron with a readout and tests. Next: step 5 (bridge `track()` + cut-over) or step 6
  (the page). Step 6 is now unblocked and is the one Sam asked for first.
- 2026-09-12: step 4's prerequisite done — the four older readers read tallies; windows are
  whole UTC days on both sides (a tally is day-granular, so anything else would move an
  answer at roll-up). Prune is now safe to schedule.
- 2026-09-11 (later): step 3 done and reviewed — door redeployed with the review fixes
  (/64 keys, per-(site, IP) cap, lookup budget, salt guard, Origin/page check, shared
  helpers, runbook); unit 42 + e2e 14; `npm run audit:grants` clean.
  Next: step 4 prerequisite (old readers onto tallies) or step 5 (bridge + cut-over).
- 2026-09-11: steps 1–2 done and reviewed. The six page readers were pulled forward from
  step 6 because `analytics.*` is unreachable from tests; they are also where tally state
  is asserted. Two lessons became rules: the grants form (AGENTS.md, `npm run audit:grants`)
  and "a day in the ledger is authoritative, so re-roll the last two and never a pruned one"
  (ADR 0012). Sam still owes `IPINFO_TOKEN`; run `/steaksauce` before step 3.
