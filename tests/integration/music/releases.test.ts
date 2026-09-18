// The release type and its public smart-link page, read from the published snapshot.
/**
 * PHASE 5 (Releases) — the `release` content type + its public smart-link door.
 * A release publishes like content (entity_type='release'); the public landing
 * page reads the PUBLISHED release via get_release(artist_slug, release_slug) —
 * draft until published, gone when deleted+republished (tombstone).
 *
 * TENANCY, AND WHY THE ARTIST IS A THROWAWAY. This file used to run on the shared seed
 * artist `lone-pine` and tear down with
 *
 *     svc.from('releases').delete().eq('artist_id', artistA)
 *     svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'release')
 *
 * On the LIVE hosted project that is the artist's whole discography plus every release
 * snapshot ever published for it — deleted for the sake of one fixture EP. The publish
 * calls below make it worse in the other direction: `publishContent(…, 'release', …)`
 * snapshots EVERY release the artist has, so running this file committed whatever
 * unrelated release draft happened to be pending, then the teardown deleted the result.
 *
 * `lone-pine` currently reads empty for several tables because teardowns of this shape
 * have been running for months, which is also what made the first test's
 * `getRelease(...) toBeNull()` free: on an emptied artist there was nothing to find
 * whether or not the draft gate worked. The artist is created and dropped by this file
 * now, so the draft/publish/tombstone sequence is the only thing that can move it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let artist: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
let releaseId: string
const svc = serviceClient()

const RELEASE = {
  title: 'Midnight EP',
  slug: 'midnight-ep',
  cover_url: 'https://img/midnight.jpg',
  release_date: '2026-07-01',
  links: [
    { label: 'Spotify', url: 'https://open.spotify.com/album/x' },
    { label: 'Apple Music', url: 'https://music.apple.com/album/x' },
  ],
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'releases door', asA)
  artistA = artist.id
  const r = await createContent(asA, 'release', artistA, RELEASE)
  releaseId = r.id
})

afterAll(async () => {
  // Cascades the release and every revision the publishes wrote.
  await deleteThrowawayArtist(svc, artist)
})

async function getRelease(releaseSlug: string) {
  const { data } = await anonClient().rpc('get_release', {
    p_artist_slug: artist.slug,
    p_release_slug: releaseSlug,
  })
  return data as { title?: string; cover_url?: string; links?: { label: string; url: string }[] } | null
}

describe('release smart-link door', () => {
  it('CRITICAL: a release is a draft — get_release returns null until published', async () => {
    expect(await getRelease('midnight-ep')).toBeNull()
    await publishContent(asA, 'release', artistA)
    const pub = await getRelease('midnight-ep')
    expect(pub?.title).toBe('Midnight EP')
    expect(pub?.cover_url).toBe('https://img/midnight.jpg')
    expect(pub?.links).toEqual(RELEASE.links)
  })

  it('returns null for an unknown release slug', async () => {
    expect(await getRelease('no-such-release')).toBeNull()
  })

  it('a deleted + republished release is tombstoned off the smart link', async () => {
    // Publish + assert PRESENT inside this test. Relying on the first test to have
    // published made this pass for the wrong reason in isolation: the release had never
    // been published, so the smart link was already null before the delete and the
    // tombstone proved nothing.
    await publishContent(asA, 'release', artistA)
    expect(await getRelease('midnight-ep')).not.toBeNull()

    await deleteContent(asA, 'release', releaseId)
    await publishContent(asA, 'release', artistA)
    expect(await getRelease('midnight-ep')).toBeNull()
  })
})
