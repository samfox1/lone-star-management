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
| S4 | MED | old readers raw-only | `analytics_summary/_daily/_by_entity/_entity_daily` read raw only; `daily_entity` is written and never read. Fine until prune runs on real days (step 4), then any window > 90 days undercounts. | Hard prerequisite in step 4: migrate those readers (or gate prune) BEFORE scheduling. Plan updated. | SEQUENCED (step 4 prerequisite, ADR 0012) |
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
