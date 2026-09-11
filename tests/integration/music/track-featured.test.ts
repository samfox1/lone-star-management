// Writing a song's collaborators, against the real database: cleaned, capped, tenant-scoped.
/**
 * setTrackFeatured — the song modal's Featuring row (Sam, 2026-09-11: "where do we put
 * collaborators?"). Names are trimmed, blanks dropped, duplicates collapsed, capped at
 * 20; the write is scoped to the caller's tenant (a planted witness on the other artist
 * stays untouched); and the list rides the snapshot to the public door as "feat. …".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, setTrackFeatured } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
let id: string
const svc = serviceClient()
const TITLE = 'M4 featured song'

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  const row = await createContent(asA, 'track', artistA, { title: TITLE, stream_url: 'https://open.spotify.com/track/feat' })
  id = row.id as string
})

afterAll(async () => {
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', id)
  await svc.from('tracks').delete().eq('id', id)
})

const read = async () => (await asA.from('tracks').select('featured_artists').eq('id', id).single()).data?.featured_artists

describe('setTrackFeatured', () => {
  it('writes the names as given, in order', async () => {
    expect(await setTrackFeatured(asA, artistA, id, ['Arlo', 'Crosby, Stills & Nash'])).toEqual(['Arlo', 'Crosby, Stills & Nash'])
    expect(await read()).toEqual(['Arlo', 'Crosby, Stills & Nash'])
  })

  it('trims, drops blanks, dedupes, and caps at 20', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `Act ${i}`)
    const saved = await setTrackFeatured(asA, artistA, id, ['  Arlo ', '', 'Arlo', ...many])
    expect(saved[0]).toBe('Arlo')
    expect(saved).toHaveLength(20)
    expect(new Set(saved).size).toBe(20)
  })

  it('an empty list clears them', async () => {
    expect(await setTrackFeatured(asA, artistA, id, [])).toEqual([])
    expect(await read()).toEqual([])
  })

  it('CRITICAL: rides the snapshot to the public door as the song’s featured_artists', async () => {
    await setTrackFeatured(asA, artistA, id, ['Arlo'])
    await publishContent(asA, 'track', artistA)
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const song = (data as { tracks: { id: string; featured_artists?: string[] }[] }).tracks.find((t) => t.id === id)
    expect(song?.featured_artists).toEqual(['Arlo'])
  })

  it("CRITICAL: cannot write another tenant's song", async () => {
    const { data: planted } = await svc
      .from('tracks')
      .insert({ artist_id: artistB, title: 'B witness', featured_artists: ['Keep Me'] })
      .select('id')
      .single()
    try {
      await expect(setTrackFeatured(asA, artistB, planted!.id, ['Hijack'])).rejects.toThrow()
      const { data } = await svc.from('tracks').select('featured_artists').eq('id', planted!.id).single()
      expect(data?.featured_artists).toEqual(['Keep Me'])
    } finally {
      await svc.from('tracks').delete().eq('id', planted!.id)
    }
  })
})
