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
  album: { cover_medium: `https://img/${id}.jpg` },
})

describe('getArtistTracks', () => {
  it('maps Deezer tracks to the sync shape (link-out, no audio)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { data: [track(10, 'Drive')], next: null } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toEqual([
      { deezer_id: '10', title: 'Drive', cover_url: 'https://img/10.jpg', provider_url: 'https://deezer.com/track/10' },
    ])
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
})
