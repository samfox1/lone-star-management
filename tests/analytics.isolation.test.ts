/**
 * PHASE 5 (Analytics) — the secure ingest gate. Anon fans record events ONLY
 * through record_event (a SECURITY DEFINER door that resolves the artist from
 * the slug); nobody can insert arbitrary rows, and an owner can read only their
 * own events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { deleteAddedSince, expectDeniedByMissingPolicy, snapshotIds } from './helpers/rls'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()
const anon = anonClient()

// Ids that already existed when this file started. Teardown removes the difference and
// nothing else: this is the LIVE project, and `delete().eq('artist_id', ...)` would take
// out rows other suites (and other people) are relying on.
let beforeA: Set<string | number> | undefined
let beforeB: Set<string | number> | undefined

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  beforeA = await snapshotIds(svc, 'analytics_events', { artist_id: artistA })
  beforeB = await snapshotIds(svc, 'analytics_events', { artist_id: artistB })
})

afterAll(async () => {
  await deleteAddedSince(svc, 'analytics_events', { artist_id: artistA }, beforeA)
  await deleteAddedSince(svc, 'analytics_events', { artist_id: artistB }, beforeB)
})

describe('analytics ingest + isolation', () => {
  it('anon records an event via record_event; the owner can read it', async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    const { data } = await asA.from('analytics_events').select('type').eq('artist_id', artistA)
    expect((data ?? []).some((e) => e.type === 'view')).toBe(true)
  })

  it("CRITICAL: A cannot READ B's analytics events", async () => {
    // Plant on B and PROVE the plant landed before asserting the denial. record_event is
    // built to fail silently — an unknown slug, an unknown type, and the 120/min burst
    // cap all return null with no error — so an unchecked plant can leave B's table
    // empty, and "A reads zero rows" over an empty table is not evidence of anything.
    await anon.rpc('record_event', { p_slug: SEED.artistBSlug, p_type: 'view' })
    const { data: planted } = await svc
      .from('analytics_events')
      .select('id')
      .eq('artist_id', artistB)
    expect(
      (planted ?? []).length,
      'record_event planted nothing on B — the denial below would be vacuous',
    ).toBeGreaterThan(0)

    const { data } = await asA.from('analytics_events').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: nobody can INSERT events directly (only via record_event)', async () => {
    // analytics_events has a read policy and NO write policy at all, while anon and
    // authenticated both still hold the stock table-level INSERT grant. The missing
    // policy is the entire control, so pin that that is what refuses the row.
    const asAInsert = await asA.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expectDeniedByMissingPolicy(asAInsert.error, 'a manager inserting an analytics event')
    const anonInsert = await anon.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expectDeniedByMissingPolicy(anonInsert.error, 'anon inserting an analytics event')
  })
})
