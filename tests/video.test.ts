/**
 * Video auto-detect for the "Add" modal: resolveVideo maps a pasted YouTube/SoundCloud
 * URL to a safe embed URL (via embedInfo) + title/thumbnail from the provider oEmbed,
 * and degrades gracefully when oEmbed fails or the URL isn't a supported provider.
 */
import { describe, expect, it, vi } from 'vitest'
import { resolveVideo } from '@/lib/video'

function oembed(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

describe('resolveVideo', () => {
  it('resolves a YouTube watch URL to embed + oEmbed title/thumbnail', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('youtube.com/oembed')
      return oembed({ title: 'Live at Luck', thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' })
    })
    const meta = await resolveVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(meta).toEqual({
      title: 'Live at Luck',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    })
  })

  it('returns null for a non-YouTube/SoundCloud URL (no fetch)', async () => {
    const fetchImpl = vi.fn()
    expect(await resolveVideo('https://vimeo.com/123', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('still returns the safe embed (empty title) when oEmbed fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('oembed down')
    })
    const meta = await resolveVideo('https://youtu.be/dQw4w9WgXcQ', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(meta).toEqual({
      title: '',
      provider: 'youtube',
      embed_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      thumbnail: null,
    })
  })
})
