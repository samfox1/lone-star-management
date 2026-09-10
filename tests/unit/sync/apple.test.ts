/**
 * appleMusicClient — reads catalog data from the FREE iTunes Search API (no key,
 * no developer token; the paid MusicKit API isn't required for catalog lookups).
 * The client hits the `lookup` endpoint for an artist's songs and maps them to the
 * tracks-sync shape (metadata + link-out, no hosted audio). Injectable fetch/sleep.
 */
import { describe, expect, it, vi } from 'vitest'
import { createAppleMusicClient } from '@/lib/apple'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

// A real lookup's artist row carries no trackId, which means the null-id check
// alone would drop it and the wrapperType/kind filter would never be exercised.
// Giving it one leaves the filter as the ONLY thing that can keep it out.
const artist = (id: number) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: id,
  artistName: 'Skeen',
  trackId: id,
})
const song = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: id,
  trackName: name,
  collectionName: 'OutWest - EP',
  artworkUrl100: 'https://is1.mzstatic.com/image/thumb/foo/100x100bb.jpg',
  trackViewUrl: `https://music.apple.com/us/album/x/${id}`,
  trackTimeMillis: 98000,
  ...extra,
})

function client(fetchImpl: typeof fetch) {
  return createAppleMusicClient({ fetchImpl, sleep: () => Promise.resolve() })
}

describe('getArtistTracks (iTunes Search)', () => {
  it('looks up songs by artist id, with no auth header', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => res({ body: { resultCount: 2, results: [artist(42), song(1, 'Drive')] } }) as unknown as Response)
    await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('itunes.apple.com/lookup')
    expect(url).toContain('id=42')
    expect(url).toContain('entity=song')
    expect(init).toBeUndefined() // iTunes Search needs no auth
  })

  it('maps songs to the sync shape (upsized artwork) and drops the artist row', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { results: [artist(42), song(1, 'Drive')] } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toEqual([
      {
        apple_id: '1',
        title: 'Drive',
        album_name: 'OutWest - EP',
        cover_url: 'https://is1.mzstatic.com/image/thumb/foo/600x600bb.jpg',
        provider_url: 'https://music.apple.com/us/album/x/1',
        duration_ms: 98000,
      },
    ])
  })

  // Without the trackId check the row still maps, and apple_id becomes the string
  // "undefined" — a row that can never match or de-duplicate against anything.
  it('drops a song row with no trackId', async () => {
    const noId = song(0, 'Ghost', { trackId: undefined })
    const fetchImpl = vi.fn(async () => res({ body: { results: [noId, song(1, 'Drive')] } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.apple_id)).toEqual(['1'])
  })

  it('sends limit and country, clamping limit to the iTunes maximum of 200', async () => {
    vi.stubEnv('APPLE_STOREFRONT', undefined) // ignore any storefront set in .env.local
    const fetchImpl = vi.fn(async (_url: string) => res({ body: { results: [] } }) as unknown as Response)

    await createAppleMusicClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: () => Promise.resolve() }).getArtistTracks('42')
    expect(String(fetchImpl.mock.calls[0][0])).toContain('limit=200')
    expect(String(fetchImpl.mock.calls[0][0])).toContain('country=us') // default storefront

    await createAppleMusicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      limit: 500, // iTunes rejects anything over 200
      country: 'gb',
    }).getArtistTracks('42')
    expect(String(fetchImpl.mock.calls[1][0])).toContain('limit=200')
    expect(String(fetchImpl.mock.calls[1][0])).toContain('country=gb')

    await createAppleMusicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      limit: 25,
    }).getArtistTracks('42')
    expect(String(fetchImpl.mock.calls[2][0])).toContain('limit=25') // a smaller cap is honoured
    vi.unstubAllEnvs()
  })

  it('gives up after maxRetries when the 429 never clears', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response)
    const c = createAppleMusicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getArtistTracks('42')).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // attempt + 2 retries, then stop
  })

  it('tolerates missing optional fields (null, not undefined)', async () => {
    const bare = song(2, 'Bare', {
      collectionName: undefined,
      artworkUrl100: undefined,
      trackViewUrl: undefined,
      trackTimeMillis: undefined,
    })
    const fetchImpl = vi.fn(async () => res({ body: { results: [bare] } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out[0]).toEqual({
      apple_id: '2',
      title: 'Bare',
      album_name: null,
      cover_url: null,
      provider_url: null,
      duration_ms: null,
    })
  })

  it('retries on 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return (calls === 1
        ? res({ status: 429, headers: { 'retry-after': '2' }, body: {} })
        : res({ body: { results: [song(1, 'One')] } })) as unknown as Response
    })
    const c = createAppleMusicClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getArtistTracks('42')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('throws a shaped error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')).rejects.toThrow(/500/)
  })
})
