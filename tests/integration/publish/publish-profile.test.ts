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
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

const SEED_BIO = 'Dusty alt-country out of West Texas.' // Lone Pine's seed bio
const BASE_BIO = 'PUBLISH-PROFILE baseline (published)'
const DRAFT_BIO = 'PUBLISH-PROFILE draft (not yet published)'

async function publicArtist(): Promise<Record<string, unknown> | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as { artist?: Record<string, unknown> } | null)?.artist ?? null
}

/** Lone Pine's profile as this file found it — the tests overwrite versioned columns on
 *  the shared live project, so teardown puts back what was there rather than a guess. */
let original: Record<string, unknown> = {}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  const { data } = await svc.from('artists').select('template, spotify_artist_id').eq('id', artistA).single()
  original = (data ?? {}) as Record<string, unknown>
  // Establish a known PUBLISHED baseline.
  await asA.from('artists').update({ bio: BASE_BIO }).eq('id', artistA)
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  // Restore Lone Pine to its seed profile and leave exactly ONE clean published
  // snapshot, so later tests still find a live site.
  await svc.from('artists').update({ bio: SEED_BIO, ...original }).eq('id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'artist')
  await publishProfile(svc, artistA)
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
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
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

    // restore + republish so we don't leave Lone Pine on another template or a fake id
    await asA.from('artists').update(original).eq('id', artistA)
    await publishProfile(asA, artistA)
  })
})
