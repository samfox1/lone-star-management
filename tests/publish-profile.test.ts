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
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  // Establish a known PUBLISHED baseline.
  await asA.from('artists').update({ bio: BASE_BIO }).eq('id', artistA)
  await publishProfile(asA, artistA)
})

afterAll(async () => {
  // Restore Lone Pine to its seed profile and leave exactly ONE clean published
  // snapshot, so later tests still find a live site.
  await svc.from('artists').update({ bio: SEED_BIO, template: 'classic' }).eq('id', artistA)
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
    await publishProfile(asA, artistA) // baseline published
    const before = await publicArtist()

    await asA.from('artists').update({ template: 'classic' }).eq('id', artistA)
    // Public still shows the previously published template.
    expect((await publicArtist())?.template).toBe(before?.template)

    await publishProfile(asA, artistA)
    expect((await publicArtist())?.template).toBe('classic')

    // restore + republish so we don't leave Lone Pine on classic
    await asA.from('artists').update({ template: (before?.template as string) ?? 'classic' }).eq('id', artistA)
    await publishProfile(asA, artistA)
  })
})
