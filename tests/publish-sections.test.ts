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

async function publicSite(): Promise<{ artist?: { bio?: string }; tracks?: { title: string }[] } | null> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return data as never
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).in('entity_type', ['track', 'artist'])
  await svc.from('artists').update({ bio: SEED_BIO, template: 'classic' }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('per-section publish isolation', () => {
  it('CRITICAL: publishing tracks does not publish a pending profile edit', async () => {
    // Baseline published profile.
    await asA.from('artists').update({ bio: 'SECTIONS baseline bio' }).eq('id', artistA)
    await publishProfile(asA, artistA)

    // Pending profile edit (draft) + a new track.
    await asA.from('artists').update({ bio: 'SECTIONS draft bio' }).eq('id', artistA)
    const track = await createContent(asA, 'track', artistA, { title: 'SECTIONS track' })

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
