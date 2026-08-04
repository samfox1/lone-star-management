/**
 * Brand assets in the database: the two logos and the derived favicon.
 *
 * They are `media` rows on purpose — `profile_photo` already established the shape
 * (single occupancy per purpose, replace by vacate-then-insert), so publishing, storage
 * GC and the public payload all work without a new mechanism. What this file pins is the
 * part that is genuinely new: three purposes the CHECK constraint has to accept, single
 * occupancy actually holding, and the FRAMING staying out of published content.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_FRAMING, loadFraming, saveFraming, setBrandAsset } from '@/lib/brand'
import { publishContent, publishProfile } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

/** A path in exactly the shape `buildStoragePath` produces — `setBrandAsset` now
 *  rejects anything else, because the path arrives from the client. */
const path = (seed: string) =>
  `${artistA}/brand/${seed.replace(/[^a-f0-9]/g, '0').padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000.png`

async function mediaRows(purpose: string) {
  const { data } = await svc.from('media').select('id, storage_path').eq('artist_id', artistA).eq('purpose', purpose)
  return data ?? []
}

async function publicMedia(): Promise<{ purpose: string; path: string }[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { media?: { purpose: string; path: string }[] } | null)?.media ?? [])
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  for (const p of ['logo_primary', 'logo_secondary', 'favicon']) {
    await svc.from('media').delete().eq('artist_id', artistA).eq('purpose', p)
  }
  await svc.from('artists').update({ favicon_zoom: null, favicon_offset_y: null }).eq('id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'media')
  await publishProfile(svc, artistA)
})

describe('brand assets are media rows', () => {
  it('CRITICAL: the three brand purposes are accepted by the database', async () => {
    for (const purpose of ['logo_primary', 'logo_secondary', 'favicon'] as const) {
      const res = await setBrandAsset(asA, artistA, purpose, path(purpose))
      expect(res.ok, `${purpose}: ${res.error}`).toBe(true)
    }
  })

  it('CRITICAL: single occupancy — replacing a logo leaves exactly one row', async () => {
    await setBrandAsset(asA, artistA, 'logo_primary', path('first'))
    await setBrandAsset(asA, artistA, 'logo_primary', path('second'))
    const rows = await mediaRows('logo_primary')
    expect(rows).toHaveLength(1)
    expect(rows[0].storage_path).toBe(path('second'))
  })

  it('clearing a logo removes the row rather than storing an empty one', async () => {
    await setBrandAsset(asA, artistA, 'logo_secondary', path('sec'))
    await setBrandAsset(asA, artistA, 'logo_secondary', null)
    expect(await mediaRows('logo_secondary')).toHaveLength(0)
  })

  it('replacing the primary logo does NOT touch the secondary', async () => {
    await setBrandAsset(asA, artistA, 'logo_primary', path('p1'))
    await setBrandAsset(asA, artistA, 'logo_secondary', path('s1'))
    await setBrandAsset(asA, artistA, 'logo_primary', path('p2'))
    expect((await mediaRows('logo_secondary'))[0]?.storage_path).toBe(path('s1'))
  })

  it('a logo is not public until media is published', async () => {
    await setBrandAsset(asA, artistA, 'logo_primary', path('gated'))
    expect((await publicMedia()).find((m) => m.path === path('gated'))).toBeUndefined()
    await publishContent(asA, 'media', artistA)
    expect((await publicMedia()).find((m) => m.path === path('gated'))?.purpose).toBe('logo_primary')
  })
})

describe('favicon framing is CONFIG, not published content', () => {
  it('defaults to the whole logo, centred, when nothing is stored', async () => {
    expect(await loadFraming(asA, artistA)).toEqual(DEFAULT_FRAMING)
  })

  it('round-trips a saved framing', async () => {
    await saveFraming(asA, artistA, { zoom: 2.5, offsetY: -0.3 })
    expect(await loadFraming(asA, artistA)).toEqual({ zoom: 2.5, offsetY: -0.3 })
  })

  it('clamps on the way in, so a bad value can never reach the canvas', async () => {
    await saveFraming(asA, artistA, { zoom: 99, offsetY: 42 })
    const framing = await loadFraming(asA, artistA)
    expect(framing.zoom).toBeLessThanOrEqual(6)
    expect(framing.offsetY).toBeLessThanOrEqual(1)
  })

  it('CRITICAL: framing never reaches the public site payload', async () => {
    // The derived favicon publishes as a media row; the numbers exist only so reopening
    // the Brand page restores the controls. Publishing them would grow every site
    // payload for something no visitor can use.
    await saveFraming(asA, artistA, { zoom: 2, offsetY: 0.1 })
    await publishProfile(asA, artistA)
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const artist = (data as { artist?: Record<string, unknown> } | null)?.artist ?? {}
    expect(Object.keys(artist)).not.toContain('favicon_zoom')
    expect(Object.keys(artist)).not.toContain('favicon_offset_y')
  })
})
