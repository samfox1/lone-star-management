/**
 * PHASE 4 — Apple Music track sync (real DB). Same conflict policy as the other
 * catalog sources: insert new, refresh apple-owned, never clobber manual;
 * RLS-scoped. Apple rows carry a provider_url link, no stream_url.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncAppleTracks } from '@/lib/sync'
import type { AppleTrackInput } from '@/lib/apple'
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

const ap = (id: string, title: string): AppleTrackInput => ({
  apple_id: id,
  title,
  cover_url: `https://img/${id}.jpg`,
  provider_url: `https://music.apple.com/us/song/${id}`,
})

describe('syncAppleTracks', () => {
  it('inserts new, refreshes apple-owned, never clobbers manual', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', apple_id: 'ap-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale', apple_id: 'ap-auto', source: 'apple' },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap-manual', 'SHOULD NOT OVERWRITE'),
      ap('ap-auto', 'Fresh'),
      ap('ap-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, apple_id, provider_url, stream_url')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.apple_id, r]))
    expect(byId['ap-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['ap-auto']).toMatchObject({ title: 'Fresh', source: 'apple' })
    expect(byId['ap-new']).toMatchObject({
      title: 'Brand New',
      source: 'apple',
      provider_url: 'https://music.apple.com/us/song/ap-new',
      stream_url: null,
    })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    await expect(syncAppleTracks(asA, artistB, [ap('ap-evil', 'evil')])).rejects.toThrow()
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
