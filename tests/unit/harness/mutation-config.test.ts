// The tests/ folder rule: what touches the database lives in integration/, and only that is
//   excluded from mutation testing.
/**
 * THE FOLDER RULE MUST STAY TRUE.
 *
 * `tests/` is organised by KIND: `unit/` and `components/` touch nothing but code,
 * `integration/` talks to the hosted Supabase project. `vitest.mutation.config.ts`
 * excludes exactly `tests/integration/**`, because Stryker runs the slice once per
 * mutant — thousands of times — and a DB-backed file in there would hammer the live
 * project and turn a minutes-long run into days.
 *
 * WHAT REPLACED WHAT. Until 2026-09-10 the exclude was sixty hand-written paths and
 * this test walked ONE directory with `readdirSync`. Both were quietly fragile: a new
 * DB-backed file nobody remembered to list ran against production, and the moment tests
 * moved into subfolders the walk would have found zero files and passed while checking
 * nothing. Now the rule is a folder, and this reads the tree.
 *
 * IT BITES IN BOTH DIRECTIONS, which the old one did not:
 *   • a file OUTSIDE integration/ that touches the DB → it is in the mutation slice
 *   • a file INSIDE integration/ that touches no DB   → it is excluded for no reason,
 *     losing real mutation coverage silently
 * The second is the one that rots: misfiled tests accumulate, `integration/` stops
 * meaning anything, and the exclude quietly covers half the suite.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../../vitest.mutation.config'

const TESTS_DIR = join(process.cwd(), 'tests')

/** The imports that mean "this file talks to the hosted Supabase project". */
const DB_MARKERS = ['helpers/supabase', 'serviceClient', 'signInAs', 'anonClient']

/** Every test file under `tests/`, at any depth, as a path relative to `tests/`. */
function allTestFiles(dir = TESTS_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...allTestFiles(full))
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(relative(TESTS_DIR, full))
  }
  return out
}

/** Does this file's SOURCE reach the hosted project? This file names the markers as
 *  data, so matching on itself would be permanent noise. */
const touchesDb = (rel: string) =>
  !rel.endsWith('mutation-config.test.ts') &&
  DB_MARKERS.some((m) => readFileSync(join(TESTS_DIR, rel), 'utf8').includes(m))

const inIntegration = (rel: string) => rel.startsWith('integration/')

describe('the tests/ folder rule', () => {
  it('CRITICAL: the walk actually finds the tree', () => {
    // The load-bearing precondition, and the exact way the old version broke. Every
    // assertion below is a filter over this list: if it came back empty — a bad root, a
    // non-recursive walk — they would all pass while checking nothing at all.
    const files = allTestFiles()
    expect(files.length).toBeGreaterThan(200)
    expect(files.some((f) => f.includes('/')), 'the walk never descended').toBe(true)
  })

  it('CRITICAL: no DB-backed test runs in the mutation slice', () => {
    // The original guard's job. A file here is executed once per mutant against the
    // live project — the failure is measured in production writes, not in a red build.
    const leaked = allTestFiles().filter((f) => !inIntegration(f) && touchesDb(f))
    expect(leaked, 'move these under tests/integration/<subject>/').toEqual([])
  })

  it('CRITICAL: nothing sits in integration/ that has no reason to be there', () => {
    // The half the old list could never check. A pure test filed under integration/ is
    // excluded from mutation testing forever, and nothing anywhere says so — the report
    // simply never looks at the code it covers.
    const misfiled = allTestFiles().filter((f) => inIntegration(f) && !touchesDb(f))
    expect(misfiled, 'these touch no database — move them to tests/unit/ or tests/components/').toEqual([])
  })

  it('CRITICAL: the config still excludes exactly the integration folder', () => {
    // The rule the two assertions above are meaningless without. If someone widened this
    // to `tests/**`, every test would be "correctly" excluded and both would pass.
    expect(config.test?.exclude).toEqual(['**/node_modules/**', 'tests/integration/**'])
  })

  it('every test file is filed under one of the three kinds', () => {
    // Keeps a fourth top-level folder from appearing without a decision about whether
    // its contents are in the slice.
    const stray = allTestFiles().filter((f) => !/^(unit|components|integration)\//.test(f))
    expect(stray).toEqual([])
  })
})
