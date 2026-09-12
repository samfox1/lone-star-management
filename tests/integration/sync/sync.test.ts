// Spotify song sync: insert new, refresh what sync owns, never overwrite a hand edit.
/**
 * MILESTONE 6 — Spotify track sync, test-first (real DB).
 *
 * Conflict policy (PLAN #6): sync inserts new tracks and refreshes rows it owns
 * (source='spotify'), but NEVER overwrites a manager's hand edit (source flips
 * to 'manual' the moment a human touches it). Writes are RLS-scoped to the
 * caller's artist.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncAppleTracks, syncSpotifyTracks } from '@/lib/sync'
import type { SpotifyTrackInput } from '@/lib/spotify'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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

describe('syncSpotifyTracks', () => {
  it('inserts new, refreshes spotify-owned, and never clobbers manual rows', async () => {
    // Seed an existing manual row and an existing spotify-owned row.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', spotify_id: 'sp-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale Spotify', spotify_id: 'sp-auto', source: 'spotify' },
    ])

    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-manual', title: 'SHOULD NOT OVERWRITE', cover_url: 'c', stream_url: 's', featured_artists: [], album_name: null, duration_ms: null },
      { spotify_id: 'sp-auto', title: 'Fresh Spotify', cover_url: 'c2', stream_url: 's2', featured_artists: [], album_name: null, duration_ms: null },
      { spotify_id: 'sp-new', title: 'Brand New', cover_url: 'c3', stream_url: 's3', featured_artists: [], album_name: null, duration_ms: null },
    ]

    const result = await syncSpotifyTracks(asA, artistA, incoming)
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, spotify_id, on_site')
      .eq('artist_id', artistA)
    const bySpotify = Object.fromEntries((data ?? []).map((r) => [r.spotify_id, r]))

    // Manual row untouched.
    expect(bySpotify['sp-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    // Spotify-owned row refreshed, still spotify-owned.
    expect(bySpotify['sp-auto']).toMatchObject({ title: 'Fresh Spotify', source: 'spotify' })
    // New row inserted as spotify-owned, and OFF-SITE: the column is
    // `not null default true` and the public doors coalesce to true, so this
    // explicit false is the only thing keeping a raw import off the artist's site.
    expect(bySpotify['sp-new']).toMatchObject({ title: 'Brand New', source: 'spotify', on_site: false })
  })

  it('CRITICAL: a song already here on Spotify gains its Apple link on the same row', async () => {
    // Sam's own description of what a sync should do (2026-09-12): "if a song exists on
    // the site with only a spotify link, and we do a sync with spotify and apple music,
    // and the song is also on apple music, it should just naturally add the link to the
    // song to go along aside the spotify link." One row, both links, no duplicate.
    await syncSpotifyTracks(asA, artistA, [
      { spotify_id: 'sp-union', title: 'Union Song', cover_url: null, stream_url: 'https://open.spotify.com/track/u', featured_artists: [], album_name: null, duration_ms: 201_000 },
    ])
    const res = await syncAppleTracks(asA, artistA, [
      { apple_id: 'ap-union', title: 'Union Song', cover_url: null, provider_url: 'https://music.apple.com/u', album_name: null, duration_ms: 201_400 },
    ])
    expect(res).toMatchObject({ merged: 1, added: 0 })
    const { data } = await svc.from('tracks').select('title, source, spotify_id, apple_id, stream_url, apple_url').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({
      source: 'spotify', // the row stays the platform's that created it
      spotify_id: 'sp-union',
      apple_id: 'ap-union',
      stream_url: 'https://open.spotify.com/track/u',
      apple_url: 'https://music.apple.com/u',
    })
  })

  it('CRITICAL: a HAND-ADDED song gains the link too, and the pull says it went by title', async () => {
    // The case that used to leave a twin: a song typed in by hand has no duration, so the
    // old rule refused and inserted a second row every pull. Now it merges, and names it.
    await svc.from('tracks').insert({ artist_id: artistA, title: 'Handmade', source: 'manual', soundcloud_url: 'https://soundcloud.com/x/handmade' })
    const res = await syncAppleTracks(asA, artistA, [
      { apple_id: 'ap-hand', title: 'Handmade', cover_url: null, provider_url: 'https://music.apple.com/h', album_name: null, duration_ms: 180_000 },
    ])
    expect(res).toMatchObject({ merged: 1, added: 0 })
    expect(res.notes).toEqual([{ title: 'Handmade', kind: 'merged-by-title' }])
    const { data } = await svc.from('tracks').select('title, source, apple_id, soundcloud_url').eq('artist_id', artistA)
    expect(data).toHaveLength(1)
    // Still the manager's row — the stamp adds the platform, it never takes the song over.
    expect(data![0]).toMatchObject({ source: 'manual', apple_id: 'ap-hand', soundcloud_url: 'https://soundcloud.com/x/handmade' })
  })

  it('CRITICAL: collaborators are seeded by a pull and then belong to the manager', async () => {
    // Sam (2026-09-11): collaborators are edited on the song. A pull fills an empty list
    // and never overwrites one the row already has — added or trimmed by hand.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Kept', spotify_id: 'sp-kept', source: 'spotify', featured_artists: ['Hand Added'] },
      { artist_id: artistA, title: 'Empty', spotify_id: 'sp-empty', source: 'spotify', featured_artists: [] },
    ])
    await syncSpotifyTracks(asA, artistA, [
      { spotify_id: 'sp-kept', title: 'Kept', cover_url: null, stream_url: 's', featured_artists: ['From Spotify'], album_name: null, duration_ms: null },
      { spotify_id: 'sp-empty', title: 'Empty', cover_url: null, stream_url: 's', featured_artists: ['From Spotify'], album_name: null, duration_ms: null },
      { spotify_id: 'sp-fresh', title: 'Fresh', cover_url: null, stream_url: 's', featured_artists: ['Seeded'], album_name: null, duration_ms: null },
    ])
    const { data } = await svc.from('tracks').select('spotify_id, featured_artists').eq('artist_id', artistA)
    const by = Object.fromEntries((data ?? []).map((r) => [r.spotify_id, r.featured_artists]))
    expect(by['sp-kept']).toEqual(['Hand Added'])
    expect(by['sp-empty']).toEqual(['From Spotify'])
    expect(by['sp-fresh']).toEqual(['Seeded'])
  })

  it('is idempotent — a second sync of the same data changes nothing new', async () => {
    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-x', title: 'X', cover_url: null, stream_url: null, featured_artists: [], album_name: null, duration_ms: null },
    ]
    const first = await syncSpotifyTracks(asA, artistA, incoming)
    expect(first.added).toBe(1)
    const second = await syncSpotifyTracks(asA, artistA, incoming)
    expect(second).toMatchObject({ added: 0, updated: 1, skipped: 0, failed: 0 })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-evil', title: 'evil', cover_url: null, stream_url: null, featured_artists: [], album_name: null, duration_ms: null },
    ]
    // Assert it is POSTGRES refusing, not any incidental throw — a bug in the sync
    // that threw before reaching the insert would pass a bare .toThrow() while
    // proving nothing about isolation.
    await expect(syncSpotifyTracks(asA, artistB, incoming)).rejects.toThrow(/row-level security/i)
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0) // nothing written into B
  })
})
