/**
 * MILESTONE 6 — Spotify RELEASE sync, test-first (real DB).
 *
 * Companion to sync.test.ts (tracks). Releases are the umbrella tracks belong to.
 * Conflict policy: import new releases HIDDEN (visible=false) for the manager to
 * toggle on, refresh spotify-owned metadata on re-import, but NEVER clobber
 * manager-owned fields (visible / slug / links). Tracks link to their release by
 * member Spotify id, only where still unassigned (a manual assignment wins).
 * Writes are RLS-scoped to the caller's artist.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncSpotifyReleases } from '@/lib/sync'
import type { SpotifyReleaseInput } from '@/lib/spotify'
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
  // Tracks reference releases (FK) — delete tracks first.
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('tracks').delete().eq('artist_id', artistB)
  await svc.from('releases').delete().eq('artist_id', artistA)
  await svc.from('releases').delete().eq('artist_id', artistB)
})

function rel(over: Partial<SpotifyReleaseInput> = {}): SpotifyReleaseInput {
  return {
    spotify_id: 'sp-alb',
    title: 'Debut',
    release_type: 'album',
    cover_url: 'https://img/cover.jpg',
    release_date: '2024-05-01',
    spotify_url: 'https://open.spotify.com/album/sp-alb',
    track_spotify_ids: [],
    ...over,
  }
}

describe('syncSpotifyReleases', () => {
  it('inserts a new release HIDDEN, spotify-owned, with a slug and a seed Spotify link', async () => {
    const result = await syncSpotifyReleases(asA, artistA, [rel()])
    expect(result).toMatchObject({ added: 1, updated: 0 })

    const { data } = await svc
      .from('releases')
      .select('title, slug, cover_url, release_date, release_type, links, visible, source, spotify_id')
      .eq('artist_id', artistA)
      .single()

    expect(data).toMatchObject({
      title: 'Debut',
      slug: 'debut',
      cover_url: 'https://img/cover.jpg',
      release_date: '2024-05-01',
      release_type: 'album',
      visible: false, // imported hidden — manager toggles it on
      source: 'spotify',
      spotify_id: 'sp-alb',
    })
    expect(data!.links).toEqual([{ label: 'Spotify', url: 'https://open.spotify.com/album/sp-alb' }])
  })

  it('refreshes spotify metadata on re-import but never touches manager-owned visible/slug/links', async () => {
    // A previously-imported release the manager has since curated: toggled ON,
    // renamed the slug, and added a DSP link.
    await svc.from('releases').insert({
      artist_id: artistA,
      title: 'Old Title',
      slug: 'my-custom-slug',
      release_type: 'single',
      links: [{ label: 'Apple Music', url: 'https://music.apple.com/x' }],
      visible: true,
      source: 'spotify',
      spotify_id: 'sp-alb',
    })

    const result = await syncSpotifyReleases(
      asA,
      artistA,
      [rel({ title: 'Fresh Title', release_type: 'album', cover_url: 'https://img/new.jpg' })],
    )
    expect(result).toMatchObject({ added: 0, updated: 1 })

    const { data } = await svc
      .from('releases')
      .select('title, slug, cover_url, release_type, links, visible')
      .eq('artist_id', artistA)
      .single()

    // Metadata refreshed…
    expect(data).toMatchObject({
      title: 'Fresh Title',
      release_type: 'album',
      cover_url: 'https://img/new.jpg',
    })
    // …but manager-owned fields untouched.
    expect(data).toMatchObject({ slug: 'my-custom-slug', visible: true })
    expect(data!.links).toEqual([{ label: 'Apple Music', url: 'https://music.apple.com/x' }])
  })

  it('suffixes the slug so two different releases with the same title stay unique', async () => {
    // A manual release already owns the base slug.
    await svc
      .from('releases')
      .insert({ artist_id: artistA, title: 'Live', slug: 'live', source: 'manual' })

    await syncSpotifyReleases(asA, artistA, [
      rel({ spotify_id: 'sp-1', title: 'Live' }),
      rel({ spotify_id: 'sp-2', title: 'Live' }),
    ])

    const { data } = await svc
      .from('releases')
      .select('slug')
      .eq('artist_id', artistA)
    const slugs = (data ?? []).map((r) => r.slug).sort()
    expect(slugs).toEqual(['live', 'live-2', 'live-3'])
  })

  it('links member tracks by spotify id, only where the track is still unassigned', async () => {
    // An unassigned track, and one already assigned to another release.
    const { data: other } = await svc
      .from('releases')
      .insert({ artist_id: artistA, title: 'Other', slug: 'other', source: 'manual' })
      .select('id')
      .single()
    await svc.from('tracks').insert([
      { artist_id: artistA, title: 'Loose', spotify_id: 't-loose', source: 'spotify', release_id: null },
      { artist_id: artistA, title: 'Claimed', spotify_id: 't-claimed', source: 'manual', release_id: other!.id },
    ])

    await syncSpotifyReleases(asA, artistA, [
      rel({ spotify_id: 'sp-alb', track_spotify_ids: ['t-loose', 't-claimed'] }),
    ])

    const { data: newRel } = await svc
      .from('releases')
      .select('id')
      .eq('artist_id', artistA)
      .eq('spotify_id', 'sp-alb')
      .single()
    const { data: tracks } = await svc
      .from('tracks')
      .select('spotify_id, release_id')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((tracks ?? []).map((t) => [t.spotify_id, t.release_id]))

    expect(byId['t-loose']).toBe(newRel!.id) // linked to the new release
    expect(byId['t-claimed']).toBe(other!.id) // prior assignment kept
  })

  it('is idempotent — a second sync of the same data adds nothing new', async () => {
    const input = [rel()]
    const first = await syncSpotifyReleases(asA, artistA, input)
    expect(first).toMatchObject({ added: 1, updated: 0 })
    const second = await syncSpotifyReleases(asA, artistA, input)
    expect(second).toMatchObject({ added: 0, updated: 1 })

    const { count } = await svc
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
    expect(count).toBe(1) // no duplicate
  })

  it("CRITICAL: cannot sync releases into another tenant's artist", async () => {
    await expect(syncSpotifyReleases(asA, artistB, [rel()])).rejects.toThrow()
    const { count } = await svc
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0) // nothing written into B
  })
})
