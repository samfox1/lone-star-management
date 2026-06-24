/**
 * PHASE 0 — preview parity: after a full publish, the manager preview
 * (getWorkingSite) matches the public site (getPublishedSite) for the profile +
 * media. Canary for the versioning refactor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishAll, publishProfile } from '@/lib/content'
import { getPublishedSite, getWorkingSite } from '@/lib/site'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const SEED_BIO = 'Dusty alt-country out of West Texas.'

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('media').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).in('entity_type', ['media', 'artist'])
  await svc.from('artists').update({ bio: SEED_BIO, template: 'classic' }).eq('id', artistA)
  await publishProfile(svc, artistA)
})

describe('preview == live after a full publish', () => {
  it('profile and media match between working (preview) and published (public)', async () => {
    await asA.from('artists').update({ bio: 'PARITY bio', template: 'classic' }).eq('id', artistA)
    await asA
      .from('media')
      .insert({ artist_id: artistA, purpose: 'profile_photo', storage_path: `${artistA}/profile/parity.jpg` })

    await publishAll(asA, artistA)

    const published = await getPublishedSite(anonClient(), SEED.artistASlug)
    const working = await getWorkingSite(asA, artistA)
    expect(published).not.toBeNull()

    expect(working!.artist).toEqual(published!.artist)
    expect(working!.media).toEqual(published!.media)
  })
})
