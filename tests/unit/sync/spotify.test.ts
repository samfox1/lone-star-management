// The Spotify client: getting and reusing a token, backing off, paging, and shaping errors.
/**
 * MILESTONE 6 — spotifyClient, test-first. Mocked at the fetch boundary so it's
 * fast, deterministic, and needs no real credentials (README test rules).
 * Covers: client-credentials token fetch + reuse, 429 backoff + retry,
 * pagination, shaped errors, and discography dedupe.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSpotifyClient } from '@/lib/spotify'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }

function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const tokenOk = res({ body: { access_token: 'tok-123', expires_in: 3600 } })

function client(fetchImpl: typeof fetch) {
  return createSpotifyClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl,
    sleep: () => Promise.resolve(), // no real waiting in tests
  })
}

describe('token', () => {
  it('fetches a client-credentials token and reuses it across calls', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      return res({ body: { items: [], next: null } }) as unknown as Response
    })
    const c = client(fetchImpl as unknown as typeof fetch)

    await c.getArtistAlbums('artist1')
    await c.getArtistAlbums('artist2')

    const tokenCalls = fetchImpl.mock.calls.filter(([u]) => u === TOKEN_URL)
    expect(tokenCalls).toHaveLength(1) // token reused, not re-fetched
  })
})

describe('429 backoff + retry', () => {
  it('retries after a 429 then succeeds', async () => {
    let albumHits = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      albumHits++
      if (albumHits === 1) {
        return res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response
      }
      return res({ body: { items: [{ id: 'al1' }], next: null } }) as unknown as Response
    })
    const albums = await client(fetchImpl as unknown as typeof fetch).getArtistAlbums('a')
    expect(albumHits).toBe(2) // one 429, one success
    expect(albums).toHaveLength(1)
  })
})

describe('pagination', () => {
  it('follows next across multiple pages', async () => {
    const page2 = 'https://api.spotify.com/v1/artists/a/albums?offset=50'
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      if (url.includes('offset=50')) {
        return res({ body: { items: [{ id: 'al2' }], next: null } }) as unknown as Response
      }
      return res({ body: { items: [{ id: 'al1' }], next: page2 } }) as unknown as Response
    })
    const albums = await client(fetchImpl as unknown as typeof fetch).getArtistAlbums('a')
    expect(albums.map((x) => x.id)).toEqual(['al1', 'al2'])
  })
})

describe('error shaping', () => {
  it('throws a shaped error on a non-429 failure, never crashes', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      return res({ status: 500, body: { error: 'boom' } }) as unknown as Response
    })
    await expect(
      client(fetchImpl as unknown as typeof fetch).getArtistAlbums('a'),
    ).rejects.toThrow(/spotify/i)
  })
})

describe('getDiscographyTracks', () => {
  it('CRITICAL: a song on two releases is one track PER RELEASE, not collapsed by title', async () => {
    // Sam (2026-09-11): a single that is also on the album stays separate. Spotify gives
    // each release's copy its own id; keying on the title used to keep only the first.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      if (url.includes('/artists/')) {
        return res({
          body: {
            items: [
              { id: 'al1', images: [{ url: 'cover1' }] },
              { id: 'al2', images: [{ url: 'cover2' }] },
            ],
            next: null,
          },
        }) as unknown as Response
      }
      if (url.includes('/albums/al1/')) {
        return res({
          body: { items: [{ id: 't1', name: 'Song A', duration_ms: 210000, external_urls: { spotify: 'u1' } }], next: null },
        }) as unknown as Response
      }
      // al2 — Song A again (dupe) + Song B
      return res({
        body: {
          items: [
            { id: 't2', name: 'Song A', external_urls: { spotify: 'u2' } },
            { id: 't3', name: 'Song B', external_urls: { spotify: 'u3' } },
          ],
          next: null,
        },
      }) as unknown as Response
    })

    const tracks = await client(fetchImpl as unknown as typeof fetch).getDiscographyTracks('a')
    expect(tracks.map((t) => t.spotify_id)).toEqual(['t1', 't2', 't3'])
    expect(tracks.map((t) => t.title)).toEqual(['Song A', 'Song A', 'Song B'])
    expect(tracks[0]).toMatchObject({ spotify_id: 't1', stream_url: 'u1', cover_url: 'cover1', duration_ms: 210000 })
    expect(tracks[1]).toMatchObject({ spotify_id: 't2', stream_url: 'u2', cover_url: 'cover2' })
  })
})

describe('getDiscography (releases)', () => {
  // Three albums exercise each branch: album_type='album', a 4-track single-type
  // (→ ep), and a 1-track single-type (→ single). Dates cover year / year-month /
  // full precision.
  const albums = [
    {
      id: 'al1',
      name: 'Full Length',
      album_type: 'album',
      release_date: '2020',
      total_tracks: 10,
      images: [{ url: 'cover1' }],
      external_urls: { spotify: 'https://open.spotify.com/album/al1' },
    },
    { id: 'al2', name: 'The EP', album_type: 'single', release_date: '2021-06', total_tracks: 4, images: [] },
    { id: 'al3', name: 'A Single', album_type: 'single', release_date: '2022-03-15', total_tracks: 1 },
  ]
  const tracksByAlbum: Record<string, unknown[]> = {
    al1: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }],
    al2: [{ id: 't3', name: 'Three' }],
    al3: [{ id: 't4', name: 'Four' }],
  }

  function discoFetch() {
    return vi.fn(async (url: string) => {
      if (url === TOKEN_URL) return tokenOk as unknown as Response
      if (url.includes('/artists/')) return res({ body: { items: albums, next: null } }) as unknown as Response
      const id = url.match(/\/albums\/(\w+)\//)?.[1] ?? ''
      return res({ body: { items: tracksByAlbum[id] ?? [], next: null } }) as unknown as Response
    })
  }

  it('classifies release type by album_type + track count', async () => {
    const { releases } = await client(discoFetch() as unknown as typeof fetch).getDiscography('a')
    const byId = Object.fromEntries(releases.map((r) => [r.spotify_id, r]))
    expect(byId['al1'].release_type).toBe('album')
    expect(byId['al2'].release_type).toBe('ep') // single-type, ≥4 tracks
    expect(byId['al3'].release_type).toBe('single')
  })

  it('normalizes partial Spotify dates to a valid YYYY-MM-DD', async () => {
    const { releases } = await client(discoFetch() as unknown as typeof fetch).getDiscography('a')
    const byId = Object.fromEntries(releases.map((r) => [r.spotify_id, r]))
    expect(byId['al1'].release_date).toBe('2020-01-01') // year → padded
    expect(byId['al2'].release_date).toBe('2021-06-01') // year-month → padded
    expect(byId['al3'].release_date).toBe('2022-03-15') // full → kept
  })

  it('carries the album cover, Spotify url seed, and member track ids', async () => {
    const { releases } = await client(discoFetch() as unknown as typeof fetch).getDiscography('a')
    const byId = Object.fromEntries(releases.map((r) => [r.spotify_id, r]))
    expect(byId['al1']).toMatchObject({
      title: 'Full Length',
      cover_url: 'cover1',
      spotify_url: 'https://open.spotify.com/album/al1',
      track_spotify_ids: ['t1', 't2'],
    })
    expect(byId['al2'].cover_url).toBeNull() // no images → null
    expect(byId['al3'].spotify_url).toBeNull() // no external_urls → null
  })

  it('returns the same track list as getDiscographyTracks, from one fetch', async () => {
    const { tracks } = await client(discoFetch() as unknown as typeof fetch).getDiscography('a')
    expect(tracks.map((t) => t.title)).toEqual(['One', 'Two', 'Three', 'Four'])
  })
})
