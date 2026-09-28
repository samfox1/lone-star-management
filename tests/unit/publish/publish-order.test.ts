// Publishing writes the content AND the profile in one insert, so a publish that dies
//   halfway never goes half-live.
/**
 * publishAll writes EVERYTHING in one insert, the profile included (lib/content.ts).
 *
 * A site is "live" exactly when its profile snapshot exists — get_public_site returns null
 * without one. The guarantee used to be ORDER: the profile went last, so a publish that
 * died halfway never flipped a never-published site live with empty content. It still
 * shipped whatever kinds had landed before the failure, though, and every kind was its own
 * version in the history. Now it is ONE statement: all of it lands, under one timestamp,
 * or none of it does (tests/integration/publish/publish-one-moment.test.ts shows the real
 * database doing both).
 *
 * Nothing pinned the order when it was the guarantee: every other publish test asserts the
 * end state of a publish that SUCCEEDED, which is identical whichever way the writes went
 * out. A stub client rather than the database: how many writes a publish makes, and what a
 * refused one leaves behind, are properties of the call sequence.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EDITOR_RESTORE, PUBLISHABLE, publishAll, type TableEntity } from '@/lib/content'

type Row = Record<string, unknown>

/**
 * Minimal Supabase stand-in for the publish path: every content table holds exactly one
 * working row (so each type really does write a revision — with empty tables a per-type
 * publish and a single one look the same), `revisions` starts empty, and every insert is
 * recorded. `failOn` makes any insert carrying that entity type fail, standing in for a
 * refused row; like Postgres, a refused statement writes NONE of its rows.
 */
function stubClient(failOn?: string) {
  const writes: string[] = []
  const inserts: string[][] = []
  const from = (table: string) => {
    const rows: Row[] =
      table === 'revisions' ? [] : [{ id: `${table}-1`, artist_id: 'a1' }]
    const result = { data: rows, error: null }
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      not: () => q,
      order: () => q,
      single: async () => ({ data: rows[0] ?? null, error: null }),
      // The browser-bar singleton (PUBLISHABLE.theme_color, 20260925120000) reads the artist
      // row itself: a colour is set, so it too has its one row to publish.
      maybeSingle: async () => ({ data: table === 'artists' ? { id: 'a1', theme_color: '#000000' } : (rows[0] ?? null), error: null }),
      then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, err),
      insert: async (payload: Row | Row[]) => {
        const types = (Array.isArray(payload) ? payload : [payload]).map((r) => r.entity_type as string)
        inserts.push(types)
        if (types.includes(failOn as string)) return { error: { message: `${failOn} insert failed` } }
        writes.push(...types)
        return { error: null }
      },
    })
    return q
  }
  return {
    client: {
      from,
      // The tombstone sweep reads the log through the latest_revisions RPC now
      // (uncapped, 2026-08-11). An empty log: this suite pins WRITE ordering, and a
      // sweep with nothing published tombstones nothing.
      rpc: async () => ({ data: [], error: null }),
    } as unknown as SupabaseClient,
    writes,
    inserts,
  }
}

describe('publishAll is one write', () => {
  it('CRITICAL: ONE insert carries every publishable type and the profile', async () => {
    const { client, inserts } = stubClient()
    await publishAll(client, 'a1')

    expect(inserts, 'one insert per publish: a second is a second version in the history').toHaveLength(1)
    // Derived from the registry, so adding a publishable type extends this rather than
    // silently escaping the check.
    expect([...inserts[0]].sort()).toEqual([...Object.keys(PUBLISHABLE), 'artist'].sort())
  })

  it('CRITICAL: a publish with one refused kind writes NOTHING — no content, and no profile', async () => {
    // The live-gate reason: an artist publishing for the first time must not end up
    // live-but-empty because the publish died before its content landed — and no longer
    // with half its content live either.
    const { client, writes } = stubClient('media')
    await expect(publishAll(client, 'a1')).rejects.toThrow('media insert failed')
    expect(writes).toEqual([])
  })
})

describe('PUBLISHABLE: a table OR its own read, never both (review 2026-09-24)', () => {
  it('CRITICAL: theme_color names no table, and nothing that writes a table can name it', () => {
    // It named `artists` only to satisfy the type; one EDITOR_RESTORE entry with
    // absent: 'delete' would then have deleted the artist row. The union type makes both a
    // compile error (tsc); these keep the rule visible to a vitest-only run too.
    expect(Object.keys(PUBLISHABLE.theme_color)).not.toContain('table')
    expect(EDITOR_RESTORE.map((e) => e.type)).not.toContain('theme_color')
    // @ts-expect-error — a type with its own `read` is not a TableEntity. If TableEntity is
    // ever widened back to every PublishableEntity, this line stops erroring and tsc fails.
    const never: TableEntity = 'theme_color'
    expect(never).toBe('theme_color')
  })
})
