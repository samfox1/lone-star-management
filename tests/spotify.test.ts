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
  it('collects album tracks and dedupes by title', async () => {
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
          body: { items: [{ id: 't1', name: 'Song A', external_urls: { spotify: 'u1' } }], next: null },
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
    expect(tracks.map((t) => t.title)).toEqual(['Song A', 'Song B'])
    expect(tracks[0]).toMatchObject({ spotify_id: 't1', stream_url: 'u1', cover_url: 'cover1' })
  })
})
