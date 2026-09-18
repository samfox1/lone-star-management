// Publishing makes the live site match the working table, deletions included.
/**
 * MILESTONE 5 fix — publish reconcile (tombstones) + ordering parity.
 *
 * Publishing makes the live site match the working table. Deleting a working
 * row and re-publishing must pull it off the public site (a tombstone hides the
 * stale snapshot). And published order must match the dashboard/preview order.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The track ids were already tracked and
 * deleted individually, which is the right shape for rows. It does nothing about the real
 * hazard: `publishContent(asA, 'track', artistA)` snapshots the artist's ENTIRE catalog, so
 * run against the shared seed artist this file published every unfinished song sitting in
 * that dashboard to the live site, three times, as a side effect. The ordering test is the
 * clearer case — it needs to control what is published and in what order, which is not
 * something you can do on a catalog other suites and a human are also writing to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type ContentRow, createContent, deleteContent, publicSnapshot, publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

async function publicTracks(): Promise<{ title: string }[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  return ((data as { tracks?: { title: string }[] })?.tracks ?? [])
}

async function seedTrack(input: Record<string, unknown>): Promise<ContentRow> {
  return createContent(asA, 'track', artistA, input)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Publish reconcile', asA)
  artistA = tenantA.id
  // Without a published `artist` revision the door returns NULL, `publicTracks()` is `[]`,
  // and every `not.toContain(...)` below passes with reconcile deleted.
  await publishProfile(svc, artistA)
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  expect(data, 'get_public_site must answer for the throwaway artist').not.toBeNull()
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
})

describe('publish reconcile (tombstone)', () => {
  it('CRITICAL: a deleted + re-published entity drops off the live site', async () => {
    const title = 'RECON track to delete'
    // stream_url = platform presence, so the track is Released (shown by the public door).
    const track = await seedTrack({ title, stream_url: 'https://open.spotify.com/track/rec' })

    await publishContent(asA, 'track', artistA)
    expect((await publicTracks()).map((t) => t.title)).toContain(title)

    // Delete the working row, then re-publish — reconcile writes a tombstone.
    await deleteContent(asA, 'track', track.id)
    await publishContent(asA, 'track', artistA)

    expect((await publicTracks()).map((t) => t.title)).not.toContain(title)
  })
})

describe('publish ordering parity', () => {
  /** Publish ONE row, on its own, and return the revision's published_at. publishContent
   *  snapshots every working row in a single insert, so it can only ever produce revisions
   *  that share a timestamp — it cannot express "published earlier than". */
  async function publishOne(row: ContentRow): Promise<string> {
    const { data, error } = await svc
      .from('revisions')
      .insert({
        artist_id: artistA,
        entity_type: 'track',
        entity_id: row.id,
        data: publicSnapshot('track', row),
      })
      .select('published_at')
      .single()
    if (error) throw new Error(error.message)
    return data!.published_at as string
  }

  it('CRITICAL: public tracks come back in sort_order, NOT in the order they were published', async () => {
    // The door orders by (data->>'sort_order')::int, then published_at. Publishing in
    // sort_order makes both keys agree, so deleting the sort_order key passes — or flakes
    // on the tie — instead of failing. Here the publish order CONTRADICTS sort_order, so
    // the expected result is reachable only through the door's ORDER BY.
    const last = await seedTrack({ title: 'RECON ord LAST', sort_order: 5, stream_url: 'https://open.spotify.com/track/r5' })
    const first = await seedTrack({ title: 'RECON ord FIRST', sort_order: 1, stream_url: 'https://open.spotify.com/track/r1' })

    const lastAt = await publishOne(last) // sort_order 5, published FIRST
    const firstAt = await publishOne(first) // sort_order 1, published LAST
    expect(lastAt < firstAt).toBe(true) // the contradiction is real, not assumed

    const titles = (await publicTracks()).map((t) => t.title)
    const firstIdx = titles.indexOf('RECON ord FIRST')
    const lastIdx = titles.indexOf('RECON ord LAST')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(lastIdx).toBeGreaterThan(firstIdx)
  })
})
