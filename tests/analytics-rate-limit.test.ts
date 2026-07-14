/**
 * record_event burst cap (20260714140000).
 *
 * `record_event` is the anon ingest door, so a bot can flood it. The cap bounds
 * how many rows one artist can accrete per minute. It is NOT per-IP limiting — a
 * DB function can't see the client IP; that belongs at the edge. What this buys
 * is a ceiling on storage growth.
 *
 * The cap DROPS SILENTLY rather than raising: record_event is fire-and-forget
 * telemetry called from a fan's page, and an exception would surface there.
 * That matches how the door already swallows an unknown type / unknown slug.
 *
 * Uses artist B so the fixture can't skew the counts the analytics.test.ts suite
 * asserts on artist A.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEED, anonClient, artistIdBySlug, serviceClient } from './helpers/supabase'

/** Must match the cap in the migration. */
const CAP = 120

let artistA: string
let artistB: string
const svc = serviceClient()
const anon = anonClient()

async function countFor(artistId: string): Promise<number> {
  const { count } = await svc
    .from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', artistId)
  return count ?? 0
}

/** Seed n events inside the 1-minute window via the service role, which bypasses
 *  record_event — so building the fixture isn't itself subject to the cap. */
async function fillWindow(artistId: string, n: number) {
  const rows = Array.from({ length: n }, () => ({ artist_id: artistId, type: 'view' }))
  const { error } = await svc.from('analytics_events').insert(rows)
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  await svc.from('analytics_events').delete().eq('artist_id', artistA)
  await svc.from('analytics_events').delete().eq('artist_id', artistB)
})

afterAll(async () => {
  await svc.from('analytics_events').delete().eq('artist_id', artistA)
  await svc.from('analytics_events').delete().eq('artist_id', artistB)
})

describe('record_event — per-artist burst cap', () => {
  // These run in order and share the window: the first fills to CAP-1 and lands
  // the CAPth event; the second then finds the artist already at the cap.
  it('still records while the window is under the cap', async () => {
    await fillWindow(artistB, CAP - 1)
    const { error } = await anon.rpc('record_event', { p_slug: SEED.artistBSlug, p_type: 'view' })
    expect(error).toBeNull()
    expect(await countFor(artistB)).toBe(CAP)
  })

  it('silently drops once the artist is at the cap (no row, no error)', async () => {
    const { error } = await anon.rpc('record_event', { p_slug: SEED.artistBSlug, p_type: 'view' })
    expect(error).toBeNull() // fire-and-forget: the fan's page must never see this
    expect(await countFor(artistB)).toBe(CAP)
  })

  it('caps per ARTIST, so a flooded artist cannot suppress another', async () => {
    // B is still at its cap from the test above; A is untouched and must record.
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    expect(await countFor(artistA)).toBe(1)
    expect(await countFor(artistB)).toBe(CAP)
  })
})
