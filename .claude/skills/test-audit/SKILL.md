---
name: test-audit
version: 2.0.0
description: Adversarial review of test QUALITY and of the review itself — finds tests that pass for the wrong reason, guards placed where a bug was seen rather than where the value is used, harness stubs that erase a whole bug class, and breaks that only show in a consuming repo. Two modes — change audit (every fix/feature, before it is called done) and full audit (before a release, quarterly, after any large feature). Complements `npm run mutation`, which finds tests that cannot fail at all.
triggers:
  - test audit
  - review the tests
  - are our tests any good
  - test quality review
  - review checklist
  - pre-merge audit
---

# /test-audit — are these tests actually protecting anything?

## Why this exists

On 2026-08-04/05 a full-suite audit found the SAME defect in every subsystem: a test
that reads as protection but passes whether or not the guarded behaviour exists. Ten live
bugs sat behind green suites. `npm run mutation` now catches one class automatically
(tests that cannot fail); it cannot catch tests that don't exist, or tests that bite but
pin the WRONG rule.

On 2026-09-03/04 twelve more misses got through reviews that were RUN, with AGENTS.md
rules in force and ~4,600 tests green. They were not the 08-04 shape. They were: a guard
added where the bug was seen, not where the value is used; a fixture that made the test
pass for a different reason; a harness stub that removed the window the bug lives in; a
breaking change that only broke in a consuming repo; a docblock mistaken for evidence.
The index at the bottom maps each to the check that would have caught it. Sam's brief:
"I don't want to keep allowing bugs to get through the reviews."

This is the extension of AGENTS.md "Test discipline", not a restatement. Those six rules
still apply; nothing here repeats them.

## Two modes

**Change audit** — run by the agent that made the change, on its own diff, BEFORE it says
done. Checks 1–8 over `git diff origin/dev...HEAD` plus the working tree. Twenty to forty
minutes. Skipping it is how 2026-09-03 happened: every one of those twelve was in a
change-sized piece of work that a periodic audit would have reached weeks late.

**Full audit** — before a release, quarterly, after any large feature. Scope selection
below, one agent per subsystem, the rubric verbatim, then checks 1–8 on every file in
scope. Ends with a baseline tag.

Both produce the same report shape: per check, the EVIDENCE named in "passes when". A
check whose evidence is "I looked and it seemed fine" was not run.

## Scope selection (full audit)

```bash
git log --oneline -1 --grep="test-audit baseline" || echo "no previous audit"
git diff --stat main..HEAD -- tests/ src/ packages/ | tail -3
```

Ask for scope if the diff is large: a subsystem (music, publish, enquiries, editor,
bridge, seo, merch, isolation), or "everything we haven't audited". Dispatch ONE agent per
subsystem, in parallel, each owning a disjoint set of test files. Give every agent the
rubric and the checks verbatim.

## The rubric (full audit, per test file)

> 1. **TAUTOLOGICAL / WRONG-REASON** (the priority) — does it pass even if the guarded
>    behaviour is deleted? The assertion landing on a mock; input neutralised upstream;
>    a denial over an empty table; an early return satisfying a test aimed at a later
>    guard; `not.toBeNull()` accepting an error that means the opposite of the claim.
> 2. **WRONG RULE** — does the NAME match what it exercises? Trace the real path.
> 3. **IMPLEMENTATION-PINNED** — would a refactor with no behaviour change break it?
> 4. **REDUNDANT** — is this rule already owned by another file? Name the delete.
> 5. **MISSING KEYSTONE** — a rule a rewrite could drop with everything staying green.
>
> READ THE IMPLEMENTATION BEFORE JUDGING ANY TEST. Where cheap, PROVE it: delete the
> guard, re-run, confirm green, restore. Report file:line, classification, one-sentence
> evidence, fix (rewrite / delete / keep). Findings only. If a finding turns out to be
> wrong, say so with evidence — two findings in the 08-05 audit were wrong and closing
> them honestly was worth more than "fixing" them.

## The checks

Each is one question. For each: the miss it would have caught, how to run it, and what
counts as passing. Run all eight on a change audit; the cost is the point.

### 1. Where is this value USED — not where was the bug seen?

**Caught:** 2026-09-04, `autoFaqAnswer` (`packages/site-bridge/src/seo.ts`). The no-name
guard went on `n===5` because that is where the hole was noticed. Branches 1–4 still
interpolated an empty name. The function is exported; `tools/seo/[section]/page.tsx:60`
calls it directly for the ledger, and `sections/ai.tsx` seeds a textarea from it, so a
manager could SAVE `" is a House, Techno musician"` as a written answer — permanent,
outliving the missing name. Two reviews and a mutation check passed it (7b834d4,
c5a0383, 80ac5f5), because the mutation check mutated the guard that existed and nobody
asked what else calls the function.

**Run:** for every exported symbol the diff touches:
```bash
git diff -U0 origin/dev...HEAD -- src packages | grep -E '^\+.*export (async )?(function|const|class|type|interface)' 
grep -rn "<symbol>" src packages --include='*.ts' --include='*.tsx' | grep -v "<defining file>"
```
For each caller, answer two things in the report: is the guard BETWEEN this caller and
the hole (or only on one path in)? And does this caller's output reach anything permanent
— a DB write, a publish, JSON-LD, a sitemap, a textarea a manager can save from?

**Passes when:** the report has a table `caller → guard on its path? → permanent sink?`
with a row per caller. A guard that covers one branch of a multi-branch function is a
finding by construction: it goes at the top of the function or at the one boundary the
value crosses (`artistName()` is the shape). A caller with a permanent sink and no guard
on its path is STOP-AND-ESCALATE.

### 2. Does the test pass for the reason in its NAME?

**Caught:** 2026-09-03 (7b834d4). The first `autoFaqAnswer(5, nameless) === ''` test had
no `origin` in the fixture, so Q5 was empty because there was no origin, not because
there was no name. The mutant that removed the name guard survived. And
`tests/site-editor.test.ts:77` asserts region keys unique across built-in MANIFESTS whose
`styles` are `[]` — deleting the assertion changed nothing. (That one is now marked as an
honest limit in its own comment; the point is that nothing flagged it for weeks.)

This extends AGENTS.md rule 2 (a denial needs a planted witness) to every "returns
empty / null / false / throws" assertion, not just RLS.

**Run:** for each test asserting an absence, list every OTHER condition under which the
function returns that same absence. Set each one to the "would succeed" value in the
fixture (plant the origin, put an item in the list, make the bio present). Then delete
the guard and run:
```bash
npx vitest run tests/<file>.test.ts -t "<test name>"
```
For any assertion over a collection, add `expect(items.length).toBeGreaterThan(0)` or a
comment naming it VACUOUS with the file that owns the real rule.

**Passes when:** the test goes red with the guard removed AND the fixture comment names
the witness ("origin planted so Q5 is silent for one reason only"). A loop over a
collection either asserts non-emptiness or carries the honest-limit comment.

### 3. Can the harness even SEE this failure?

**Caught:** 2026-09-04, twice. `expect(() => dispatchEvent(...)).not.toThrow()` in
`tests/site-bridge-frame.test.ts` was vacuous: jsdom catches a throw inside a listener and
re-reports it as a window `error` event, so a removed `?.` survived. And skeen's suite
stubs `requestAnimationFrame` synchronous, which removed the window in which a frame can
be cancelled — hiding a latch-set-before-announce bug that lost a page's announce for a
whole session (skeen 5fb6115).

**Run:** read the harness-hazards table below. For every hazard the test under review
touches, write down the observable it uses INSTEAD, and prove the observable is live by
breaking the code once:
```bash
grep -n "not.toThrow\|stubGlobal\|vi.mock(\|as unknown as\|as any" tests/<file>.test.ts
```

**Passes when:** each hazard hit is paired with its replacement observable (an `error`
listener; a queued rAF; the row read back via the service client; an annotation instead
of a cast) and the "broke it, saw red" line is in the report.

### 4. Did the mutation check COVER this file, or only the guard I remembered?

**Caught:** 2026-09-03/04. `packages/site-bridge` is excluded from Stryker
(`stryker.config.json` `_workspace_caveat` — the workspace symlink resolves to the real
file, so it would report a false 0%). Every bridge test has zero automated mutation
coverage, and #1, #2, #3 above all live there. `npm run mutation:changed` prints the
files it will NOT mutate, but that is only a line of output if someone reads it.

**Run:**
```bash
npm run mutation:changed
```
Read the block under `NOT mutated — outside the slice in stryker.config.json:`. For every
file listed there, do the manual form: list every guard the diff added or moved —
```bash
git diff -U0 origin/dev...HEAD -- <file> | grep -nE '^\+.*(if \(!|\?\?|\?\.|return (""|\x27\x27|null|\[\])|\.trim\(\)|\.filter\()'
```
— and for EACH, delete it, run the owning test file, restore, `git diff --stat` to prove
the restore.

**Passes when:** the report has `guard (file:line) → killing test (file:line)` for every
guard in the diff, including the ones in files the script did not mutate. A guard with
no killing test is a finding, not a note.

### 5. Did anyone RUN it?

**Caught:** 2026-09-04. `faqPageJsonLd` still shipped `name: " — questions and answers"`
after two fixes, because the manager's own questions are exempt from the no-name rule
(right) which made `entries` non-empty and skipped the null return. The reviewer who
found it executed the function with a nameless payload and read the JSON. Reasoning about
it had passed twice.

**Run:** for every function in the diff that builds output someone else reads (JSON-LD,
sitemap, a rendered string, a payload over the bridge), execute it with the boundary
inputs — no name, whitespace-only name, empty list, missing origin, one item — and
print the result:
```bash
npx tsx -e "import { faqPageJsonLd } from './packages/site-bridge/src/seo'; console.log(JSON.stringify(faqPageJsonLd({ artist: { name: '  ' }, faq: { faq_question_6: 'Custom?', faq_answer_6: 'Yes.' } }, { origin: 'https://x.test' }), null, 2))"
```

**Passes when:** the printed output is pasted into the report for each boundary input,
and any hole in it (`" — "`, `"'s official"`, `"Who is ,"`) is a finding. Not "it should
return null there"; the output.

### 6. Does it break a CONSUMER?

**Caught:** 2026-09-04 (c5a0383, skeen 1ceec03). 0.35.0 added `pageChanged` as a
required member of the `onMounted` handle. A shell never constructs a handle, but skeen's
test double does, as an object literal. Skeen's typecheck went red on install with no
change on its side. Nothing in this repo could see it — the break was in another repo,
and it shipped in a MINOR version.

This repo publishes `@samfox1/site-bridge`. Its consumers are every site with a
`custom_site_url` plus the local checkouts. Enumerate them; do not recite them:
```bash
grep -H '"@samfox1/site-bridge"' ~/Desktop/*/package.json
# and the live rows: select slug, custom_site_url from artists where custom_site_url is not null
```
(2026-09-04: skeen ^0.35.2, ftbk ^0.32.0, wren deployed and not on this disk.)

**Run:** for every changed EXPORTED type or signature in `packages/site-bridge/src`:
```bash
git diff origin/dev...HEAD -- packages/site-bridge/src | grep -E '^[+-].*(export (type|interface)|^\+\s+\w+\??:)' 
```
A new REQUIRED member on a type a consumer might construct (handles, options, mocks) is
a breaking change: make it optional, or export the type so the consumer's error names the
member, or bump MAJOR. Then prove it against at least the newest-bridge consumer:
```bash
npm pack --workspace packages/site-bridge     # → samfox1-site-bridge-<v>.tgz
cd ~/Desktop/skeen-website && npm i --no-save ../lone-star-management/samfox1-site-bridge-<v>.tgz && npx tsc --noEmit && npx vitest run; npm ci
```
Ask before touching a site checkout another agent is working in.

**Passes when:** the report has one line per consumer: bridge version, typecheck result,
test result — or "not run, because …" with the reason. A required member added to an
exported type in a non-MAJOR bump is a finding regardless of what the consumers said.

### 7. What happens when the state goes AWAY?

**Caught:** 2026-09-04, twice. Skeen's edit shell derived `pages` from the draft (about
is only offered when the bio lives on its own page) but re-announced only on page switch
— a draft change that flipped availability was never pushed (skeen 06824ee/5fb6115). And
the editor's fold was about to infer "which page is this" from the announced regions,
which breaks on the one announce that matters: a page that has just lost its last region
(SITE_PAGES_PLAN.md R14). Stated data beat inferred data.

**Run:** for every value the diff pushes to another party (postMessage, announce, cache
entry, DB row, `revalidatePath`) list its triggers in a table with two columns: fires
when the value APPEARS/changes, fires when it DISAPPEARS. For every value the diff
DERIVES from something else, write what the derivation returns when its source is empty.

**Passes when:** every pushed value has a non-empty "disappears" cell with a test named,
and every derived value has its empty-source answer written down. "Same trigger" is fine
if a test proves it fires on the disappearance.

### 8. Is the comment EVIDENCE, or a claim?

**Caught:** 2026-09-04 (skeen 5fb6115). The nav handler let same-origin links navigate,
under a docblock calling it deliberate ("a fan would find it that way"). This document is
the editor's iframe; navigating unmounts the bridge, and the editor is left holding the
public shop that never announces again. The hero renders a `/merch` link whenever merch
is published, so it was one click away. The `n===5` comment in #1 was the same shape:
"the only branch reachable without an artist" — it was not.

**Run:**
```bash
git diff origin/dev...HEAD -- src packages | grep -nE '^\+.*(deliberate|by design|never|only (branch|path|place|reachable)|cannot|always|left exactly)'
```
For each: name the test that pins the claim, or run the scenario the comment excludes.

**Passes when:** every intent-claiming comment in the diff has `test file:line` beside it
in the report, or is marked UNPINNED with the scenario that would falsify it. An UNPINNED
"never" on a security or bridge-liveness path is a finding.

## Harness hazards specific to this repo

Grepped 2026-09-04, not recalled. Each erases a bug class; each has a replacement
observable. Re-grep when the list looks stale — the list going stale is itself a hazard.

| Hazard | Where (count) | Erases | Use instead |
| --- | --- | --- | --- |
| `requestAnimationFrame` stubbed synchronous | `tests/site-bridge-entrances.test.ts` (6 sites); skeen `app/edit/page.test.tsx` | cancel-before-fire; ordering between frames; double-rAF timing. The 5fb6115 latch bug lived entirely inside this window | a queued stub (`frames.push(cb)`) with `cancelAnimationFrame` recording ids; fire manually; restore the sync stub after |
| jsdom swallows listener throws | any `dispatchEvent` (10 test files); `not.toThrow()` ×16 in `site-editor-bridge`, `site-bridge-seo`, `site-bridge-cursor`, `site-bridge-frame` | a throw inside a handler — the listener dies and the test stays green | `window.addEventListener('error', …)` and assert `[]`; then prove the listener is still alive with a second message |
| Supabase chain mocks returning `{ error: null }` | `vi.mock('@/lib/supabase/server')` ×15 files, `client` ×5, `admin` ×2 | wrong table, wrong column, renamed RPC, RLS denial, missing GRANT — every query shape passes | assert the ARGS the chain received; pin the door in an `*.isolation.test.ts` against the live project with `tests/helpers/rls.ts` |
| Row-filtered RLS writes | live-DB suites (AGENTS.md rule 3; `tests/fonts.isolation.test.ts` header) | a denied UPDATE/DELETE returns `error: null` and touches nothing | read the row back through the service client; assert state |
| `as unknown as` / `as any` | 328 uses, 20+ test files | a fixture the type would reject; a new required member on the type (the #6 class) is invisible | annotate (`const h: FrameHandle = {…}`); cast only for `Window` / `Response` shapes with no constructor |
| `vi.stubGlobal('fetch', …)` | `epk-download-route`, `site-bridge-public-site` | host guards, redirect hops, private-IP checks | the injected fetcher in `seo-audit.ts`: pass a RECORDING fetcher and assert it was NOT called for a denied host |
| `next/cache` + `next/navigation` mocked | ×12, ×15 | whether a page actually revalidates or redirects | assert `revalidatePath` / `redirect` call args, not just "no throw" |
| `NODE_ENV` sniffed for a hatch | any `process.env.NODE_ENV` in the diff | the suite runs as `NODE_ENV='test'`; an env-reading hatch opens itself inside the tests that prove the guard (7208c7e, `allowLoopback`) | an explicit option, passed only at the call site that needs it |
| `packages/site-bridge`, `packages/music-rules` outside Stryker | `stryker.config.json` `_workspace_caveat` | ALL automated mutation coverage for the bridge | check 4's manual mutation, every guard, every time |
| `vitest.mutation.config.ts` DB-free slice | `tests/mutation-config.test.ts` guards it | a module tested only through live-DB suites reports false survivors | keep the slice honest; add pure modules to `mutate` when they gain DB-free tests (artist-facts, seo-audit joined 2026-09-03) |

## Stop and escalate

Never auto-fix and quietly close. Report, name the sink, wait for a decision.

- **Anything the server fetches where a manager controls the URL.** The SSRF in
  `auditLiveSite` (H1, 2026-09-03) sat merged with ~4,600 tests green; `custom_site_url`
  was validated as `^https?://` and ten sitemap URLs followed with `!== base`. Test count
  is not safety. Any new `fetch(`/`rpc(` on a server path gets: input source named, host
  guard named, a test that plants `169.254.169.254` and asserts denial.
- **Anything that can write bad data PERMANENTLY.** The `sections/ai.tsx` textarea
  seeded from `autoFaqAnswer` — a written answer wins forever. Any output that reaches
  `site_content`, `artist_seo_facts`, a published revision, or a saved draft.
- **Anything that changes PUBLISHED output** — JSON-LD, sitemap membership, `/faqsheet`,
  `robots`, OG tags. A hole here is quoted by an assistant or indexed before anyone looks.
- **Any bridge change that alters an exported type, the wire protocol, or announce
  ordering.** Three live sites; the break is invisible here (check 6).
- **Any migration that touches a column in a `PUBLISHABLE` snapshot.** M5/M6 put every
  artist's media and profile permanently dirty.
- **A finding the auditor is not sure is real.** Say so. A wrong "fix" to a correct test
  is worse than the finding.

## What this checklist cannot catch

Say this plainly so nobody reads a clean run as safety.

- **Bugs in code the diff did not touch.** Every check keys off `git diff`. The 08-04
  audit found ten bugs in code nobody was changing; only the full audit reaches those,
  and only for the subsystems it is pointed at.
- **A consumer we do not know about.** Check 6 enumerates from `custom_site_url` and
  local checkouts; a site connected without either is invisible.
- **Runtime behaviour in a real browser.** jsdom is not Chrome: layout, IntersectionObserver
  timing, cross-origin postMessage ordering, `unstable_cache` semantics. The entrance
  animation blocker (2026-08-12) was found by hand, not by a test.
- **Whether the rule is the RIGHT rule.** A guard can be perfectly tested and wrong (the
  "fan would find it" nav handler was tested for exactly what it did). Check 8 finds
  claims without tests; it cannot find tested claims that are mistaken.
- **Bugs that need production data.** FTBK's `http://localhost:3004` in the live DB would
  have been silently demoted by H1's fix; no fixture had that value.
- **Reviewer fatigue.** A review cut short by a rate limit (c5a0383: two of eight angles
  reported) found two real bugs in those two angles. Six angles were never run. A partial
  run must say which checks did not happen.
- **The next failure shape.** This list is twelve dated misses. The thirteenth will not
  be on it. When it happens, add it here with the date, the commit, and the check.

## After the findings land

1. **Verify the headline claims yourself** before acting. Roughly one finding in ten is
   wrong.
2. Fix in workstreams with disjoint file ownership, test-first, mutation-checked (check 4
   for anything outside the Stryker slice).
3. Run `npm run mutation` afterwards — a DROP means a new test does not bite.
4. Commit with the finding's evidence in the message.
5. Full audit only: `git commit --allow-empty -m "chore: test-audit baseline <date>"`.

## Hard constraints for every agent

- Tests run against the **LIVE hosted Supabase project**. NEVER `supabase db reset`.
  NEVER run `seed-skeen`, `pull-skeen`, `skeen-cinematic`, or `upload-skeen-media`.
- Restore every mutation. Verify with `git diff` before reporting.
- Do not `git stash` — other agents are working in the same tree.
- Ask before installing into or editing a site checkout; another agent may own it.
- Clean up any rows created; scope teardowns to your own fixtures.

## What good looks like

The audit is working when findings get harder to come by and shift from "this proves
nothing" toward "this could be tightened". If a change audit produces no findings and
every check has its evidence line, say so and stop — a review that manufactures work to
look thorough is the same failure as a test that passes to look green.

## Index: the 2026-09-03/04 misses and the check that owns each

| # | Miss | Commit | Check |
| --- | --- | --- | --- |
| 1 | Guard on `n===5` only; exported function, editor caller, saveable textarea | 80ac5f5 | 1 (callers + permanent sink), 4 (manual mutation of every branch) |
| 2 | `autoFaqAnswer(5, nameless)` empty for lack of `origin`, not name | 7b834d4 | 2 (plant the witness) |
| 3 | `not.toThrow()` vacuous under jsdom listener swallowing | frame.test.ts:1265 | 3 (harness hazards) |
| 4 | Uniqueness asserted over `styles: []` | site-editor.test.ts:77 | 2 (non-empty or honest limit) |
| 5 | Required `pageChanged` member in a MINOR; broke skeen's typed mock | c5a0383, skeen 1ceec03 | 6 (cross-repo) |
| 6 | Synchronous rAF stub hid a cancel-before-announce latch bug | skeen 5fb6115 | 3 (harness hazards) |
| 7 | Docblock called same-origin navigation deliberate; it killed the bridge | skeen 5fb6115 | 8 (comment is a claim) |
| 8 | Page availability pushed on page change, never on availability change | skeen 06824ee | 7 (the disappears column) |
| 9 | `" — questions and answers"` found by executing `faqPageJsonLd` | 80ac5f5 | 5 (run it, paste the output) |
| 10 | SSRF merged behind ~4,600 green tests | 7208c7e, REVIEW_2026-09-03 H1 | stop-and-escalate (server fetch, manager-controlled URL); no test-quality check catches an absent guard — see "cannot catch" |
| 11 | `packages/site-bridge` outside Stryker: zero automated mutation coverage | stryker.config.json | 4 (read the NOT-mutated block; manual mutation) |
| 12 | Inferring the page from regions breaks when the last region leaves | SITE_PAGES_PLAN R14 | 7 (derived value, empty source) |
