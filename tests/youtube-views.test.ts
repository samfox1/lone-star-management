/**
 * youtubeClient.viewCounts — global YouTube view counts via videos.list?part=statistics
 * (batched 50/call), used to cache each video's reach on sync. Mocked at the fetch
 * boundary. (Kept separate from youtube.test.ts, which owns getChannelVideos/Shorts.)
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

describe('viewCounts', () => {
  it('parses statistics.viewCount per id; skips missing/non-numeric', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/videos?part=statistics')
      return res({
        body: {
          items: [
            { id: 'a', statistics: { viewCount: '1234' } },
            { id: 'b', statistics: { viewCount: '56' } },
            { id: 'c', statistics: {} }, // no count → skipped
          ],
        },
      }) as unknown as Response
    })
    const counts = await client(fetchImpl as unknown as typeof fetch).viewCounts(['a', 'b', 'c'])
    expect(counts.get('a')).toBe(1234)
    expect(counts.get('b')).toBe(56)
    expect(counts.has('c')).toBe(false)
  })

  it('batches ids 50 at a time', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { items: [] } }) as unknown as Response)
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`)
    await client(fetchImpl as unknown as typeof fetch).viewCounts(ids)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 50 + 50 + 20
  })

  it('is a no-op for no ids', async () => {
    const fetchImpl = vi.fn()
    const counts = await client(fetchImpl as unknown as typeof fetch).viewCounts([])
    expect(counts.size).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
