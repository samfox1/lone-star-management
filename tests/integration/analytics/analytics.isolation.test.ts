// Fans record events only through one guarded door; nobody can insert rows or read another
//   artist's.
/**
 * The secure ingest gate. Nobody can insert an analytics row directly, and an owner reads
 * only their own events.
 *
 * The INGEST side moved (2026-09-12): fans reach `POST /functions/v1/event`, which calls
 * `record_site_event` with the service key, and the old anon `record_event` is gone. That
 * the door accepts an anonymous fan and lands a row is
 * tests/integration/analytics/event-door.test.ts; what this file still owns is the part no
 * door can grant — the table itself refuses a direct write from anyone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { deleteAddedSince, expectDeniedByMissingPolicy, snapshotIds } from '@tests/helpers/rls'

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
  it('an event recorded for A is readable by A', async () => {
    await svc.rpc('record_site_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    const { data } = await asA.from('analytics_events').select('type').eq('artist_id', artistA)
    expect((data ?? []).some((e) => e.type === 'view')).toBe(true)
  })

  it("CRITICAL: A cannot READ B's analytics events", async () => {
    // Plant on B and PROVE the plant landed before asserting the denial. record_site_event
    // is built to fail silently — an unknown slug, an unknown type, and the burst cap all
    // return without error — so an unchecked plant can leave B's table empty, and "A reads
    // zero rows" over an empty table is not evidence of anything.
    await svc.rpc('record_site_event', { p_slug: SEED.artistBSlug, p_type: 'view' })
    const { data: planted } = await svc
      .from('analytics_events')
      .select('id')
      .eq('artist_id', artistB)
    expect(
      (planted ?? []).length,
      'record_site_event planted nothing on B — the denial below would be vacuous',
    ).toBeGreaterThan(0)

    const { data } = await asA.from('analytics_events').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: nobody can INSERT events directly (only the door, through record_site_event)', async () => {
    // analytics_events has a read policy and NO write policy at all, while anon and
    // authenticated both still hold the stock table-level INSERT grant. The missing
    // policy is the entire control, so pin that that is what refuses the row.
    const asAInsert = await asA.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expectDeniedByMissingPolicy(asAInsert.error, 'a manager inserting an analytics event')
    const anonInsert = await anon.from('analytics_events').insert({ artist_id: artistA, type: 'view' })
    expectDeniedByMissingPolicy(anonInsert.error, 'anon inserting an analytics event')
  })
})
