/**
 * `reorder_rows(p_table, p_artist, p_ids)` — the editor's atomic renumber (20260713120000).
 *
 * This function is unusual enough to deserve its own file, and it had no test at all.
 *
 *  - It takes a TABLE NAME as a string and interpolates it into dynamic SQL. The only
 *    thing preventing an arbitrary table being renumbered is a four-entry allowlist.
 *  - It is SECURITY INVOKER, so the caller's RLS on the target table is the real guard;
 *    the `t.artist_id = $2` filter is belt-and-braces on top of it.
 *  - Postgres grants EXECUTE to PUBLIC by default and this migration only ADDED a grant
 *    to `authenticated` — it never revoked the default — so anon can call it too. That
 *    is safe ONLY because of the two guards above.
 *
 * The failure mode that makes this easy to get wrong: because the renumber is an UPDATE,
 * a caller with no rights simply matches zero rows. The RPC returns void and `error` is
 * null. A test written the obvious way ("expect(error).not.toBeNull()") would fail
 * against the CORRECT implementation, and a test that checks nothing would pass against a
 * broken one. sort_order read back through the service client is the only evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

const svc = serviceClient()

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient

/** B's two tracks, planted in a known order. */
let bFirst: string
let bSecond: string
const bTrackIds: string[] = []

async function bOrder(): Promise<Array<{ id: string; sort_order: number }>> {
  const { data } = await svc
    .from('tracks')
    .select('id, sort_order')
    .in('id', bTrackIds)
    .order('sort_order')
  return (data ?? []) as Array<{ id: string; sort_order: number }>
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  const { data, error } = await svc
    .from('tracks')
    .insert([
      { artist_id: artistB, title: 'ISO-ORDER B one', sort_order: 0 },
      { artist_id: artistB, title: 'ISO-ORDER B two', sort_order: 1 },
    ])
    .select('id, title')
  if (error || !data) throw error ?? new Error('seed B tracks failed')
  bFirst = data.find((t) => t.title === 'ISO-ORDER B one')!.id
  bSecond = data.find((t) => t.title === 'ISO-ORDER B two')!.id
  bTrackIds.push(bFirst, bSecond)
})

afterAll(async () => {
  if (bTrackIds.length) await svc.from('tracks').delete().in('id', bTrackIds)
})

describe('reorder_rows — the artist_id filter and the caller RLS', () => {
  it("the B fixture is in a known order to begin with", async () => {
    const order = await bOrder()
    expect(order.map((t) => t.id)).toEqual([bFirst, bSecond])
  })

  it("CRITICAL: manager A cannot reorder B's rows — and the refusal is SILENT", async () => {
    // Real ids, real artist, real table: everything about this call is valid except who
    // is making it. RLS on `tracks` scopes B's rows out of the UPDATE, so the statement
    // succeeds having matched nothing. Only sort_order can tell the two apart.
    const { error } = await asA.rpc('reorder_rows', {
      p_table: 'tracks',
      p_artist: artistB,
      p_ids: [bSecond, bFirst],
    })
    expect(error).toBeNull() // NOT a denial — do not mistake this for one

    const order = await bOrder()
    expect(order.map((t) => t.id), "manager A reordered another tenant's tracks").toEqual([
      bFirst,
      bSecond,
    ])
  })

  it("CRITICAL: anon can CALL it (PUBLIC execute) but still changes nothing", async () => {
    // The migration never revoked the default PUBLIC grant. That is only safe while the
    // function stays SECURITY INVOKER — flip it to DEFINER and this becomes an
    // unauthenticated write endpoint for four tables.
    const { error } = await anonClient().rpc('reorder_rows', {
      p_table: 'tracks',
      p_artist: artistB,
      p_ids: [bSecond, bFirst],
    })
    expect(error).toBeNull()

    const order = await bOrder()
    expect(order.map((t) => t.id), 'anon reordered a tenant’s tracks').toEqual([bFirst, bSecond])
  })

  it("the artist_id filter also holds when the CALLER owns the rows but names another tenant", async () => {
    // B owns these rows, so RLS lets them through; the only thing left to stop the
    // renumber is `t.artist_id = p_artist`. Passing A's id must therefore match nothing.
    const { error } = await asB.rpc('reorder_rows', {
      p_table: 'tracks',
      p_artist: artistA,
      p_ids: [bSecond, bFirst],
    })
    expect(error).toBeNull()

    const order = await bOrder()
    expect(order.map((t) => t.id), 'the artist_id filter is not being applied').toEqual([
      bFirst,
      bSecond,
    ])
  })

  it('the owning manager CAN reorder their own rows (so the tests above are not passing on a no-op)', async () => {
    // Without this, every assertion above would still pass if reorder_rows did nothing
    // at all, or had been dropped and recreated as a stub.
    const { error } = await asB.rpc('reorder_rows', {
      p_table: 'tracks',
      p_artist: artistB,
      p_ids: [bSecond, bFirst],
    })
    expect(error).toBeNull()

    const order = await bOrder()
    expect(order.map((t) => t.id)).toEqual([bSecond, bFirst])

    // Put it back, so the fixture's meaning is stable for anything that follows.
    await svc.from('tracks').update({ sort_order: 0 }).eq('id', bFirst)
    await svc.from('tracks').update({ sort_order: 1 }).eq('id', bSecond)
  })

  it('CRITICAL: the table allowlist rejects anything outside the four editor tables', async () => {
    // The table name is interpolated into dynamic SQL, so the allowlist is the only
    // thing standing between this RPC and `update artists set sort_order = ...`.
    for (const table of ['artists', 'profiles', 'artist_managers', 'revisions', 'enquiries']) {
      const { error } = await asB.rpc('reorder_rows', {
        p_table: table,
        p_artist: artistB,
        p_ids: bTrackIds,
      })
      expect(error, `reorder_rows accepted the table "${table}"`).not.toBeNull()
      expect(error?.message ?? '').toContain(`table ${table} not allowed`)
    }
  })
})
