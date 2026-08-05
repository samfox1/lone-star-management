---
name: test-audit
version: 1.0.0
description: Adversarial review of test QUALITY — finds tests that pass for the wrong reason, that a refactor would break without a behaviour change, or that pin a rule other than the one in their name. Run periodically (before a release, or quarterly) and after any large feature. Complements `npm run mutation`, which finds tests that cannot fail at all.
triggers:
  - test audit
  - review the tests
  - are our tests any good
  - test quality review
---

# /test-audit — are these tests actually protecting anything?

## Why this exists

On 2026-08-04/05 a full-suite audit of this repo found the SAME defect in every
subsystem, written by every author: a test that reads as protection but passes whether
or not the guarded behaviour exists. Ten live bugs were sitting behind green suites,
including a dropped rate-limit cap, unreleased music going public, two stored-XSS
sinks, silent double-publishes, an open redirect, and three missing ownership gates.

`npm run mutation` (Stryker) now catches one class automatically: **tests that cannot
fail**. It cannot catch the other two:

- **Tests that don't exist** for a case nobody considered.
- **Tests that bite, but pin the WRONG rule.** The worst kind. One test here was named
  "rejects an out-of-enum status (CHECK constraint)" and had never once reached that
  constraint — RLS rejected the request first. It passed, it would have failed if
  broken, and it proved nothing about its own name.

Those need a reader with suspicion. That is this command.

## Scope selection

Default: everything changed since the last audit.

```bash
git log --oneline -1 --grep="test-audit baseline" || echo "no previous audit"
git diff --stat main..HEAD -- tests/ src/ | tail -3
```

Ask the user for scope if the diff is large: a subsystem (music, publish, enquiries,
editor, integrations, isolation), or "everything we haven't audited".

## How to run it

Dispatch ONE agent per subsystem, in parallel, each owning a disjoint set of test files
so they cannot collide. Give every agent this rubric verbatim:

> For each test file, judge:
> 1. **TAUTOLOGICAL / WRONG-REASON** (the priority) — does it pass even if the guarded
>    behaviour is deleted? Watch for: the assertion landing on a mock rather than the
>    code; input neutralised by an earlier layer before it reaches the guard under test;
>    a denial asserted over an empty table; an early return satisfying a test aimed at a
>    later guard; `expect(error).not.toBeNull()` accepting an error that means the
>    opposite of what the test claims.
> 2. **WRONG RULE** — does the test's NAME match what it actually exercises? Trace the
>    real code path and confirm the assertion is caused by the named rule and not by
>    something upstream.
> 3. **IMPLEMENTATION-PINNED** — would a legitimate refactor with no behaviour change
>    break it? (exact internal call shapes, DOM structure, class names, magic indexes)
> 4. **REDUNDANT** — is this rule already owned by another file? Name the delete
>    candidate.
> 5. **MISSING KEYSTONE** — a rule a rewrite could silently drop with everything staying
>    green. Weight this heavily for anything the code's own comments call load-bearing.
>
> READ THE IMPLEMENTATION BEFORE JUDGING ANY TEST. Where cheap, PROVE the claim: delete
> or weaken the guard, re-run, confirm the suite stays green, then restore. A finding
> with a mutation behind it is worth ten without.
>
> Report: file:line, classification, one-sentence evidence, and the fix
> (rewrite / delete / keep). Per-file verdict: solid or needs work. Rank by severity.
> Findings only, no praise padding. If a finding turns out to be WRONG, say so with
> evidence rather than inventing a fix — two findings in the last audit were wrong and
> closing them honestly was worth more than "fixing" them.

## Hard constraints for every agent

- Tests run against the **LIVE hosted Supabase project**. NEVER `supabase db reset`.
  NEVER run `seed-skeen`, `pull-skeen`, `skeen-cinematic`, or `upload-skeen-media` —
  they are destructive and `seed-skeen` wipes the publish log.
- Restore every mutation. Verify with `git diff` before reporting.
- Do not `git stash` — other agents are working in the same tree.
- Clean up any rows created; scope teardowns to your own fixtures.

## After the findings land

1. **Verify the headline claims yourself** before acting. Roughly one finding in ten is
   wrong, and a wrong "fix" to a correct test is worse than the finding.
2. Fix in workstreams with disjoint file ownership, test-first, mutation-checked.
3. Run `npm run mutation` afterwards — the fixes should raise the score, and a DROP
   means a new test does not bite.
4. Commit with the finding's evidence in the message, so the next reader knows what the
   test is defending and why it is shaped that way.
5. Tag the audit point so the next run knows where to start:
   `git commit --allow-empty -m "chore: test-audit baseline <date>"`

## What good looks like

The audit is working when findings get harder to come by and shift from "this proves
nothing" toward "this could be tightened". If a run produces no CRITICAL findings and
`npm run mutation` is at or above its break threshold, say so plainly and stop — a
review that manufactures work to look thorough is the same failure as a test that
passes to look green.
