// Deezer song sync against the real database.
/**
 * PHASE 2 — Deezer track sync (real DB). Same conflict policy as Spotify: insert
 * new, refresh deezer-owned, never clobber manual; RLS-scoped to the caller's
 * artist. Deezer rows carry a provider_url link-out and no stream_url.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncDeezerTracks } from '@/lib/sync'
import type { DeezerTrackInput } from '@/lib/deezer'
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

const dz = (id: string, title: string, extra: Partial<DeezerTrackInput> = {}): DeezerTrackInput => ({
  deezer_id: id,
  title,
  cover_url: `https://img/${id}.jpg`,
  album_name: null,
  provider_url: `https://deezer.com/track/${id}`,
  duration_ms: null,
  ...extra,
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
      .select('title, source, deezer_id, provider_url, stream_url, on_site')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.deezer_id, r]))

    expect(byId['dz-manual']).toMatchObject({ title: 'My Edit', source: 'manual' })
    expect(byId['dz-auto']).toMatchObject({ title: 'Fresh Deezer', source: 'deezer' })
    expect(byId['dz-new']).toMatchObject({
      title: 'Brand New',
      source: 'deezer',
      provider_url: 'https://deezer.com/track/dz-new',
      stream_url: null, // link-out, no hosted audio
      // `not null default true` in the DB, coalesced to true by the public doors:
      // this explicit false is all that keeps an import off the artist's live site.
      on_site: false,
    })
  })

  it('carries the album title Deezer reports', async () => {
    await syncDeezerTracks(asA, artistA, [dz('dz-alb', 'Rain', { album_name: 'Weather' })])
    const { data } = await svc.from('tracks').select('album_name').eq('artist_id', artistA).single()
    expect(data!.album_name).toBe('Weather')
  })

  it('CRITICAL: a refresh never blanks album_name another platform filled', async () => {
    // The shipped bug. One Sync click runs Spotify → Apple → Deezer; Apple filled
    // album_name and Deezer, running last, wrote null over it — every single click.
    await svc.from('tracks').insert([
      {
        artist_id: artistA,
        title: 'Rain',
        deezer_id: 'dz-keep',
        source: 'deezer',
        album_name: 'Filled By Apple',
        cover_url: 'https://img/apple.jpg',
        duration_ms: 200000,
      },
    ])

    await syncDeezerTracks(asA, artistA, [
      dz('dz-keep', 'Rain Refreshed', { album_name: null, cover_url: null, duration_ms: null }),
    ])

    const { data } = await svc
      .from('tracks')
      .select('title, album_name, cover_url, duration_ms')
      .eq('artist_id', artistA)
      .single()
    expect(data).toMatchObject({
      title: 'Rain Refreshed', // Deezer owns the title of a deezer-sourced row
      album_name: 'Filled By Apple',
      cover_url: 'https://img/apple.jpg',
      duration_ms: 200000,
    })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // Assert Postgres is the refusing party; a bare .toThrow() would also be
    // satisfied by the sync crashing before it ever attempted the write.
    await expect(syncDeezerTracks(asA, artistB, [dz('dz-evil', 'evil')])).rejects.toThrow(/row-level security/i)
    const { count } = await svc
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
