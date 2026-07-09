/**
 * PHASE 2 — Deezer track sync (real DB). Same conflict policy as Spotify: insert
 * new, refresh deezer-owned, never clobber manual; RLS-scoped to the caller's
 * artist. Deezer rows carry a provider_url link-out and no stream_url.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncDeezerTracks } from '@/lib/sync'
import type { DeezerTrackInput } from '@/lib/deezer'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('tracks').delete().eq('artist_id', artistB)
})

const dz = (id: string, title: string): DeezerTrackInput => ({
  deezer_id: id,
  title,
  cover_url: `https://img/${id}.jpg`,
  provider_url: `https://deezer.com/track/${id}`,
  duration_ms: null,
})

describe('syncDeezerTracks', () => {
  it('inserts new, refreshes deezer-owned, and never clobbers manual rows', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', deezer_id: 'dz-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale Deezer', deezer_id: 'dz-auto', source: 'deezer' },
    ])

    const result = await syncDeezerTracks(asA, artistA, [
      dz('dz-manual', 'SHOULD NOT OVERWRITE'),
      dz('dz-auto', 'Fresh Deezer'),
      dz('dz-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, deezer_id, provider_url, stream_url')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.deezer_id, r]))

    expect(byId['dz-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['dz-auto']).toMatchObject({ title: 'Fresh Deezer', source: 'deezer' })
    expect(byId['dz-new']).toMatchObject({
      title: 'Brand New',
      source: 'deezer',
      provider_url: 'https://deezer.com/track/dz-new',
      stream_url: null, // link-out, no hosted audio
    })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    await expect(syncDeezerTracks(asA, artistB, [dz('dz-evil', 'evil')])).rejects.toThrow()
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
