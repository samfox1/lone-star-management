/**
 * PHASE 5 (Releases) — the `release` content type + its public smart-link door.
 * A release publishes like content (entity_type='release'); the public landing
 * page reads the PUBLISHED release via get_release(artist_slug, release_slug) —
 * draft until published, gone when deleted+republished (tombstone).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  const r = await createContent(asA, 'release', artistA, RELEASE)
  releaseId = r.id
})

afterAll(async () => {
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'release')
})

async function getRelease(releaseSlug: string) {
  const { data } = await anonClient().rpc('get_release', {
    p_artist_slug: SEED.artistASlug,
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
