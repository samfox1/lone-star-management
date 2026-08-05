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
      .select('title, source, apple_id, apple_url, provider_url, stream_url, on_site')
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
      // `not null default true` in the DB and coalesced to true by the public doors:
      // without this explicit false a raw import would be live on the artist's site.
      on_site: false,
    })
  })

  it('a refresh never blanks a field another platform filled', async () => {
    // Sync runs Spotify → Apple → Deezer on one click, so any provider that writes
    // nulls unconditionally erases its predecessors' work every time.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain', apple_id: 'ap-keep', source: 'apple', album_name: 'Weather', cover_url: 'https://img/keep.jpg', duration_ms: 200000 },
    ])

    await syncAppleTracks(asA, artistA, [
      ap('ap-keep', 'Rain Refreshed', { album_name: null, cover_url: null, duration_ms: null }),
    ])

    const { data } = await svc
      .from('tracks')
      .select('title, album_name, cover_url, duration_ms')
      .eq('artist_id', artistA)
      .single()
    expect(data).toMatchObject({
      title: 'Rain Refreshed', // Apple owns the title, so that DOES refresh
      album_name: 'Weather',
      cover_url: 'https://img/keep.jpg',
      duration_ms: 200000,
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

  it('matches through a (feat.) title variant — a feature credit names the same recording', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Drive', spotify_id: 'sp2', source: 'spotify', duration_ms: 90000, album_name: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap2', 'Drive (feat. Nova)', { duration_ms: 90500, album_name: 'Nightdrive' }),
    ])
    expect(result).toMatchObject({ merged: 1, added: 0 })

    const { data } = await svc.from('tracks').select('title, spotify_id, apple_id, album_name').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ title: 'Drive', spotify_id: 'sp2', apple_id: 'ap2', album_name: 'Nightdrive' })
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

  it('does NOT merge when a duration is unknown on either side — a duplicate beats losing a song', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Unknown Length', spotify_id: 'sp4', source: 'spotify', duration_ms: null },
    ])

    const result = await syncAppleTracks(asA, artistA, [ap('ap4', 'Unknown Length', { duration_ms: 120000 })])
    expect(result).toMatchObject({ added: 1, merged: 0 })

    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(2)
  })

  it('keeps an alternate take as its OWN song even at an identical duration', async () => {
    // The studio cut and the live take can run to the same length, so duration alone
    // cannot separate them. Merging here would absorb the live take and delete it from
    // the catalog — and `remix` is a real release_type elsewhere in the app.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain', spotify_id: 'sp5', source: 'spotify', duration_ms: 200000 },
    ])

    const result = await syncAppleTracks(asA, artistA, [
      ap('ap-live', 'Rain (Live)', { duration_ms: 200000 }),
      ap('ap-ac', 'Rain (Acoustic)', { duration_ms: 200000 }),
      ap('ap-rmx', 'Rain (Remix)', { duration_ms: 200000 }),
      ap('ap-demo', 'Rain (Demo)', { duration_ms: 200000 }),
    ])
    expect(result).toMatchObject({ added: 4, merged: 0 })

    const { data } = await svc.from('tracks').select('title').eq('artist_id', artistA)
    expect((data ?? []).map((r) => r.title).sort()).toEqual([
      'Rain',
      'Rain (Acoustic)',
      'Rain (Demo)',
      'Rain (Live)',
      'Rain (Remix)',
    ])
  })

  it('still merges the SAME marked version across platforms', async () => {
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Rain - Live', spotify_id: 'sp6', source: 'spotify', duration_ms: 200000 },
      { artist_id: artistA, title: 'Rain (Live)', spotify_id: 'sp7', source: 'spotify', duration_ms: 200000 },
    ])

    // Apple's "Rain [live]" is the same take as Spotify's "Rain (Live)"; the plain
    // "Rain - Live" row has no parenthetical marker, so it keys separately.
    const result = await syncAppleTracks(asA, artistA, [ap('ap-live', 'Rain [live]', { duration_ms: 200000 })])
    expect(result).toMatchObject({ merged: 1, added: 0 })

    const { data } = await svc.from('tracks').select('spotify_id, apple_id').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.spotify_id, r.apple_id]))
    expect(byId['sp7']).toBe('ap-live')
    expect(byId['sp6']).toBeNull()
  })
})

describe('syncAppleTracks — tenancy', () => {
  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // Postgres must be the thing refusing — a bare .toThrow() would also pass on a
    // sync that crashed before ever reaching the insert, proving nothing.
    await expect(syncAppleTracks(asA, artistB, [ap('ap-evil', 'evil')])).rejects.toThrow(/row-level security/i)
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
