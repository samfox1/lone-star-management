/**
 * PHASE 2 — an artist has exactly ONE catalog source. Switching source deletes
 * that artist's working tracks for the OLD importer source (manual always
 * preserved); the next publish tombstones the old source's live revisions, so no
 * stale imported tracks linger on the public site.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { setCatalogSource } from '@/lib/catalog'
import { publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'track')
  await svc.from('artists').update({ catalog_source: 'manual' }).eq('id', artistA)
})

async function publicTrackTitles(): Promise<string[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { tracks?: { title: string }[] } | null)?.tracks ?? []).map((t) => t.title)
}

describe('catalog source switch', () => {
  it('CRITICAL: switching source deletes the old-source tracks, keeps manual', async () => {
    await svc.from('artists').update({ catalog_source: 'spotify' }).eq('id', artistA)
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'CAT spotify', source: 'spotify', spotify_id: 'sp1' },
      { artist_id: artistA, title: 'CAT manual', source: 'manual' },
    ])

    await setCatalogSource(asA, artistA, 'deezer')

    const { data: rows } = await svc.from('tracks').select('title').eq('artist_id', artistA)
    const titles = (rows ?? []).map((r) => r.title)
    expect(titles).toContain('CAT manual')
    expect(titles).not.toContain('CAT spotify')

    const { data: artist } = await svc.from('artists').select('catalog_source').eq('id', artistA).single()
    expect(artist!.catalog_source).toBe('deezer')
  })

  it('publishing after a switch tombstones the old-source live tracks', async () => {
    await svc.from('tracks').delete().eq('artist_id', artistA)
    await svc.from('artists').update({ catalog_source: 'spotify' }).eq('id', artistA)
    await svc
      .from('tracks')
      .insert({ artist_id: artistA, title: 'CAT pub spotify', source: 'spotify', spotify_id: 'sp2' })

    await publishContent(asA, 'track', artistA) // make it live
    expect(await publicTrackTitles()).toContain('CAT pub spotify')

    await setCatalogSource(asA, artistA, 'deezer') // deletes the working spotify track
    await publishContent(asA, 'track', artistA) // reconcile → tombstone
    expect(await publicTrackTitles()).not.toContain('CAT pub spotify')
  })

  it('publishes a Deezer track provider_url (link-out) to the public site', async () => {
    await svc.from('tracks').delete().eq('artist_id', artistA)
    await svc.from('artists').update({ catalog_source: 'deezer' }).eq('id', artistA)
    await svc.from('tracks').insert({
      artist_id: artistA,
      title: 'CAT dz link',
      source: 'deezer',
      deezer_id: 'dz9',
      provider_url: 'https://deezer.com/track/9',
    })
    await publishContent(asA, 'track', artistA)

    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const track = ((data as { tracks?: { title: string; provider_url?: string }[] } | null)?.tracks ?? []).find(
      (t) => t.title === 'CAT dz link',
    )
    expect(track?.provider_url).toBe('https://deezer.com/track/9')
  })

  it("CRITICAL: a manager cannot switch another tenant's catalog source", async () => {
    const { data: before } = await svc.from('artists').select('catalog_source').eq('id', artistB).single()
    await expect(setCatalogSource(asA, artistB, 'spotify')).rejects.toThrow()
    const { data: after } = await svc.from('artists').select('catalog_source').eq('id', artistB).single()
    expect(after!.catalog_source).toBe(before!.catalog_source)
  })
})
