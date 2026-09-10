// The XSS gate for video embeds: known providers only, everything else refused.
/**
 * PHASE 4 (Videos) — embedInfo(): the XSS gate for video embeds. A video's
 * embed_url becomes an <iframe src>, so only known providers (YouTube,
 * SoundCloud) are allowed; everything else (javascript:, arbitrary domains) is
 * rejected. embedInfo normalizes a provider URL to a safe embed URL + provider,
 * or returns null.
 */
import { describe, expect, it } from 'vitest'
import { embedInfo, isSafeEmbedSrc } from '@/lib/embed'

describe('embedInfo — YouTube', () => {
  it('normalizes watch / youtu.be / embed URLs to a safe embed URL (not a Short)', () => {
    const want = { provider: 'youtube', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', isShort: false }
    expect(embedInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(want)
    expect(embedInfo('https://youtu.be/dQw4w9WgXcQ')).toEqual(want)
    expect(embedInfo('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual(want)
    expect(embedInfo('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toEqual(want)
  })

  it('flags a /shorts/ URL as a Short (and still normalizes to the same embed URL)', () => {
    expect(embedInfo('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      isShort: true,
    })
  })
})

describe('embedInfo — SoundCloud', () => {
  it('accepts a track URL and yields a soundcloud player embed', () => {
    const info = embedInfo('https://soundcloud.com/artist/some-track')
    expect(info?.provider).toBe('soundcloud')
    expect(info?.embedUrl).toContain('w.soundcloud.com/player')
    expect(info?.embedUrl).toContain(encodeURIComponent('https://soundcloud.com/artist/some-track'))
  })
})

describe('embedInfo — rejects everything else (XSS gate)', () => {
  it.each([
    'javascript:alert(1)',
    'https://evil.com/embed/x',
    'https://notyoutube.com/watch?v=x',
    'data:text/html,<script>alert(1)</script>',
    'https://www.youtube.com/',
    '',
    'not a url',
  ])('rejects %s', (url) => {
    expect(embedInfo(url)).toBeNull()
  })
})

describe('isSafeEmbedSrc — render-time iframe guard', () => {
  it('allows only the provider embed origins', () => {
    expect(isSafeEmbedSrc('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true)
    expect(isSafeEmbedSrc('https://w.soundcloud.com/player/?url=x')).toBe(true)
    expect(isSafeEmbedSrc('https://evil.com/embed/x')).toBe(false)
    expect(isSafeEmbedSrc('https://www.youtube.com/watch?v=x')).toBe(false)
    expect(isSafeEmbedSrc('javascript:alert(1)')).toBe(false)
  })
})
