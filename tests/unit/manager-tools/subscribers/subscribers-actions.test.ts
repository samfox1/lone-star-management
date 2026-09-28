// removeSubscriberAction: ownership FIRST, and a row RLS filtered out is an error, never a
//   silent success (AGENTS.md rule 3). Over a fake PostgREST client — no database.
/**
 * The one write door subscribers/actions.ts opens, `removeSubscriberAction` (Sam,
 * 2026-09-28: "a manager can remove a subscriber"). Two promises pinned here without a
 * live database:
 *
 *   1. `requireOwnedArtist` runs BEFORE the delete — a signed-out caller or a caller who
 *      does not manage this artist never reaches the `subscribers` table at all.
 *   2. A delete that matched zero rows (the `subscribers_delete` RLS policy row-filtered a
 *      stranger's request, or the row was already gone) comes back as `{ error }`, not `{}`
 *      — `error: null` over zero rows is exactly what RLS hands back for a blocked write.
 *
 * The live RLS policy itself (a manager of a DIFFERENT artist, anon, the owner) is
 * tests/integration/auth/subscribers.isolation.test.ts, against the real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = 'select' | 'delete'
type Call = { table: string; op: Op; eq: [string, unknown][]; selected: boolean }

type World = {
  user: { id: string } | null
  artist: { id: string } | null
  /** What the `subscribers` delete answers. */
  deleteReply: { data?: unknown; error?: { message: string } | null }
}

let world: World
let calls: Call[]

function fakeClient() {
  const from = (table: string) => {
    const call: Call = { table, op: 'select', eq: [], selected: false }
    const chain = {
      select() {
        call.selected = true
        return chain
      },
      delete() {
        call.op = 'delete'
        return chain
      },
      eq(col: string, v: unknown) {
        call.eq.push([col, v])
        return chain
      },
      single() {
        return chain
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        calls.push(call)
        if (table === 'artists') return Promise.resolve({ data: world.artist, error: null }).then(ok, bad)
        // subscribers: a write returns rows only when `.select()` was chained, like real
        // PostgREST — an action that forgot `.select` must not read a false success.
        const data = call.op === 'delete' && !call.selected ? null : (world.deleteReply.data ?? null)
        return Promise.resolve({ data, error: world.deleteReply.error ?? null }).then(ok, bad)
      },
    }
    return chain
  }
  return { auth: { getUser: async () => ({ data: { user: world.user } }) }, from }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() as any }))

import { revalidatePath } from 'next/cache'
import { removeSubscriberAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/subscribers/actions'

const subscriberCalls = () => calls.filter((c) => c.table === 'subscribers')

beforeEach(() => {
  calls = []
  world = { user: { id: 'u1' }, artist: { id: 'a1' }, deleteReply: { data: [{ id: 's1' }] } }
  vi.mocked(revalidatePath).mockClear()
})

describe('removeSubscriberAction', () => {
  it('CRITICAL: refuses a signed-out caller before touching subscribers', async () => {
    world.user = null
    const res = await removeSubscriberAction('a1', 's1')
    expect(res).toEqual({ error: 'Not signed in.' })
    expect(subscriberCalls()).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('CRITICAL: refuses a caller who does not manage this artist, before touching subscribers', async () => {
    world.artist = null
    const res = await removeSubscriberAction('a1', 's1')
    expect(res).toEqual({ error: 'Artist not found.' })
    expect(subscriberCalls()).toEqual([])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('CRITICAL: a zero-row delete (RLS-filtered, or already gone) is an error, never a success', async () => {
    world.deleteReply = { data: [] }
    const res = await removeSubscriberAction('a1', 's1')
    expect(res).toEqual({ error: 'That subscriber is no longer there.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('a database error is reported, not thrown', async () => {
    world.deleteReply = { error: { message: 'boom' } }
    const res = await removeSubscriberAction('a1', 's1')
    expect(res).toEqual({ error: 'Could not remove that subscriber.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('CRITICAL: an owner removing their own subscriber succeeds, scoped by id AND artist_id, and revalidates', async () => {
    const res = await removeSubscriberAction('a1', 's1')
    expect(res).toEqual({})
    const del = subscriberCalls()[0]
    expect(del.op).toBe('delete')
    expect(del.eq).toEqual([
      ['id', 's1'],
      ['artist_id', 'a1'],
    ])
    expect(del.selected).toBe(true)
    expect(revalidatePath).toHaveBeenCalledWith('/artists/a1', 'layout')
  })

  it('ownership is checked BEFORE the delete', async () => {
    await removeSubscriberAction('a1', 's1')
    const gate = calls.findIndex((c) => c.table === 'artists')
    const del = calls.findIndex((c) => c.table === 'subscribers')
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(del).toBeGreaterThan(gate)
  })
})
