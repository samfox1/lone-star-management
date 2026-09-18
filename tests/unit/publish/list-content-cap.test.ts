// A truncated listContent read must THROW, because publishContent reads "missing" as "deleted".
/**
 * PostgREST caps an unranged select at `db-max-rows` (1,000 on Supabase) and returns the
 * truncated page with a 200 — no error, no flag. `listContent` had no range and no count,
 * so past the cap it silently returned a PREFIX of the artist's rows.
 *
 * That is not a display bug. `publishContent` builds `liveIds` from exactly this list and
 * tombstones every published entity NOT in it, so a truncated read publishes a tombstone
 * for every real row past row 1,000 — the live site loses content the manager never
 * touched. `restoreToPublished` reads the same list and deletes by the same logic.
 * `publishContent` documents this cap and works around it for the OTHER half of the
 * comparison (the `latest_revisions` RPC, 2026-08-11); the draft half was left uncapped.
 *
 * A stub client rather than the database: the failure only appears above 1,000 rows, and
 * planting 1,001 rows on the shared hosted project to watch a guard fire is exactly the
 * kind of teardown that wrecks other suites. What is actually being pinned is the
 * comparison — rows returned vs. the server's exact count — and that is a property of the
 * call, not of the data.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listContent } from '@/lib/content'

type Row = Record<string, unknown>

/** A Supabase stand-in whose select resolves to `rows` while reporting `count` as the
 *  true total — which is precisely what a truncated PostgREST response looks like. */
function stubClient(rows: Row[], count: number | null) {
  const orderCalls: { col: string; ascending: boolean | undefined }[] = []
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCalls.push({ col, ascending: opts?.ascending })
      return q
    },
    then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, count, error: null }).then(ok, err),
  })
  return { client: { from: () => q } as unknown as SupabaseClient, orderCalls }
}

const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

describe('listContent refuses a truncated read', () => {
  it('throws when the server reports MORE rows than it returned', async () => {
    const { client } = stubClient(rows(1000), 1500)
    await expect(listContent(client, 'merch', 'a1')).rejects.toThrow(/merch/)
    // The message has to say what happened, not just that something did — this error
    // only ever appears when someone's catalogue has outgrown the page.
    await expect(listContent(client, 'merch', 'a1')).rejects.toThrow(/1000 of 1500/)
  })

  it('returns the rows when the count matches (the guard is not just "always throw")', async () => {
    const { client } = stubClient(rows(83), 83)
    await expect(listContent(client, 'merch', 'a1')).resolves.toHaveLength(83)
  })

  it('returns the rows when the server sends no count at all', async () => {
    // Belt and braces: a missing count must not become a hard failure on every read.
    const { client } = stubClient(rows(3), null)
    await expect(listContent(client, 'merch', 'a1')).resolves.toHaveLength(3)
  })

  it('still applies the configured ordering, direction included', async () => {
    // The cap guard sits in the same few lines as the orderBy loop; this pins that
    // adding it did not drop merch's descending created_at (the 2026-09-18 parity fix).
    const { client, orderCalls } = stubClient(rows(2), 2)
    await listContent(client, 'merch', 'a1')
    expect(orderCalls).toEqual([
      { col: 'sort_order', ascending: true },
      { col: 'created_at', ascending: false },
    ])
  })
})
