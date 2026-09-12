# Review — analytics steps 1 + 2 (2026-09-11)

Three lenses (SQL correctness/security, test quality, organisation) over the three
migrations `20260911170000/171000/172000`, `tests/integration/analytics/context.test.ts`,
and `ANALYTICS_PAGE_PLAN.md`. Findings below were re-verified by hand against the live
project where possible (grants via `pg_proc`, plans via `explain`, the ledger, migration
grep counts). Status column: OPEN until fixed.

## Verified correct

- Timezone maths: `p_day::timestamp at time zone 'UTC'` is UTC midnight; half-open day
  windows line up with `between` on tallies; no double count in normal operation because
  tallies + ledger row are written in one call and the raw half excludes ledger days.
- RLS: manager B gets zero rows from every tally and from raw; `geo_cache` and
  `event_attempts` have RLS on, no policy, no authenticated grant; anon has no `usage`
  on schema `analytics` and, after `171000`, no EXECUTE on any analytics function.
- Final grants (live): `record_event_v2`, `roll_up_analytics`, `roll_up_pending`,
  `prune_analytics` = service_role only; ten readers = authenticated + service_role.
- The timeline reader's raw branch uses `analytics_events_live_idx` (explain confirmed);
  prune uses an index on `created_at` + the ledger PK.
- Re-runnable: `if not exists`, `drop … if exists`, identical signatures on the
  `create or replace` readers.
- Suite placement, `expectExecuteDenied` usage, witnesses before denials, cascade
  teardown via a throwaway artist.

## Findings

| # | Sev | Where | Finding | Fix | Status |
|---|-----|-------|---------|-----|--------|
| S1 | HIGH | `roll_up_analytics` + `prune_analytics` | Re-rolling a day whose raw rows were pruned rebuilds its tallies from nothing → that day's numbers vanish for every artist. One service call away; the plan invites it ("buckets can be recomputed"). | `rolled_days.pruned_at`; prune stamps it; roll-up returns early for a pruned day; prune never touches the last 3 days (`p_keep := greatest(p_keep, '3 days')`). Test: plant, roll, prune, re-roll, tallies survive. | FIXED |
| T1 | HIGH | test `refuses to roll up today` | Vacuous. With the guard deleted, today is rolled (incl. the `ctx` view) and `some(visitors ≥ 1)` is still true from the frozen tally. Worse: it would freeze today for every real artist. | Read timeline(today) before, plant, read after, assert `+1` views and visitors. | FIXED |
| T2 | HIGH | isolation test | Negative only: no manager of the throwaway artist exists, so `using (false)` on every tally policy stays green. | Insert manager A into `artist_managers` for the throwaway artist; assert exact rows as A; manager B as the outsider across all six readers. | FIXED |
| T3 | HIGH | `record_event_v2` caps | The split caps (120 real / 60 bot per minute) have no test. Merge them or delete them: green. Exactly the "cap vanished for a day" shape AGENTS.md names. | Batch-insert 119 real rows, v2 real inserts (120th), next real drops, v2 bot still inserts; fill bots to 60, next bot drops. Assert by unique target. | FIXED |
| T4 | HIGH | `roll_up_pending` | Zero tests, including the re-roll rule that exists because this suite found the bug. | Plant yesterday; `roll_up_analytics(yesterday)`; plant late row; timeline still 1 (frozen); `roll_up_pending(1)`; timeline 2. | FIXED |
| T5 | HIGH | fixture random day | Pool is 324 days; each run leaves its day in the ledger forever; P(flake) ≈ 2N/324 → ~10% by run 16, 50% by run 80. The header says a flaky test gets ignored. | Widen to 2000–2024 (~9,100 days) AND probe: plant on the candidate, read timeline as service, `[]` ⇒ already rolled ⇒ pick again. Do both days. | FIXED |
| T6 | HIGH | five dimension readers | Their raw `union all` branch is never executed: they are only read after roll-up. Drop `not is_bot` or the UTM filter from a raw branch: green. | Call all six readers BEFORE roll-up with the same expected arrays. | FIXED |
| S2 | MED | `roll_up_analytics` concurrency | Cron + opportunistic runs both touch the last two days; the loser's insert hits the tally PK (23505) and its whole `roll_up_pending` rolls back. | `pg_advisory_xact_lock` keyed on the day at the top. | FIXED |
| S3 | MED | `rolled_days` policy is load-bearing | Both halves of every reader depend on the caller seeing the ledger. Tighten that policy in a later sweep and managers double-count rolled days inside the raw window; service callers never notice. | FK `day → rolled_days(day) on delete cascade` on every tally, ledger upsert first; filter the tally half with `exists` too; T2's positive manager test pins it. | FIXED |
| S4 | MED | old readers raw-only | `analytics_summary/_daily/_by_entity/_entity_daily` read raw only; `daily_entity` is written and never read. Fine until prune runs on real days (step 4), then any window > 90 days undercounts. | Hard prerequisite in step 4: migrate those readers (or gate prune) BEFORE scheduling. Plan updated. | FIXED 2026-09-12 (`20260912120000` + reader-parity.test.ts) |
| S5 | LOW | prune comment | Says bot rows "were counted (as bots) at roll-up". They are not counted anywhere; after prune they vanish without trace, against decision 6 (auditable). | `bots integer` on `daily_total`, counted at roll-up; fix comment; timeline returns it. | FIXED |
| S6 | LOW | readers | `not in (subquery)` → `not exists`. Correct today (PK, NOT NULL); `not exists` has no NULL cliff. | Recreate the six readers. | FIXED |
| S7 | LOW | batch scans | Roll-up = 7 scans per day with no `created_at`-leading index. Fine at 3k rows. | Revisit at ~100k rows: `(created_at)` index or single-pass CTE. | NOTED (revisit ~100k rows) |
| T7 | MED | straddling window | The headline claim (rolled day + raw day in one window, exact) is never read. | `timeline(ROLLED_DAY, KEPT_DAY)` = two rows. Also pins `order by`. | FIXED |
| T8 | MED | prune keep window | All rolled rows are 2025, so deleting `created_at < now() - p_keep` changes nothing. | Prune with `'10 years'` first → rows survive; then the real window → gone. | FIXED |
| T9 | MED | v2 early returns | Unknown type / slug / entity kind untested; delete the type guard and the door 500s on the CHECK. | Three v2 calls with unique targets; assert 0 rows and `error` null; entity kind off-list stored as null. | FIXED |
| T10 | MED | grant tests hand-list | Anon on five readers, anon on roll-up/prune, manager on `roll_up_pending` unasserted. AGENTS rule 4. | `READERS` / `SERVICE_ONLY` arrays; loop. | FIXED |
| T11 | MED | test wording | "tallies still answer" asserted for timeline only; `analytics_by_entity` loses the pruned click. | Comment stating entity tallies are written, not yet read (honest). | FIXED |
| T12 | MED | clocks / ordering | `since` from the client clock; test 4 depends on tests 2–3; 6–9 on 5. | Use the DB `created_at` of the first plant; state the sequencing in the describe. | FIXED |
| T13 | LOW | unpinned details | Truncation lengths, NULL-hash visitors count 0, `p_is_bot: null`. | One 300-char v2 call; one null-visitor view in the fixture (views 4, visitors 2). | FIXED |
| T14 | LOW | cannot pin yet | `event_attempts` / `geo_cache` expiry unreachable until the door exists. | Say so in a comment. | FIXED |
| O1 | HIGH | AGENTS.md | The grants gotcha has bitten twice (submit_enquiry 2026-08-04, analytics 2026-09-11) and lives only in migration comments. 31 migrations use the weak `from public` form, 17 the full form. Live: anon can still execute `reorder_rows` and `set_release_link` (RLS-protected, but the grant is wrong). | Short AGENTS.md section: revoke `from public, anon, authenticated`, always. Plus an `npm run audit:grants` that lists anon-executable functions and diffs against the allowlist of intended doors. | FIXED |
| O2 | HIGH | plan vs code | Plan line says tests use `.schema('analytics')`; config.toml does not expose it and the test does the opposite. A future author would widen `db.schemas`. | Fix the sentence. | FIXED |
| O3 | MED | ADR | Decisions 6, 11, 12, 13 (bots flagged, tally + 90-day raw, schema per subject not per artist, readers in public) are ADR-weight with a rejected alternative. Migration comments already cite "decision 12" as if it were an ADR. | ADR 0012 (after renumbering the duplicate 0010 presence ADR to 0011 and indexing it). | FIXED |
| O4 | MED | glossary + audit doc | CONTEXT.md analytics glossary lacks visitor / bot / tally / rolled day / raw window / v2; steaksauce.md is 25 migrations behind. | Add glossary bullets; run `/steaksauce` before step 3. | FIXED |
| O5 | MED | naming | `record_event_v2` is the repo's first `_v2`; step 5 leaves a dead `record_event` beside it forever. | Decide in step 5: rename to a role name before the door deploys, or drop `record_event` and keep the suffix knowingly. | FIXED |
| O6 | MED | allowlists ×4 | Event types and entity kinds live in `record_event`, `record_event_v2`, the CHECK, and `src/lib/events.ts`; the plan claims a diff test that does not exist. | Integration test iterating `EVENT_TYPES` / `ENTITY_KINDS` through v2 (+ one off-list). | FIXED |
| O7 | LOW | polish | Header says "Three things", body has four sections; the "grants persist" sentence in 170000 is the one 171000 disproves; `visitor` → `visitor_hash` (matches `ip_hash`); test file → `analytics-context.test.ts`; literals `'play'`/`'track'` → registry; plan step 2 is a progress log (move lessons to a Status section); data-model section is pre-build (two caps, `daily_total`, `roll_up_pending` missing); step 6 must list ALL raw-only readers, not just the entity ones. | As listed. | FIXED |

## Resolution (same day)

Migration `20260911180000_analytics_review_fixes.sql`; suite rewritten as
`tests/integration/analytics/analytics-context.test.ts` (17 tests; mutants A pruned-day guard,
B re-roll rule, C burst caps each went red live and green on restore); AGENTS.md grants
section + `npm run audit:grants`; ADR 0012 (presence ADR renumbered 0011, index fixed);
CONTEXT.md glossary; plan corrected. `tests/integration/auth/reorder-rows.isolation.test.ts`
re-pinned from "anon can call it but changes nothing" to "anon is refused" (the migration
closed that grant). Full suite green (4,987). `/steaksauce` refresh deferred to before step 3.

## Verdict (at review time)

The design and the security posture hold: isolation, grants (after the fix), index use,
timezone maths and idempotence all check out live. What does not hold yet is the
evidence. Of the new rules this step introduced, three have no test (caps, re-roll,
five raw branches), one test cannot fail, and the fixture guarantees a rising flake
rate. And one real data-loss path exists (S1). Step 2 is not done until S1–S3 and
T1–T6 are closed; the rest is a morning of polish and doc hygiene.

---

# Step 3 — the `event` door (reviewed 2026-09-11, evening)

Same three lenses over `supabase/functions/event/{index,derive}.ts`,
`20260911190000_event_door_rpcs.sql`, the two suites, and the config. Plus two live probes
against the deployed door: header spoofing (a client-set `cf-connecting-ip` is refused by
the gateway with 403; spoofed `x-forwarded-for` / `x-real-ip` leave the visitor hash
unchanged) and the per-IP cap (70 rapid POSTs → 57 × 204, 13 × 429).

## Verified sound (live or by reading)

- `bump_event_attempt` is one row-locked statement returning the post-update count; two
  concurrent requests get 59 and 60. Grants exactly service_role; `search_path` pinned.
- `record_site_event` normalises every column, so no client value reaches a CHECK and 500s;
  `artist_id` always comes from the slug.
- CORS on every path incl. 429/500, `Vary: Origin`, no credentials, preflight before auth.
- The IP the door trusts cannot be chosen by the client while the gateway is Cloudflare.
- `bucketForHost` walks whole labels (`notinstagram.com`, `instagram.com.evil` → other).
- Nothing raw is stored or logged: no IP, no full UA, no full referrer, no cookies.

## Findings

| # | Sev | Where | Finding | Fix | Status |
|---|-----|-------|---------|-----|--------|
| D1 | HIGH | door | Cap + ipinfo budget keyed on the full IP: an IPv6 /64 pool gives a fresh counter per request — cap never trips, one ipinfo call per request, ledger and cache grow a row each. 50k/month quota gone in minutes; location blank for every artist until month end. Prune not yet scheduled. | Normalise IPv6 to /64 before hashing; global lookup budget through the same ledger (`ipinfo:<hour>`, 500/h); validate IP syntax; negative-cache failed lookups. | FIXED |
| D2 | MED | door | Missing `ANALYTICS_SALT` runs unsalted (`?? ''`): `geo_cache.ip_hash` becomes a 2^32 brute-force away from an IP → city table. Contact has the same gap. | Refuse to start if the salt is shorter than 32 chars. Contact: same, on its next deploy. | FIXED |
| D3 | MED | door | `x-forwarded-for` fallback is client-controlled (Cloudflare appends; `[0]` is the client's). Dormant while `cf-connecting-ip` is present; if it ever isn't, the attacker picks the hash (cap bypass) and the looked-up IP (geo poisoning). Contact's comment states the trust direction backwards. | No `cf-connecting-ip` → `'unknown'` (one strict shared bucket, no lookup). Note on contact. | FIXED |
| D4 | MED | door | Any origin can post for any slug. Inflation is design-accepted; the CROWD-OUT is not: one attacker holding an artist's 120/min full drops every real fan event silently. | For browser traffic require the page host (from `url`) to match the `Origin` host; key the per-IP ledger per (slug, ip) so one source can't starve an artist; a per-visitor click dedupe in the readers later. | FIXED (host check); per-visitor dedupe = step 6 |
| D5 | MED | door | No body size limit before `req.json()`; no negative cache, so while ipinfo is rate-limiting every uncached IP waits 2.5 s on a doomed call. | 413 above 8 KB by `content-length`; cache nulls on failure. | FIXED |
| D6 | LOW | derive | `isBot` matches `bot` unanchored → Cubot phones are bots forever. `Edg/` misses `EdgA/` / `EdgiOS/`. | Bound the token; add the Edge variants. | FIXED |
| D7 | LOW | door | ipinfo token in the URL query string; `allowed === false` fails open on null; no `Retry-After` on 429; `console.error` may echo PostgREST `details` (a failing row incl. `visitor_hash`, city). | Bearer header; `!== true`; `Retry-After: 60`; truncate error text. | FIXED |
| D8 | LOW | derive | `isLookupable` misses `100.64/10`, `::ffff:` mapped, `::`; `referrerHost` treats a public-suffix referrer as same-site; trailing-dot hosts fall to `other`. | Extend; strip the trailing dot in `hostOf`; note the suffix case. | FIXED |
| D9 | LOW | policy | A static salt lets the OPERATOR link visitor hashes across days; unlinkability holds against outsiders only. The lookup runs before the slug is resolved, so unknown-slug floods still spend quota (bounded by D1's budget). | Document both in the runbook. | DOCUMENTED (docs/event-endpoint.md) |
| T1 | HIGH | e2e | The door's 429 branch has never fired end to end; only the RPC is tested. `allowed === true`, a dropped `if`, or a dropped `p_limit` all survive. | Last test in the file: 61 POSTs, assert a 429 with body + CORS; header documents the spent budget. | FIXED |
| T2 | HIGH | unit | The known-answer hash cannot detect the `padStart(2,'')` mutant: no byte in the first 16 of `sha256("salt:1.2.3.4")` is < 0x10. The survivor is still alive. | Inputs with a leading-zero nibble: `ipHash('salt','8.8.8.8')`, `visitorHash('pepper','2026-09-11','1.2.3.4','UA')`, asserted exactly. | FIXED |
| T3 | HIGH | e2e | The most common event — a `view` with no entity — never goes through the deployed door; `body.entity?.label` regressing to `body.entity.label` (500 on every page view) survives. | One entity-less POST; find by artist + path; assert the three nulls. | FIXED |
| T4 | MED | e2e | `source: 'instagram'` is satisfied by UTM AND referrer at once; `entity_id` never asserted; visitor hash asserted by shape only; CORS on 400/401 unasserted; 401 body unasserted (a gateway 401 would pass). | Make UTM and referrer disagree; assert `entity_id`; two same-UA POSTs share a hash, a third UA differs; assert CORS + bodies on errors; add 405 + `Vary`. | FIXED |
| T5 | MED | unit | In-app-before-family order in `parseUa` is unpinned (every in-app fixture lacks `Chrome/`); `BOT_UA` names hand-listed in the test (rule 4). | Android IG UA carrying `Chrome/`; export the bot name list and build the regex from it. | FIXED |
| T6 | MED | e2e | The geo path (cache hit / miss / ipinfo fail / catch / bots skip) is dead with `IPINFO_TOKEN` unset and lives in untestable `index.ts`; the header claims index.ts is exercised. | Move `locate` into `derive.ts` as `locateWith(deps)` and unit-test the branches with stubs; header lists what remains unpinned. | FIXED |
| T7 | LOW | unit | `pagePath('foo://host')` kills the `|| '/'` mutant; a test name lies ("robots.txt"); hand-listed hosts at one `it`; mid-file import; describe names narrate the session. | As listed. | FIXED |
| O1 | HIGH | shared | `pickOrigin` exists twice under one name with OPPOSITE defaults (contact: empty allowlist → deny; event: → reflect). | `_shared/cors.ts` gets contact's `pickAllowedOrigin` + `parseAllowedOrigins`; the door's variant gets a distinct name with its one-line why. Contact behaviour unchanged (validate.ts re-exports). | FIXED |
| O2 | MED | shared | `hashIp`/`ipHash` identical; `clientIp` vs `firstForwardedIp` NOT identical. | `_shared/hash.ts` (`sha256Hex`, `hashIp`); `_shared/request.ts` (`clientIp`, strict per D3). Contact keeps `firstForwardedIp` with a note — moving it is a deliberate change + redeploy, not a refactor. | FIXED |
| O3 | MED | plan | The plan makes `derive.ts` the page's source of labels; `src/` importing from `supabase/functions/**` inverts app → lib. | `src/lib/analytics-sources.ts` is canonical (`SOURCES` + labels); `derive.ts` pins a copy; the unit test diffs, like the allowlists. | FIXED |
| O4 | MED | scripts | `fn:deploy` / `fn:serve` deploy/serve one of two doors; ADR 0010 and the runbook say "`npm run fn:deploy`". | Bare `supabase functions deploy` / `serve` (all doors) + per-door scripts. | FIXED |
| O5 | MED | docs | Plan drift (24 h vs 2 days, `firstForwardedIp`, a "referer cross-check" never built, `record_event_v2` in step 5, `src/lib/sources.ts`, IPINFO open item, step 3 progress duplicated in Status); CONTEXT.md "the ONE public entry" now false, "step-3 cut-over" is step 5; `.env.example` header says contact only; `index.ts` contract omits 405/500. | Fix each. | FIXED |
| O6 | MED | docs | No runbook, unlike `docs/contact-endpoint.md`. | `docs/event-endpoint.md`: secrets and their current state, deploy order, curl checklist, abuse controls, never-stored list, the operator-linkability note (D9), cleanup. | FIXED |
| O7 | LOW | polish | `geo_cache_get/put` are the only noun-first RPCs; tsconfig/eslint list entrypoints one by one; Stryker comment lost a literal dash and lacks the "joined" line; `src/lib/events.ts` header should name both copies and both guards; ratchet `break` only after a real full sweep. | Rename via `alter function … rename to`; globs; comments. | FIXED |

## Stryker survivors on derive.ts, classified (26 at the 93% run)

Killed since the run: `indexOf("")` (whole-label test), `v.trim()` → `v` (whitespace geo).
Real, still alive: `padStart(2,'')` (T2), `pagePath || ""` (T7).
Equivalent: `str` length checks (empty string is falsy downstream), `typeof raw !== 'object'`
(a primitive's `.slug` is undefined), the entity guard variants (null excluded earlier),
`> 200` vs `>= 200` (slice is identity at 200), `hostOf`/`bucketForHost` null guards
(`new URL('')` throws; `while ('')` never enters), `dot <= 0` (hostname cannot start with
`.`), `[0]?.trim()` (split never returns `[]`), `typeof r.country` (regex coerces).

## Resolution (same evening)

`derive.ts` rewritten: IPv6 → /64 keys via `_shared/request.ts` (`clientIp` trusts only
`cf-connecting-ip`, `normalizeIp`), `_shared/hash.ts` (one SHA-256), `_shared/cors.ts`
(`parseAllowedOrigins`, `pickAllowedOrigin`; contact re-exports, behaviour unchanged);
`reflectOrAllowlisted` is the door's distinctly named origin rule; `pageMatchesOrigin`
(403); `BOT_UA_NAMES` builds the regex (`bot` bounded); `Edg/EdgA/EdgiOS`; `hostOf` strips
a trailing dot; `isLookupable` covers CGNAT / mapped / zero; `locateWith(deps)` with cache
→ hourly budget (500) → lookup → negative cache, unit-tested branch by branch. `index.ts`:
salt guard at load, 413 above 8 KB, per-(site, IP) ledger key, `!== true`, `Retry-After`,
ipinfo token in a header, truncated error text, 405/500 in the contract. RPCs renamed
`lookup_geo_cache` / `cache_geo` (`20260911200000`). `src/lib/analytics-sources.ts` is the
canonical source list; derive pins + diffs. `fn:deploy` deploys every door.
`docs/event-endpoint.md` written; plan, CONTEXT.md, `.env.example`, `events.ts` header,
tsconfig/eslint globs, Stryker comment fixed. Suites rewritten: unit 42 (tables entry by
entry, bot names iterated, known-answer hashes with leading-zero nibbles, in-app-before-
family, /64 keys, every geo branch), e2e 14 (the 429 end to end on its own slug, the
entity-less view, UTM vs referrer disagreeing, `entity_id`, hash stability, CORS + bodies
on 401/400/403/405/413, preflight, helper RPCs). Live: door redeployed, grants audit clean.

## Verdict (at review time)

The door is safe to leave running: the IP cannot be chosen by the client, the caps hold,
grants are right, nothing raw is stored. What is not yet right is resilience against a
patient attacker with an IPv6 pool (D1), the silent unsalted mode (D2), and evidence: the
door's own rate limit, the entity-less page view, and the geo path have never been
exercised by a test. Fix D1–D5, T1–T6, O1–O4 before calling step 3 done; the rest is a
morning of hygiene like last time.
