/**
 * publishAll publishes the PROFILE LAST (lib/content.ts).
 *
 * A site is "live" exactly when its profile snapshot exists — get_public_site returns null
 * without one. So the order is the whole guarantee that a publish which dies halfway never
 * flips a never-published site live with empty content.
 *
 * Nothing pinned it: every other publish test asserts the end state of a publish that
 * SUCCEEDED, which is identical whichever order the writes went out in. Hoisting
 * publishProfile above the loop, or Promise.all-ing the loop around it, changed no test.
 *
 * A stub client rather than the database: order and partial failure are properties of the
 * call sequence, and the real DB can only show the end state, which is what hid this.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PUBLISHABLE, publishAll } from '@/lib/content'

type Row = Record<string, unknown>

/**
 * Minimal Supabase stand-in for the publish path: every content table holds exactly one
 * working row (so each type really does write a revision — with empty tables the ordering
 * question never arises), `revisions` starts empty, and every insert is recorded in call
 * order. `failOn` makes one entity type's insert fail, standing in for the partial failure
 * the ordering exists to survive.
 */
function stubClient(failOn?: string) {
  const writes: string[] = []
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
      then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, err),
      insert: async (payload: Row | Row[]) => {
        for (const r of Array.isArray(payload) ? payload : [payload]) {
          if (r.entity_type === failOn) return { error: { message: `${failOn} insert failed` } }
          writes.push(r.entity_type as string)
        }
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
  }
}

describe('publishAll ordering', () => {
  it('CRITICAL: the artist profile is the LAST entity_type written', async () => {
    const { client, writes } = stubClient()
    await publishAll(client, 'a1')

    expect(writes.at(-1)).toBe('artist')
    // Derived from the registry, so adding a publishable type extends this rather than
    // silently escaping the check.
    expect(writes.slice(0, -1)).toEqual(Object.keys(PUBLISHABLE))
  })

  it('CRITICAL: a content publish that fails leaves the profile UNpublished', async () => {
    // The reason for the order: an artist publishing for the first time must not end up
    // live-but-empty because the publish died before its content landed.
    const { client, writes } = stubClient('media')
    await expect(publishAll(client, 'a1')).rejects.toThrow('media insert failed')
    expect(writes).not.toContain('artist')
  })
})
