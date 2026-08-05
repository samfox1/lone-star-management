/**
 * The mutation config's exclude list must stay TRUE.
 *
 * `vitest.mutation.config.ts` is a negative filter: everything except the suites that
 * talk to the hosted database. Stryker runs that slice once per mutant — thousands of
 * times — so a DB-backed file slipping into it would hammer the live project and make
 * the run take days instead of minutes.
 *
 * A new DB-free test file is picked up automatically, which is the point. A new
 * DB-BACKED file has to be excluded by hand, and nothing would notice the omission
 * except a mysteriously slow mutation run and unexplained rows in production. This test
 * is that notice.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../vitest.mutation.config'

const TESTS_DIR = join(process.cwd(), 'tests')

/** The imports that mean "this file talks to the hosted Supabase project". */
const DB_MARKERS = ['helpers/supabase', 'serviceClient', 'signInAs', 'anonClient']

const excluded = new Set(
  ((config.test?.exclude as string[]) ?? []).map((p) => p.replace(/^tests\//, '')),
)
const excludesIsolationGlob = ((config.test?.exclude as string[]) ?? []).some((p) =>
  p.includes('isolation'),
)

describe('vitest.mutation.config exclude list', () => {
  it('CRITICAL: every DB-backed test file is excluded from the mutation slice', () => {
    const leaked: string[] = []
    for (const name of readdirSync(TESTS_DIR)) {
      if (!name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) continue
      if (name.endsWith('.isolation.test.ts') && excludesIsolationGlob) continue
      if (excluded.has(name)) continue
      // This file NAMES the markers as data; matching on itself would be permanent noise.
      if (name === 'mutation-config.test.ts') continue
      const src = readFileSync(join(TESTS_DIR, name), 'utf8')
      if (DB_MARKERS.some((m) => src.includes(m))) leaked.push(name)
    }
    // Naming the files makes the fix obvious: add them to the exclude list.
    expect(leaked).toEqual([])
  })

  it('the exclude list carries no entry for a file that no longer exists', () => {
    // A stale entry is harmless at runtime but hides that a suite was deleted or
    // renamed, and slowly turns the list into folklore nobody trusts.
    const present = new Set(readdirSync(TESTS_DIR))
    // Literal filenames only — the list also holds globs (node_modules, the isolation
    // pattern), which name no single file and can never be "missing".
    const stale = [...excluded].filter(
      (n) => n.includes('.test.') && !n.includes('*') && !present.has(n),
    )
    expect(stale).toEqual([])
  })
})
