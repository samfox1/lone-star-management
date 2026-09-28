// The Apple Music reader, over the free iTunes search API. Fetch is mocked.
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
// Shaped on a real lookup (Skeen, 1754431714): every song row carries its collection's
// id, name, link, artwork and a per-song release date, so the release needs no second
// request.
const song = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  artistId: 42,
  trackId: id,
  trackName: name,
  collectionId: 900,
  collectionName: 'OutWest - EP',
  collectionViewUrl: `https://music.apple.com/us/album/outwest/900?i=${id}&uo=4`,
  artworkUrl100: 'https://is1.mzstatic.com/image/thumb/foo/100x100bb.jpg',
  trackViewUrl: `https://music.apple.com/us/album/x/${id}`,
  trackTimeMillis: 98000,
  trackCount: 4,
  releaseDate: '2024-01-26T12:00:00Z',
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
        // Apple's " - EP" / " - Single" is store decoration, not the title: Spotify and
        // Deezer call the same record "OutWest", and the match reads this name.
        album_name: 'OutWest',
        cover_url: 'https://is1.mzstatic.com/image/thumb/foo/600x600bb.jpg',
        provider_url: 'https://music.apple.com/us/album/x/1',
        duration_ms: 98000,
        release: {
          id: '900',
          title: 'OutWest',
          release_type: 'ep',
          cover_url: 'https://is1.mzstatic.com/image/thumb/foo/600x600bb.jpg',
          release_date: '2024-01-26',
          // The album's own page: the song's `?i=` pointer (and tracking) stripped.
          url: 'https://music.apple.com/us/album/outwest/900',
        },
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
      collectionId: undefined,
      collectionName: undefined,
      collectionViewUrl: undefined,
      artworkUrl100: undefined,
      trackViewUrl: undefined,
      trackTimeMillis: undefined,
      releaseDate: undefined,
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
      release: null, // no collection id → nothing to group under, never an invented one
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

/**
 * THE RELEASE each song came from (Sam, 2026-09-28: Apple songs get grouped into albums,
 * EPs and singles like Spotify's). Apple has no release-type field on a song, but its
 * store names every non-album release "<title> - Single" / "<title> - EP" — that suffix is
 * the explicit type, and an unsuffixed collection is an album.
 */
describe('getArtistTracks — the release each song belongs to', () => {
  async function releaseOf(extra: Record<string, unknown>, artistId = '42') {
    const fetchImpl = vi.fn(async () => res({ body: { results: [artist(42), song(1, 'Drive', extra)] } }) as unknown as Response)
    const [t] = await client(fetchImpl as unknown as typeof fetch).getArtistTracks(artistId)
    return t.release
  }

  it('" - Single" is a single, with the suffix off its title', async () => {
    const r = await releaseOf({ collectionName: 'Home Again - Single', trackCount: 1 })
    expect(r).toMatchObject({ title: 'Home Again', release_type: 'single' })
  })

  it('" - EP" is an EP', async () => {
    const r = await releaseOf({ collectionName: 'OutWest - EP', trackCount: 3 })
    expect(r).toMatchObject({ title: 'OutWest', release_type: 'ep' })
  })

  it('no suffix is an album — Apple labels every single and EP, so an unlabelled one is not', async () => {
    const r = await releaseOf({ collectionName: 'Heatwaves & Horizons', trackCount: 10 })
    expect(r).toMatchObject({ title: 'Heatwaves & Horizons', release_type: 'album' })
  })

  it('the suffix is matched only at the END — a title that merely contains " - Single" keeps it', async () => {
    const r = await releaseOf({ collectionName: 'Love - Single Life' })
    expect(r).toMatchObject({ title: 'Love - Single Life', release_type: 'album' })
  })

  it('is keyed by the collection id, so every song of one album names the same release', async () => {
    const fetchImpl = vi.fn(
      async () =>
        res({ body: { results: [song(1, 'Intro', { collectionName: 'H&H' }), song(2, 'Closer!', { collectionName: 'H&H' })] } }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.release?.id)).toEqual(['900', '900'])
  })

  it('a Various Artists compilation is not the artist\'s release (Spotify never pulls those either)', async () => {
    // Real shape (Jack Johnson, 909253): a compilation names its own collection artist.
    const r = await releaseOf({ collectionArtistId: 36270, collectionArtistName: 'Various Artists', collectionName: 'Hawaiian Slack Key Kings' })
    expect(r).toBeNull()
  })

  it("an appearance on someone else's album is not the artist's release", async () => {
    // Real shape: "Paula Fuga & Jack Johnson" on Paula Fuga's album — the song is by
    // another artist id and the collection is credited to someone else by name.
    const r = await releaseOf({ artistId: 159380642, artistName: 'Paula Fuga & Jack Johnson', collectionArtistName: 'Paula Fuga', collectionName: 'Rain On Sunday' })
    expect(r).toBeNull()
  })

  it('a joint credit that includes the artist IS their release', async () => {
    // Real shape (Skeen): "#lola! [skeen remix] - Single" by the joint artist
    // "TSG: AP! & Skeen" — another artist id, but no other collection credit. Spotify
    // lists it under Skeen's own singles.
    const r = await releaseOf({ artistId: 1613049935, artistName: 'TSG: AP! & Skeen', collectionName: '#lola! [skeen remix] - Single' })
    expect(r).toMatchObject({ title: '#lola! [skeen remix]', release_type: 'single' })
  })

  it('a collection credited to the artist by name is still theirs', async () => {
    const r = await releaseOf({ artistName: 'Skeen', collectionArtistName: 'Skeen', collectionName: 'Heatwaves & Horizons' })
    expect(r).toMatchObject({ title: 'Heatwaves & Horizons' })
  })
})
