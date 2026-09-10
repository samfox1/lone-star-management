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
 *
 * LIVE-DB NOTE. This file used to `delete()` every analytics event for both seed artists
 * in beforeAll and again in afterAll, to guarantee an empty window. On the shared hosted
 * project that destroys real history and other suites' fixtures. It doesn't need to: the
 * cap counts a ONE-MINUTE window, so measuring the window first and filling the
 * remainder gives the same determinism without deleting anything. Teardown removes only
 * the ids this run created — including the ones record_event inserted, which are found
 * by diffing before/after rather than by artist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEED, anonClient, artistIdBySlug, serviceClient } from '@tests/helpers/supabase'
import { idsAddedSince, snapshotIds } from '@tests/helpers/rls'

/** Must match the cap in the migration. */
const CAP = 120

let artistA: string
let artistB: string
const svc = serviceClient()
const anon = anonClient()
/** Every row this file caused to exist, by id. Nothing else is ever deleted. */
const createdIds: (string | number)[] = []

/** Rows inside the cap's window — the same predicate record_event itself counts. */
async function windowCount(artistId: string): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await svc
    .from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', artistId)
    .gt('created_at', since)
  return count ?? 0
}

/** Seed n events inside the 1-minute window via the service role, which bypasses
 *  record_event — so building the fixture isn't itself subject to the cap. */
async function fillWindow(artistId: string, n: number) {
  if (n <= 0) return
  const rows = Array.from({ length: n }, () => ({ artist_id: artistId, type: 'view' }))
  const { data, error } = await svc.from('analytics_events').insert(rows).select('id')
  if (error) throw new Error(error.message)
  createdIds.push(...(data ?? []).map((r) => r.id))
}

/**
 * Call the door and record whatever row it inserted, so teardown stays exact and the
 * caller can tell "the door recorded" from "the door dropped" by row count, not by the
 * absence of an error (the cap never raises).
 */
async function recordEvent(slug: string, artistId: string): Promise<number> {
  const before = await snapshotIds(svc, 'analytics_events', { artist_id: artistId })
  const { error } = await anon.rpc('record_event', { p_slug: slug, p_type: 'view' })
  expect(error).toBeNull() // fire-and-forget: the fan's page must never see this
  const added = await idsAddedSince(svc, 'analytics_events', { artist_id: artistId }, before)
  createdIds.push(...added)
  return added.length
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
})

afterAll(async () => {
  if (createdIds.length) await svc.from('analytics_events').delete().in('id', createdIds)
})

describe('record_event — per-artist burst cap', () => {
  // These run in order and share the window: the first fills to CAP-1 and lands
  // the CAPth event; the second then finds the artist already at the cap.
  it('still records while the window is under the cap', async () => {
    const baseline = await windowCount(artistB)
    expect(
      baseline,
      'artist B is already at the cap before this test started — rerun; the window drains in a minute',
    ).toBeLessThan(CAP)
    await fillWindow(artistB, CAP - 1 - baseline)

    expect(await recordEvent(SEED.artistBSlug, artistB)).toBe(1)
    expect(await windowCount(artistB)).toBe(CAP)
  })

  it('silently drops once the artist is at the cap (no row, no error)', async () => {
    expect(await recordEvent(SEED.artistBSlug, artistB)).toBe(0)
    expect(await windowCount(artistB)).toBe(CAP)
  })

  it('caps per ARTIST, so a flooded artist cannot suppress another', async () => {
    // B is still at its cap from the test above; A is untouched and must record.
    const beforeA = await windowCount(artistA)
    expect(await recordEvent(SEED.artistASlug, artistA)).toBe(1)
    expect(await windowCount(artistA)).toBe(beforeA + 1)
    expect(await windowCount(artistB)).toBe(CAP)
  })
})
