/**
 * MILESTONE 5 fix — publish reconcile (tombstones) + ordering parity.
 *
 * Publishing makes the live site match the working table. Deleting a working
 * row and re-publishing must pull it off the public site (a tombstone hides the
 * stale snapshot). And published order must match the dashboard/preview order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

async function publicTracks(): Promise<{ title: string }[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { tracks?: { title: string }[] })?.tracks ?? [])
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('revisions').delete().eq('artist_id', artistA)
    .in('entity_type', ['track', 'tour_date', 'merch', 'link'])
  await svc.from('tracks').delete().eq('artist_id', artistA)
})

describe('publish reconcile (tombstone)', () => {
  it('CRITICAL: a deleted + re-published entity drops off the live site', async () => {
    const title = 'RECON track to delete'
    // stream_url = platform presence, so the track is Released (public-door visible).
    const track = await createContent(asA, 'track', artistA, { title, stream_url: 'https://open.spotify.com/track/rec' })

    await publishContent(asA, 'track', artistA)
    expect((await publicTracks()).map((t) => t.title)).toContain(title)

    // Delete the working row, then re-publish — reconcile writes a tombstone.
    await deleteContent(asA, 'track', track.id)
    await publishContent(asA, 'track', artistA)

    expect((await publicTracks()).map((t) => t.title)).not.toContain(title)
  })
})

describe('publish ordering parity', () => {
  it('public tracks come back ordered by sort_order, like the dashboard', async () => {
    // stream_url on both: only Released tracks reach the public door.
    await createContent(asA, 'track', artistA, { title: 'RECON ord LAST', sort_order: 5, stream_url: 'https://open.spotify.com/track/r5' })
    await createContent(asA, 'track', artistA, { title: 'RECON ord FIRST', sort_order: 1, stream_url: 'https://open.spotify.com/track/r1' })
    await publishContent(asA, 'track', artistA)

    const titles = (await publicTracks()).map((t) => t.title)
    const first = titles.indexOf('RECON ord FIRST')
    const last = titles.indexOf('RECON ord LAST')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(last).toBeGreaterThan(first)
  })
})
