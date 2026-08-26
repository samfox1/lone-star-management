/**
 * PHASE 4 (Videos) — youtubeClient, test-first. Uses the quota-cheap path
 * (channels.list → contentDetails.relatedPlaylists.uploads → playlistItems.list,
 * ~1 unit/page), NOT search.list (100 units). Mocked at the fetch boundary.
 * Shorts are classified by probing youtube.com/shorts/<id> (200 ⟹ Short).
 */
import { describe, expect, it, vi } from 'vitest'
import { createYouTubeClient, channelSelector } from '@/lib/youtube'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

// A /shorts/ probe that reports "not a Short" (a normal video 3xx-redirects to /watch).
const notShort = () => res({ status: 303, body: {} })

function client(fetchImpl: typeof fetch) {
  return createYouTubeClient({ apiKey: 'k', fetchImpl, sleep: () => Promise.resolve() })
}

const channelsResp = (uploads: string) =>
  res({ body: { items: [{ contentDetails: { relatedPlaylists: { uploads } } }] } })

const item = (id: string, title: string, publishedAt?: string) => ({
  snippet: { title, ...(publishedAt ? { publishedAt } : {}), resourceId: { kind: 'youtube#video', videoId: id } },
})

describe('getChannelVideos', () => {
  it('resolves the uploads playlist, then maps playlist items to videos', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({ body: { items: [item('vid1', 'My Video', '2025-10-05T23:00:06Z')] } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out).toEqual([
      {
        youtube_id: 'vid1',
        title: 'My Video',
        provider: 'youtube',
        embed_url: 'https://www.youtube.com/embed/vid1',
        is_short: false,
        // snippet.publishedAt → the video's OWN date, for VideoObject.uploadDate (20260826180000)
        published_at: '2025-10-05T23:00:06Z',
      },
    ])
    // proves the cheap path: channels + playlistItems, never search.list
    const urls = fetchImpl.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('/channels'))).toBe(true)
    expect(urls.some((u) => u.includes('/playlistItems'))).toBe(true)
    expect(urls.some((u) => u.includes('/search'))).toBe(false)
  })

  // A private/deleted upload still occupies a playlist slot but carries no
  // resourceId; emitted, it becomes a video row whose embed_url ends in
  // "undefined" — a dead player on the artist's site.
  it('skips playlist items with no videoId, and defaults a missing title to empty', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({
        body: {
          items: [
            { snippet: { title: 'Deleted video' } }, // no resourceId → dropped
            { snippet: { resourceId: { videoId: 'v2' } } }, // no title → ''
          ],
        },
      }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out).toEqual([
      {
        youtube_id: 'v2',
        title: '',
        provider: 'youtube',
        embed_url: 'https://www.youtube.com/embed/v2',
        is_short: false,
        published_at: null,
      },
    ])
  })

  it('probes /shorts/ with HEAD and redirect:manual (a followed 3xx would read as 200)', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({ body: { items: [item('v1', 'One')] } }) as unknown as Response
    })
    await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    const probe = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/shorts/'))
    expect(probe).toBeDefined()
    const init = probe![1] as RequestInit
    expect(init.method).toBe('HEAD') // body bytes are never read; GET pulls the page
    expect(init.redirect).toBe('manual') // following the 3xx turns every video into a Short
  })

  it('bounds Shorts probes to 8 in flight (unbounded would open a socket per upload)', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, i) => item(`v${i}`, `V${i}`))
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      if (!url.includes('/shorts/')) return res({ body: { items } }) as unknown as Response
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 0)) // hold the probe open so overlap is observable
      inFlight--
      return notShort() as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out).toHaveLength(20)
    expect(peak).toBe(8) // exactly the cap: neither serialized nor unbounded
  })

  // Without the cap a channel whose nextPageToken never clears (or repeats) pages
  // forever. The mock refuses a fourth page so the failure is loud, not a hang.
  it('stops paging at maxPages even while nextPageToken keeps coming', async () => {
    let pages = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      pages++
      if (pages > 3) throw new Error('paged past maxPages')
      return res({ body: { items: [item(`v${pages}`, `V${pages}`)], nextPageToken: `P${pages}` } }) as unknown as Response
    })
    const c = createYouTubeClient({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxPages: 3,
    })
    const out = await c.getChannelVideos('CH1')
    expect(pages).toBe(3)
    expect(out.map((v) => v.youtube_id)).toEqual(['v1', 'v2', 'v3'])
  })

  it('classifies Shorts (200) vs normal uploads (redirect) via the /shorts/ probe', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) {
        // vid_short serves the Short (200); vid_long redirects to /watch (303).
        return res({ status: url.includes('vid_short') ? 200 : 303, body: {} }) as unknown as Response
      }
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({ body: { items: [item('vid_long', 'Long'), item('vid_short', 'Short')] } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out.find((v) => v.youtube_id === 'vid_long')?.is_short).toBe(false)
    expect(out.find((v) => v.youtube_id === 'vid_short')?.is_short).toBe(true)
  })

  it('treats a failed /shorts/ probe as a normal video (safe default)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) throw new Error('network')
      if (url.includes('/channels')) return channelsResp('UU123') as unknown as Response
      return res({ body: { items: [item('v1', 'One')] } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('CH1')
    expect(out[0].is_short).toBe(false)
  })

  it('follows nextPageToken pagination and concatenates', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
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
      if (url.includes('/shorts/')) return notShort() as unknown as Response
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
    vi.stubEnv('YOUTUBE_API_KEY', '') // ignore any real key in .env.local
    const c = createYouTubeClient({ fetchImpl: (async () => res({ body: {} })) as unknown as typeof fetch })
    await expect(c.getChannelVideos('CH1')).rejects.toThrow(/YouTube/i)
    vi.unstubAllEnvs()
  })

  it('resolves an @handle via forHandle, so importing @Sskeen works', async () => {
    let channelsUrl = ''
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/shorts/')) return notShort() as unknown as Response
      if (url.includes('/channels')) {
        channelsUrl = url
        return channelsResp('UU123') as unknown as Response
      }
      return res({ body: { items: [item('v1', 'One')] } }) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getChannelVideos('@Sskeen')
    expect(out).toHaveLength(1)
    expect(channelsUrl).toContain('forHandle=%40Sskeen')
    expect(channelsUrl).not.toContain('id=')
  })
})

describe('channelSelector', () => {
  it('maps every channel-reference form to the right channels.list param', () => {
    // UC id → id=
    expect(channelSelector('UC1234567890123456789012')).toBe('id=UC1234567890123456789012')
    // @handle and bare name → forHandle= (@ added)
    expect(channelSelector('@Sskeen')).toBe('forHandle=%40Sskeen')
    expect(channelSelector('Sskeen')).toBe('forHandle=%40Sskeen')
    // pasted URLs
    expect(channelSelector('https://youtube.com/@Sskeen')).toBe('forHandle=%40Sskeen')
    expect(channelSelector('https://www.youtube.com/channel/UC1234567890123456789012')).toBe('id=UC1234567890123456789012')
    expect(channelSelector('https://youtube.com/user/OldName')).toBe('forUsername=OldName')
  })
})
