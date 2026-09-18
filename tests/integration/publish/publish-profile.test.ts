// The artist profile is draft until published; name, bio, hero and template version together.
/**
 * PHASE 0 — the artist profile is draft → publish (not live).
 *
 * Decision: name/bio/hero/template/spotify_artist_id all version together as one
 * `entity_type='artist'` snapshot; the public site reads the PUBLISHED snapshot,
 * preview reads the working (live) row.
 *
 * This starts RED: today get_public_site reads the live artists row, so editing
 * the bio changes the public site immediately. After the versioning refactor
 * (migration + publishProfile), it must wait for publish.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishProfile } from '@/lib/content'
import { getWorkingSite } from '@/lib/site'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

/**
 * WHY THE ARTIST IS A THROWAWAY (2026-09-18). This file used to run on the shared seed
 * artist, and it is not a reader: it overwrites `bio`, `template` and
 * `spotify_artist_id` on the live row, deletes EVERY `entity_type='artist'` revision the
 * artist has ever had — its whole profile publish history — and republishes one snapshot
 * of its own. It even does that mid-suite, to prove an unpublished profile is not live.
 *
 * None of that can be scoped to "rows this test created", because the rows it destroys
 * are precisely the ones it did not create. The restore-what-was-there scaffolding it
 * carried (snapshot `template`/`spotify_artist_id`, put back a hard-coded seed bio) is
 * the tell: a teardown that has to GUESS the previous state is a teardown operating on
 * someone else's data. An artist this file owns needs none of it, and the deletions
 * below say exactly what they mean.
 */
let artist: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

const BASE_BIO = 'PUBLISH-PROFILE baseline (published)'
const DRAFT_BIO = 'PUBLISH-PROFILE draft (not yet published)'

async function publicArtist(): Promise<Record<string, unknown> | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
  return (data as { artist?: Record<string, unknown> } | null)?.artist ?? null
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'Publish profile', asA)
  artistA = artist.id
  // Establish a known PUBLISHED baseline.
  await asA.from('artists').update({ bio: BASE_BIO }).eq('id', artistA)
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  // Cascades the artist's rows and every revision hung off it.
  await deleteThrowawayArtist(svc, artist)
})

describe('profile is draft until published', () => {
  it('CRITICAL: editing the bio does NOT change the public site until publish', async () => {
    expect((await publicArtist())?.bio).toBe(BASE_BIO)

    // Edit = draft on the working row.
    await asA.from('artists').update({ bio: DRAFT_BIO }).eq('id', artistA)

    // Public site is unchanged (still the published baseline).
    expect((await publicArtist())?.bio).toBe(BASE_BIO)

    // Publish the profile.
    await publishProfile(asA, artistA)

    // Now it's live.
    expect((await publicArtist())?.bio).toBe(DRAFT_BIO)
  })

  it('CRITICAL: an artist with no published profile is not live (get_public_site null)', async () => {
    await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'artist')
    const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
    expect(data).toBeNull()
    // re-establish a published profile for the remaining tests.
    await publishProfile(asA, artistA)
  })

  it('preview shows the unpublished draft; public shows the last published', async () => {
    const previewOnly = 'PUBLISH-PROFILE preview-only'
    await asA.from('artists').update({ bio: previewOnly }).eq('id', artistA)

    const working = await getWorkingSite(asA, artistA)
    expect(working?.artist.bio).toBe(previewOnly)
    expect((await publicArtist())?.bio).not.toBe(previewOnly)
  })

  it('CRITICAL: template + spotify_artist_id also wait for publish', async () => {
    // Both drafted values must DIFFER from what is published, or the assertions hold even
    // with profile versioning deleted and the door reading the live artists row. The
    // baseline is written explicitly for the same reason: "publish what is already there,
    // then assert it is there" proves nothing.
    await asA
      .from('artists')
      .update({ template: 'classic', spotify_artist_id: 'PROFILE-published-id' })
      .eq('id', artistA)
    await publishProfile(asA, artistA)

    await asA
      .from('artists')
      .update({ template: 'cinematic', spotify_artist_id: 'PROFILE-draft-id' })
      .eq('id', artistA)

    // Public still shows the PUBLISHED pair, not the draft.
    const stale = await publicArtist()
    expect(stale?.template).toBe('classic')
    expect(stale?.spotify_artist_id).toBe('PROFILE-published-id')

    await publishProfile(asA, artistA)
    const live = await publicArtist()
    expect(live?.template).toBe('cinematic')
    expect(live?.spotify_artist_id).toBe('PROFILE-draft-id')

  })
})
