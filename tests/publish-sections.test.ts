/**
 * PHASE 0 — per-section publish isolation: publishing one section does not
 * publish another section's pending edit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const SEED_BIO = 'Dusty alt-country out of West Texas.'
/** The track this file created. Teardown removes ONLY it: deleting every track for the
 *  artist on the shared live project erases whatever else is there and leaves the later
 *  music suites asserting over an empty catalog. */
let trackId: string | null = null

async function publicSite(): Promise<{ artist?: { bio?: string }; tracks?: { title: string }[] } | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return data as never
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (trackId) {
    await svc.from('tracks').delete().eq('id', trackId)
    await svc.from('revisions').delete().eq('entity_id', trackId)
  }
  // The profile is a singleton snapshot: restore the seed bio and republish so the artist
  // is left LIVE with the content that was there before.
  await svc.from('artists').update({ bio: SEED_BIO }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('per-section publish isolation', () => {
  it('CRITICAL: publishing tracks does not publish a pending profile edit', async () => {
    // Baseline published profile.
    await asA.from('artists').update({ bio: 'SECTIONS baseline bio' }).eq('id', artistA)
    await publishProfile(asA, artistA)

    // Pending profile edit (draft) + a new track.
    await asA.from('artists').update({ bio: 'SECTIONS draft bio' }).eq('id', artistA)
    // stream_url = platform presence, so the track is Released (shown by the public door).
    const track = await createContent(asA, 'track', artistA, { title: 'SECTIONS track', stream_url: 'https://open.spotify.com/track/sec' })
    trackId = track.id

    // Publish ONLY tracks.
    await publishContent(asA, 'track', artistA)
    let site = await publicSite()
    expect(site?.artist?.bio).toBe('SECTIONS baseline bio') // profile edit still pending
    expect((site?.tracks ?? []).map((t) => t.title)).toContain('SECTIONS track')

    // Now publish the profile.
    await publishProfile(asA, artistA)
    site = await publicSite()
    expect(site?.artist?.bio).toBe('SECTIONS draft bio')

    await deleteContent(asA, 'track', track.id)
  })
})
