<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase CLI: never `npx supabase`

Use the installed CLI directly (`supabase db push`, `supabase migration list`) or the
npm scripts (`npm run db:push`). **Never `npx supabase`.**

`supabase` is NOT a dependency of this project, so npx silently downloads its own
copy (~162 MB) into `~/.npm/_npx/` and runs *that* instead. Two things break:

- **It re-prompts for your macOS keychain password, forever.** The CLI reads its
  access token from the login keychain, and macOS grants that per *binary*. The npx
  copy is a different executable from `/opt/homebrew/bin/supabase`, so "Always Allow"
  on the real one never covers it.
- **It's a different CLI version.** npx pulls latest (2.109.1) while the installed one
  was 2.90.0 — so migrations get pushed by a different CLI than the one everything
  else is verified with. Nobody notices until they do.

(If `SUPABASE_ACCESS_TOKEN` is set in the environment, the CLI skips the keychain
entirely and neither binary prompts — but the version-skew reason stands regardless.)

# Test discipline: a test must be able to FAIL

The 2026-08-04/05 review found the same defect shape over and over, across every
subsystem, written by every author (humans and agents alike): a test that reads as
protection but passes whether or not the guarded behavior exists. Concretely: an
isolation denial asserted over an empty table; an assertion landing on the mock
instead of the code; input neutralized upstream before it reaches the guard being
"tested"; a fixture hand-copied from the implementation; an early return satisfying
a test aimed at a later guard. Several live bugs (a dropped rate-limit cap, an
unpublishable section, XSS sinks, silent double-publishes) hid behind exactly these.

Rules, in order of importance:

1. **Prove the failure before trusting the pass.** A new test must be seen RED for
   the right reason before the fix lands (test-first), or — for a test pinning
   existing behavior — the guard it names must be deleted/weakened once to confirm
   the test goes red (mutation check), then restored. "It passes" proves nothing;
   "it failed when the guard was gone" is the evidence.
2. **Denials need a planted witness.** Any test asserting "X cannot read/write Y"
   must first prove Y EXISTS (plant via service client, assert presence), or it is
   vacuously true. Assert the specific error code (42501 for RLS — use
   tests/helpers/rls.ts), never bare `not.toBeNull()`, which accepts PGRST202
   "function does not exist" as proof a door is closed.
3. **Row-filtered writes lie.** RLS makes a denied UPDATE/DELETE return
   `error: null` with zero rows matched. Assert row STATE via the service client,
   never the return value.
4. **Derive fixtures and expected sets from the registry, never hand-list them.**
   A hand-written list silently omits every future member (the publish window's
   SECTIONS missed site_styles; its own sweep test then missed artist_font because
   the FIXTURE was hand-listed too). `Object.keys(PUBLISHABLE)`,
   `Record<UnionType, true>` (a compile error on widening), and reading the real
   steps/options from the source module are the patterns.
5. **Re-entry latches are refs, not state.** Two fast clicks both read pre-render
   state; `busyRef` is the latch, state only drives the label. Pin double-fire by
   dispatching BOTH clicks inside one `act()` batch — after one `fireEvent.click`
   React disables the button and the second click never dispatches, pinning nothing.
6. **Scope live-DB teardowns to rows you created.** Deleting "everything for the
   seed artist" destroys other suites' premises and human test data, and makes later
   denials vacuous. Track ids/markers; delete exactly those.

When a rewrite drops a rule that had no test, the rule simply evaporates — that is
how the per-artist flood cap vanished for a day. If a behavior matters, its test must
bite; if the test cannot be made to bite, say so in the test's comment rather than
leaving a reassuring green.

## Where a test goes

`tests/` is organised by KIND first, then by subject (2026-09-10):

    tests/unit/<subject>/         pure. no DB, no DOM.
    tests/components/<subject>/   jsdom, `// @vitest-environment jsdom`, actions mocked
    tests/integration/<subject>/  TALKS TO THE HOSTED PROJECT

The top level is not decoration: `vitest.mutation.config.ts` excludes exactly
`tests/integration/**`, so the folder a file sits in decides whether Stryker runs it
thousands of times. That replaced sixty hand-listed paths, which is the sort of list
that is only ever wrong in the direction nobody notices.

Import helpers as `@tests/helpers/…`, never `./helpers/…` — the alias survives a file
moving between subjects, a relative path does not.

Plan docs written before this date (`DASHBOARD_PLAN.md`, `SEO_GEO_PLAN.md`,
`SITE_PAGES_PLAN.md`, `REVIEW_2026-09-03.md`) name tests by their old flat path. They
are records of what was true then and were left alone; `git log --follow` finds any of
them.

## The two tools that enforce this

Rules depend on someone remembering. These do not.

**`npm run mutation`** (Stryker) breaks the code on purpose and checks whether any test
notices. A SURVIVED mutant is a line nothing is watching. It runs against
`vitest.mutation.config.ts` — the DB-free slice of the suite — because Stryker re-runs
tests once per mutant and the main suite crosses the internet to hosted Postgres.
`mutate` in `stryker.config.json` lists only modules pinned by DB-free tests: adding a
module tested solely through the live-DB suites would report false survivors and teach
everyone to ignore the report. `tests/unit/harness/mutation-config.test.ts` fails if a
DB-backed suite leaks into that slice (it caught eight on day one), and now also fails
the other way — a pure test filed under `integration/` is excluded from mutation testing
forever, and nothing else would ever say so.

The `break` threshold is a RATCHET. Raise it as the score rises; never lower it to turn
a red build green. A drop means a new line went unwatched or an existing test stopped
biting.

WHEN TO RUN WHICH. The full sweep is ~29 minutes, which is a check you MEAN to run;
`npm run mutation:changed` is the one you actually run. It diffs against the merge-base
with `origin/main` (committed changes, working tree, and untracked files), intersects
that with the `mutate` slice, and reports what it dropped and why — so a src file left
out is a line of output, not a silent gap. Seconds to a couple of minutes.

  npm run mutation:changed              # this branch
  npm run mutation:changed -- --base HEAD~3
  npm run mutation:changed -- --all     # the whole slice, no diff

So: **targeted on every change**, once the suite is green. **Full run before a release
or after a large feature**, then ratchet `break` to just under the new score. And when a
new module gains DB-FREE tests, add it to `mutate` — a module that is not on that list is
never looked at, which is the one way this whole apparatus can quietly stop working.

Neither replaces the per-test habit — delete the guard, watch it go red — because that is
the only check that happens WHILE the test is being written, when fixing it is free.

**`/test-audit`** (`.claude/skills/test-audit/`) is the periodic adversarial review:
fan out agents that read each implementation before judging its test, and prove findings
by deleting the guard and watching the suite stay green. Run it before a release or
quarterly, and after any large feature.

They catch different things, and neither is optional:

| | finds | misses |
| --- | --- | --- |
| `npm run mutation` | tests that CANNOT fail | tests that don't exist; tests pinning the wrong rule |
| `/test-audit` | wrong-rule tests, missing keystones, redundancy | anything a human reader glosses over |

The wrong-rule class is the one no tool can reach. A test named "rejects an out-of-enum
status (CHECK constraint)" passed, would have failed if broken, and had never once
reached that constraint — RLS rejected the request first. Only a suspicious reader finds
that.
