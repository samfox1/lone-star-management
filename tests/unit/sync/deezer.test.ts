// The Deezer client: mapping songs, paging, de-duping titles, and backing off a quota error.
/**
 * PHASE 2 — deezerClient, test-first. Mocked at the fetch boundary (fast,
 * deterministic, no creds — Deezer's public API needs none). Covers mapping,
 * `next` pagination, title dedupe, HTTP-429 backoff, Deezer's in-body quota
 * error (code 4) backoff, and shaped errors.
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

const track = (id: number, title: string) => ({
  id,
  title,
  link: `https://deezer.com/track/${id}`,
  duration: 98,
  album: { title: 'Weather', cover_medium: `https://img/${id}.jpg` },
})

describe('getArtistTracks', () => {
  it('maps Deezer tracks to the sync shape (link-out, no audio)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { data: [track(10, 'Drive')], next: null } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toEqual([
      { deezer_id: '10', title: 'Drive', album_name: 'Weather', cover_url: 'https://img/10.jpg', provider_url: 'https://deezer.com/track/10', duration_ms: 98000 },
    ])
  })

  it('reads the album title Deezer already sends — not selecting it made the sync blank it downstream', async () => {
    const fetchImpl = vi.fn(async () =>
      res({ body: { data: [{ id: 11, title: 'Solo', album: { cover_medium: null } }], next: null } }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out[0].album_name).toBeNull() // absent stays absent; it is never invented
  })

  it('follows `next` pagination and concatenates pages', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      (url.includes('index=1')
        ? res({ body: { data: [track(2, 'Two')], next: null } })
        : res({ body: { data: [track(1, 'One')], next: 'https://api.deezer.com/artist/42/top?index=1' } })) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.title)).toEqual(['One', 'Two'])
  })

  it('dedupes by lowercased title', async () => {
    const fetchImpl = vi.fn(async () =>
      res({ body: { data: [track(1, 'Echo'), track(2, 'ECHO')], next: null } }) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toHaveLength(1)
  })

  it('retries on HTTP 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return (calls === 1
        ? res({ status: 429, headers: { 'retry-after': '2' }, body: {} })
        : res({ body: { data: [track(1, 'One')], next: null } })) as unknown as Response
    })
    const c = createDeezerClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getArtistTracks('42')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('retries on the in-body quota error (code 4)', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return (calls === 1
        ? res({ body: { error: { code: 4, type: 'Exception', message: 'Quota limit exceeded' } } })
        : res({ body: { data: [track(1, 'One')], next: null } })) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toHaveLength(1)
    expect(calls).toBe(2)
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
    const SELF = 'https://api.deezer.com/artist/42/top?limit=100&index=0'
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      if (++calls > 10) throw new Error('cursor loop did not terminate')
      return res({ body: { data: [track(calls, `T${calls}`)], next: SELF } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(calls).toBe(2) // the first path, then SELF once — the repeat is refused
    expect(out.map((t) => t.title)).toEqual(['T1', 'T2'])
  })

  it('stops at maxPages when `next` keeps advancing forever', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls > 3) throw new Error('paged past maxPages')
      return res({
        body: { data: [track(calls, `T${calls}`)], next: `https://api.deezer.com/artist/42/top?index=${calls}` },
      }) as unknown as Response
    })
    const c = createDeezerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxPages: 3,
    })
    const out = await c.getArtistTracks('42')
    expect(calls).toBe(3)
    expect(out.map((t) => t.title)).toEqual(['T1', 'T2', 'T3'])
  })
})
