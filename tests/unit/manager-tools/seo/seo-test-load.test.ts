// The Test tab's read: "not switched on yet" vs "couldn't read" vs "never tested".
/**
 * The seo_test_runs migration is not pushed yet (2026-09-29), so "the table isn't there" is the
 * state the live page is in. It must read as "Testing isn't switched on yet", never as a failed
 * read, and a real failed read must never read as "never tested" (store.ts latestRun's rule).
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTable, loadTestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'

/** A query builder that answers every chain with `result`. */
function fake(result: { data: unknown; error: { code?: string; message?: string } | null }): SupabaseClient {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) chain[m] = () => chain
  chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
  return { from: () => chain } as unknown as SupabaseClient
}

describe('isMissingTable', () => {
  it('knows PostgREST’s and Postgres’s "no such table", and nothing else', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.seo_test_runs' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation "public.seo_test_runs" does not exist' })).toBe(true)
    expect(isMissingTable({ message: "seo_test_runs: Could not find the table 'public.seo_test_runs' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42501', message: 'permission denied for table seo_test_runs' })).toBe(false)
    expect(isMissingTable({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})

describe('loadTestTab', () => {
  it('CRITICAL: the table missing is "off", a denied or broken read is "error", an empty table is "never tested"', async () => {
    expect(await loadTestTab(fake({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }), 'a1')).toEqual({ state: 'off' })
    expect(await loadTestTab(fake({ data: null, error: { code: '42501', message: 'permission denied' } }), 'a1')).toEqual({ state: 'error' })
    const ok = await loadTestTab(fake({ data: null, error: null }), 'a1')
    expect(ok.state).toBe('ready')
    expect(ok.state === 'ready' && ok.latest).toBeNull()
  })
})
