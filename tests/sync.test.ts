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
import { syncSpotifyTracks } from '@/lib/sync'
import type { SpotifyTrackInput } from '@/lib/spotify'
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

describe('syncSpotifyTracks', () => {
  it('inserts new, refreshes spotify-owned, and never clobbers manual rows', async () => {
    // Seed an existing manual row and an existing spotify-owned row.
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'My Edit', spotify_id: 'sp-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale Spotify', spotify_id: 'sp-auto', source: 'spotify' },
    ])

    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-manual', title: 'SHOULD NOT OVERWRITE', cover_url: 'c', stream_url: 's' },
      { spotify_id: 'sp-auto', title: 'Fresh Spotify', cover_url: 'c2', stream_url: 's2' },
      { spotify_id: 'sp-new', title: 'Brand New', cover_url: 'c3', stream_url: 's3' },
    ]

    const result = await syncSpotifyTracks(asA, artistA, incoming)
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tracks')
      .select('title, source, spotify_id')
      .eq('artist_id', artistA)
    const bySpotify = Object.fromEntries((data ?? []).map((r) => [r.spotify_id, r]))

    // Manual row untouched.
    expect(bySpotify['sp-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    // Spotify-owned row refreshed, still spotify-owned.
    expect(bySpotify['sp-auto']).toMatchObject({ title: 'Fresh Spotify', source: 'spotify' })
    // New row inserted as spotify-owned.
    expect(bySpotify['sp-new']).toMatchObject({ title: 'Brand New', source: 'spotify' })
  })

  it('is idempotent — a second sync of the same data changes nothing new', async () => {
    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-x', title: 'X', cover_url: null, stream_url: null },
    ]
    const first = await syncSpotifyTracks(asA, artistA, incoming)
    expect(first.added).toBe(1)
    const second = await syncSpotifyTracks(asA, artistA, incoming)
    expect(second).toMatchObject({ added: 0, updated: 1, skipped: 0, failed: 0 })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    const incoming: SpotifyTrackInput[] = [
      { spotify_id: 'sp-evil', title: 'evil', cover_url: null, stream_url: null },
    ]
    await expect(syncSpotifyTracks(asA, artistB, incoming)).rejects.toThrow()
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0) // nothing written into B
  })
})
