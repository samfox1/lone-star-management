// Publishing one section never publishes another section's pending edit.
/**
 * PHASE 0 — per-section publish isolation: publishing one section does not
 * publish another section's pending edit.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). This file overwrites the artist's `bio`
 * twice and PUBLISHES the profile — on the shared seed artist that is a live site change,
 * and the teardown's answer was to write back a hard-coded string, `SEED_BIO`, copied from
 * the seed script. A teardown that has to GUESS the previous state is a teardown operating
 * on data the test does not own; if a human had edited that bio the run silently replaced
 * it with a months-old literal. `publishContent('track')` is catalog-wide on top of that,
 * so a run also published every unfinished song on the artist. Owned artist, no guessing:
 * the bio is whatever this file set, and nothing needs restoring because the artist goes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

async function publicSite(): Promise<{ artist?: { bio?: string }; tracks?: { title: string }[] } | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: tenantA.slug })
  return data as never
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Publish sections', asA)
  artistA = tenantA.id
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, tenantA)
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
