/**
 * Apple Music track sync (real DB) — now a UNION merge, not a mutually-exclusive
 * source. Same conflict policy for exact-id matches (insert new, refresh
 * apple-owned, never clobber manual), PLUS cross-platform merge: an Apple song that
 * matches an existing track (from another platform) by normalized title + duration
 * is STAMPED onto that row (apple_id + apple_url) instead of duplicated. Apple's
 * link lives in `apple_url`, never the legacy shared `provider_url`. RLS-scoped.
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

const ap = (id: string, title: string, extra: Partial<AppleTrackInput> = {}): AppleTrackInput => ({
  apple_id: id,
  title,
  album_name: null,
  cover_url: `https://img/${id}.jpg`,
  provider_url: `https://music.apple.com/us/song/${id}`,
  duration_ms: null,
  ...extra,
})

describe('syncAppleTracks — exact-id conflict policy', () => {
  it('inserts new, refreshes apple-owned, never clobbers manual; link in apple_url', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', apple_id: 'ap-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale', apple_id: 'ap-auto', source: 'apple' },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap-manual', 'SHOULD NOT OVERWRITE'),
      ap('ap-auto', 'Fresh'),
      ap('ap-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, merged: 0, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, apple_id, apple_url, provider_url, stream_url')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.apple_id, r]))
    expect(byId['ap-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['ap-auto']).toMatchObject({ title: 'Fresh', source: 'apple' })
    expect(byId['ap-new']).toMatchObject({
      title: 'Brand New',
      source: 'apple',
      apple_url: 'https://music.apple.com/us/song/ap-new',
      provider_url: null, // Apple's link goes in apple_url, not the legacy column
      stream_url: null,
    })
  })
})

describe('syncAppleTracks — cross-platform merge', () => {
  it('stamps Apple onto the SAME song imported from Spotify (title + duration match)', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'OutWest', spotify_id: 'sp1', stream_url: 'https://open.spotify.com/track/sp1', source: 'spotify', duration_ms: 98000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap1', 'OutWest', { duration_ms: 98000, provider_url: 'https://music.apple.com/us/song/ap1' }),
    ])
    expect(result).toMatchObject({ added: 0, updated: 0, merged: 1, failed: 0 })

    const { data } = await svc.from('tracks').select('*').eq('artist_id', artistA)
    expect(data).toHaveLength(1) // merged, not duplicated
    expect(data![0]).toMatchObject({
      title: 'OutWest', // Spotify's title kept
      source: 'spotify', // ownership unchanged
      spotify_id: 'sp1',
      apple_id: 'ap1', // now also on Apple
      apple_url: 'https://music.apple.com/us/song/ap1',
      stream_url: 'https://open.spotify.com/track/sp1', // Spotify link untouched
    })
  })

  it('matches through a (feat.) title variant when duration is unknown, filling duration', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Drive', spotify_id: 'sp2', source: 'spotify', duration_ms: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap2', 'Drive (feat. Nova)', { duration_ms: 90000 }),
    ])
    expect(result).toMatchObject({ merged: 1, added: 0 })

    const { data } = await svc.from('tracks').select('title, spotify_id, apple_id, duration_ms').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ title: 'Drive', spotify_id: 'sp2', apple_id: 'ap2', duration_ms: 90000 })
  })

  it('does NOT merge a same-title song when durations are far apart — inserts instead', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Reused', spotify_id: 'sp3', source: 'spotify', duration_ms: 100000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap3', 'Reused', { duration_ms: 200000 }),
    ])
    expect(result).toMatchObject({ added: 1, merged: 0 })

    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(2) // two distinct songs that happen to share a title
  })
})

describe('syncAppleTracks — tenancy', () => {
  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    await expect(syncAppleTracks(asA, artistB, [ap('ap-evil', 'evil')])).rejects.toThrow()
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
