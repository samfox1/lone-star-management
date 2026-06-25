/**
 * PHASE 4 (Videos) — youtubeClient, test-first. Uses the quota-cheap path
 * (channels.list → contentDetails.relatedPlaylists.uploads → playlistItems.list,
 * ~1 unit/page), NOT search.list (100 units). Mocked at the fetch boundary.
 */
import { describe, expect, it, vi } from 'vitest'
import { createYouTubeClient } from '@/lib/youtube'

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
  return createYouTubeClient({ apiKey: 'k', fetchImpl, sleep: () => Promise.resolve() })
}

const channelsResp = (uploads: string) =>
  res({ body: { items: [{ contentDetails: { relatedPlaylists: { uploads } } }] } })

const item = (id: string, title: string) => ({
  snippet: { title, resourceId: { kind: 'youtube#video', videoId: id } },
})

describe('getChannelVideos', () => {
  it('resolves the uploads playlist, then maps playlist items to videos', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({ body: { items: [item('vid1', 'My Video')] } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out).toEqual([
      {
        youtube_id: 'vid1',
        title: 'My Video',
        provider: 'youtube',
        embed_url: 'https://www.youtube.com/embed/vid1',
      },
    ])
    // proves the cheap path: channels + playlistItems, never search.list
    const urls = fetchImpl.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('/channels'))).toBe(true)
    expect(urls.some((u) => u.includes('/playlistItems'))).toBe(true)
    expect(urls.some((u) => u.includes('/search'))).toBe(false)
  })

  it('follows nextPageToken pagination and concatenates', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return (url.includes('pageToken=PAGE2')
        ? res({ body: { items: [item('v2', 'Two')] } })
        : res({ body: { items: [item('v1', 'One')], nextPageToken: 'PAGE2' } })) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out.map((v) => v.youtube_id)).toEqual(['v1', 'v2'])
  })

  it('returns [] for a channel with no uploads playlist', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { items: [] } }) as unknown as Response)
    expect(await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')).toEqual([])
  })

  it('retries on 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      calls++
      return (calls === 1
        ? res({ status: 429, headers: { 'retry-after': '2' }, body: {} })
        : res({ body: { items: [item('v1', 'One')] } })) as unknown as Response
    })
    const c = createYouTubeClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getChannelVideos('CH1')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('throws a shaped error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 403, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')).rejects.toThrow(/403/)
  })

  it('throws when no API key is configured', async () => {
    const c = createYouTubeClient({ fetchImpl: (async () => res({ body: {} })) as unknown as typeof fetch })
    await expect(c.getChannelVideos('CH1')).rejects.toThrow(/YouTube/i)
  })
})
