// The Deezer client: walking the artist's releases, mapping songs, paging, and backing off a quota error.
/**
 * deezerClient, mocked at the fetch boundary (fast, deterministic, no creds — Deezer's
 * public API needs none). Covers the discography walk (albums → each album's tracks),
 * the release each song belongs to, `next` pagination, HTTP-429 backoff, Deezer's in-body
 * quota error (code 4) backoff, and shaped errors.
 *
 * WHY A WALK, NOT /top (2026-09-28). The client used to read `/artist/{id}/top`. Measured
 * against the live API that day, `top` returned ONE track for an artist with six releases
 * and ZERO for artists with eight and nineteen — it ranks popularity, so a small artist
 * (every artist this app serves) barely has any. Grouping songs into releases from that
 * list would have produced almost nothing. The walk is the one Spotify's pull makes.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDeezerClient } from '@/lib/deezer'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }

function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function client(fetchImpl: typeof fetch) {
  return createDeezerClient({ fetchImpl, sleep: () => Promise.resolve() })
}

// Shaped on the live API (artist 51437422, album 583316892).
const album = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  link: `https://www.deezer.com/album/${id}`,
  cover_medium: `https://img/${id}/250.jpg`,
  cover_big: `https://img/${id}/500.jpg`,
  release_date: '2024-05-10',
  record_type: 'album',
  tracklist: `https://api.deezer.com/album/${id}/tracks`,
  type: 'album',
  ...extra,
})
const track = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  link: `https://www.deezer.com/track/${id}`,
  duration: 98,
  ...extra,
})

/** A fake Deezer: the artist's albums list, then each album's tracks, by URL. Anything
 *  else is a request the client should not be making, and fails loudly. */
function deezer(albums: unknown[], tracksByAlbum: Record<number, unknown[]>) {
  return vi.fn(async (url: string) => {
    if (/\/artist\/42\/albums/.test(url)) return res({ body: { data: albums, next: null } }) as unknown as Response
    const m = /\/album\/(\d+)\/tracks/.exec(url)
    if (m) return res({ body: { data: tracksByAlbum[Number(m[1])] ?? [], next: null } }) as unknown as Response
    throw new Error(`unexpected request: ${url}`)
  })
}

describe('getArtistTracks — the discography walk', () => {
  it("lists the artist's releases, then reads each release's tracks", async () => {
    const fetchImpl = deezer([album(7, 'Weather')], { 7: [track(10, 'Drive')] })
    await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('api.deezer.com/artist/42/albums')
    expect(urls[1]).toContain('api.deezer.com/album/7/tracks')
    expect(urls).toHaveLength(2)
  })

  it('maps each track to the sync shape (link-out, no audio) with the release it came from', async () => {
    const fetchImpl = deezer([album(7, 'Weather', { record_type: 'ep', release_date: '2024-05-10' })], { 7: [track(10, 'Drive')] })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toEqual([
      {
        deezer_id: '10',
        title: 'Drive',
        album_name: 'Weather',
        cover_url: 'https://img/7/500.jpg',
        provider_url: 'https://www.deezer.com/track/10',
        duration_ms: 98000,
        release: {
          id: '7',
          title: 'Weather',
          release_type: 'ep',
          cover_url: 'https://img/7/500.jpg',
          release_date: '2024-05-10',
          url: 'https://www.deezer.com/album/7',
        },
      },
    ])
  })

  it("takes Deezer's own record_type — it names albums, EPs and singles explicitly", async () => {
    const fetchImpl = deezer(
      [album(1, 'A', { record_type: 'album' }), album(2, 'E', { record_type: 'ep' }), album(3, 'S', { record_type: 'single' })],
      { 1: [track(11, 'a')], 2: [track(12, 'e')], 3: [track(13, 's'), track(14, 's2'), track(15, 's3'), track(16, 's4')] },
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    const typeOf = (id: string) => out.find((t) => t.deezer_id === id)!.release!.release_type
    expect(typeOf('11')).toBe('album')
    expect(typeOf('12')).toBe('ep')
    expect(typeOf('13')).toBe('single') // explicit: four tracks does not make it an EP
  })

  it("an unknown record_type falls back to Spotify's count rule (4+ tracks is an EP)", async () => {
    const fetchImpl = deezer(
      [album(1, 'Big', { record_type: undefined }), album(2, 'Small', { record_type: 'mystery' })],
      { 1: [track(11, 'a'), track(12, 'b'), track(13, 'c'), track(14, 'd')], 2: [track(21, 'x')] },
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.find((t) => t.deezer_id === '11')!.release!.release_type).toBe('ep')
    expect(out.find((t) => t.deezer_id === '21')!.release!.release_type).toBe('single')
  })

  it("never walks a compilation — Spotify's pull never asks for them either", async () => {
    const fetchImpl = deezer([album(1, 'Best Of', { record_type: 'compile' }), album(2, 'Own', { record_type: 'single' })], {
      1: [track(11, 'Hit')],
      2: [track(21, 'Own')],
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.deezer_id)).toEqual(['21'])
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('/album/1/'))).toBe(false) // not even requested
  })

  it('keeps ONE row per release: the single and the album copy of a song both come through', async () => {
    // Sam, 2026-09-11 — a single that is also an album track is two songs. The client used
    // to collapse by lowercased title, so the album lost its copy to whichever came first.
    const fetchImpl = deezer([album(1, 'LP'), album(2, 'Echo', { record_type: 'single' })], {
      1: [track(11, 'Echo')],
      2: [track(21, 'ECHO')],
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => [t.deezer_id, t.release!.id])).toEqual([
      ['11', '1'],
      ['21', '2'],
    ])
  })

  it('drops only a literal repeat of the same track id', async () => {
    const fetchImpl = deezer([album(1, 'LP'), album(2, 'LP (again)')], { 1: [track(11, 'Echo')], 2: [track(11, 'Echo')] })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toHaveLength(1)
  })

  it('an undated release is null, never "0000-00-00"', async () => {
    const fetchImpl = deezer([album(1, 'LP', { release_date: '0000-00-00' })], { 1: [track(11, 'a')] })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out[0].release!.release_date).toBeNull()
  })

  it('absent album fields stay absent — never invented', async () => {
    const fetchImpl = deezer([{ id: 1, record_type: 'single' }], { 1: [{ id: 11, title: 'Solo' }] })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out[0]).toMatchObject({ album_name: null, cover_url: null, provider_url: null, duration_ms: null })
    expect(out[0].release).toMatchObject({ title: '', cover_url: null, release_date: null, url: null })
  })

  it('falls back to the medium cover when Deezer sends no big one', async () => {
    const fetchImpl = deezer([album(1, 'LP', { cover_big: undefined })], { 1: [track(11, 'a')] })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out[0].cover_url).toBe('https://img/1/250.jpg')
  })

  it('follows `next` pagination on both the albums list and an album\'s tracks', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/artist/42/albums') && !url.includes('index=')) {
        return res({ body: { data: [album(1, 'One')], next: 'https://api.deezer.com/artist/42/albums?index=1' } }) as unknown as Response
      }
      if (url.includes('/artist/42/albums')) return res({ body: { data: [album(2, 'Two')], next: null } }) as unknown as Response
      if (url.includes('/album/1/tracks') && !url.includes('index=')) {
        return res({ body: { data: [track(11, 'A')], next: 'https://api.deezer.com/album/1/tracks?index=1' } }) as unknown as Response
      }
      if (url.includes('/album/1/tracks')) return res({ body: { data: [track(12, 'B')], next: null } }) as unknown as Response
      if (url.includes('/album/2/tracks')) return res({ body: { data: [track(21, 'C')], next: null } }) as unknown as Response
      throw new Error(`unexpected request: ${url}`)
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.title)).toEqual(['A', 'B', 'C'])
  })
})

describe('getArtistTracks — quota and errors', () => {
  it('retries on HTTP 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const inner = deezer([album(1, 'LP')], { 1: [track(11, 'One')] })
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      calls++
      if (calls === 1) return res({ status: 429, headers: { 'retry-after': '2' }, body: {} }) as unknown as Response
      return inner(url)
    })
    const c = createDeezerClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getArtistTracks('42')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('retries the in-body quota error (code 4) in the MIDDLE of the walk', async () => {
    // The walk makes one request per release, so a quota hit lands on an album's tracks
    // call far more often than on the first request. HTTP 200 with the error in the body.
    const inner = deezer([album(1, 'LP')], { 1: [track(11, 'One')] })
    let albumCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/album/1/tracks') && ++albumCalls === 1) {
        return res({ body: { error: { code: 4, type: 'Exception', message: 'Quota limit exceeded' } } }) as unknown as Response
      }
      return inner(url)
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.deezer_id)).toEqual(['11'])
    expect(albumCalls).toBe(2)
  })

  it('throws on a non-quota in-body error', async () => {
    const fetchImpl = vi.fn(async () =>
      res({ body: { error: { code: 800, type: 'DataException', message: 'no data' } } }) as unknown as Response,
    )
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')).rejects.toThrow(/no data/)
  })

  it('throws a shaped error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')).rejects.toThrow(/500/)
  })

  it('gives up after maxRetries when the 429 never clears', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response)
    const c = createDeezerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getArtistTracks('42')).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // attempt + 2 retries, then stop
  })

  it('gives up after maxRetries when the in-body quota error never clears', async () => {
    const fetchImpl = vi.fn(
      async () => res({ body: { error: { code: 4, type: 'Exception', message: 'Quota limit exceeded' } } }) as unknown as Response,
    )
    const c = createDeezerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getArtistTracks('42')).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

/**
 * `next` is a URL the API hands back, so termination is Deezer's decision unless the
 * client refuses to trust it. Both guards are pinned by exact call counts; the mocks
 * refuse an extra request so a lost guard fails loudly instead of hanging the suite.
 */
describe('pagination termination', () => {
  it('stops when `next` points at a page already fetched (self-referential cursor)', async () => {
    const SELF = 'https://api.deezer.com/artist/42/albums?limit=100&index=0'
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/tracks')) return res({ body: { data: [], next: null } }) as unknown as Response
      if (++calls > 10) throw new Error('cursor loop did not terminate')
      return res({ body: { data: [album(calls, `A${calls}`)], next: SELF } }) as unknown as Response
    })
    await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(calls).toBe(2) // the first path, then SELF once — the repeat is refused
  })

  it('stops at maxPages when `next` keeps advancing forever', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/tracks')) return res({ body: { data: [], next: null } }) as unknown as Response
      calls++
      if (calls > 3) throw new Error('paged past maxPages')
      return res({
        body: { data: [album(calls, `A${calls}`)], next: `https://api.deezer.com/artist/42/albums?index=${calls}` },
      }) as unknown as Response
    })
    const c = createDeezerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxPages: 3,
    })
    await c.getArtistTracks('42')
    expect(calls).toBe(3)
  })
})
