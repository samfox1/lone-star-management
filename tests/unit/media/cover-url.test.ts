// Shrinking a cover URL for a dashboard tile: Spotify, SoundCloud and our own storage all
//   serve smaller variants by URL, so a 192px tile need not download a 640px file.
/**
 * WHY (Sam, 2026-09-10: "it takes way too long to bounce between the pages on the assets
 * page … Can we compress the image that we see to a lower quality so that its not as much
 * data loading?"). Measured on Skeen's Music tab: 30 covers, 5.8 MB — Spotify's 640px art
 * at ~276 KB each and one uploaded cover at 1.1 MB, every one of them drawn 192px wide.
 *
 * No pipeline is needed. Spotify encodes the size in the image id's prefix
 * (…b273 = 640, …1e02 = 300, …4851 = 64), SoundCloud in the filename suffix
 * (t500x500 / t300x300 / t200x200), and our own bucket has the Pro-plan render endpoint
 * (mediaThumbUrl). Measured: the same Spotify cover is 74 KB at 640 and 17 KB at 300.
 *
 * PURE and TOTAL: an unknown host comes back untouched, never null — a tile with no image
 * is worse than a tile with a big one.
 */
import { describe, expect, it } from 'vitest'
import { coverThumbUrl } from '@/lib/cover-url'

const SP640 = 'https://i.scdn.co/image/ab67616d0000b27302e3919b9f17620c0e5a12ab'

describe('coverThumbUrl', () => {
  it('CRITICAL: a Spotify 640 cover becomes the 300 variant for a tile', () => {
    expect(coverThumbUrl(SP640, 192)).toBe('https://i.scdn.co/image/ab67616d00001e0202e3919b9f17620c0e5a12ab')
  })
  it('a tiny request gets the 64 variant', () => {
    expect(coverThumbUrl(SP640, 48)).toBe('https://i.scdn.co/image/ab67616d0000485102e3919b9f17620c0e5a12ab')
  })
  it('a request larger than 300 keeps the 640 original — never upscale', () => {
    expect(coverThumbUrl(SP640, 400)).toBe(SP640)
  })
  it('CRITICAL: a SoundCloud t500x500 becomes t300x300 for a tile', () => {
    expect(coverThumbUrl('https://i1.sndcdn.com/artworks-abc-t500x500.jpg', 192)).toBe('https://i1.sndcdn.com/artworks-abc-t300x300.jpg')
    expect(coverThumbUrl('https://i1.sndcdn.com/artworks-abc-t500x500.jpg', 100)).toBe('https://i1.sndcdn.com/artworks-abc-t200x200.jpg')
  })
  it('CRITICAL: an object in our own media bucket goes through the render endpoint', () => {
    const ours = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/a1/covers/x.jpg`
    const out = coverThumbUrl(ours, 192)
    expect(out).toContain('/storage/v1/render/image/public/media/a1/covers/x.jpg')
    expect(out).toMatch(/width=/)
  })
  it('CRITICAL: an unknown host is returned untouched, never dropped', () => {
    expect(coverThumbUrl('https://example.com/art.png', 192)).toBe('https://example.com/art.png')
  })
  it('null in, null out', () => {
    expect(coverThumbUrl(null, 192)).toBeNull()
  })
})

/* ── the guards Stryker found unwatched on the first run ───────────────────────────────
 * Three mutants survive after this block and are EQUIVALENT, recorded so nobody chases
 * them: dropping the `i` flag on the two host regexes and on the id/suffix patterns
 * changes nothing, because `new URL().host` is already lowercase, Spotify ids are
 * lowercase hex, and SoundCloud suffixes are lowercase. The behaviour cannot differ. */
describe('coverThumbUrl — host and boundary guards', () => {
  it('CRITICAL: a Spotify-shaped id on another host is left alone', () => {
    // The id pattern alone is not proof — only i.scdn.co serves the size-prefix trick.
    // Rewriting a lookalike on some other host would 404 the cover.
    const fake = 'https://cdn.example.com/image/ab67616d0000b27302e3919b9f17620c0e5a12ab'
    expect(coverThumbUrl(fake, 192)).toBe(fake)
  })
  it('CRITICAL: the host check is anchored — scdn.co inside a longer host does not count', () => {
    for (const host of ['i.scdn.co.evil.com', 'notscdn.co']) {
      const u = `https://${host}/image/ab67616d0000b27302e3919b9f17620c0e5a12ab`
      expect(coverThumbUrl(u, 192), host).toBe(u)
    }
  })
  it('the 1.25× rule is what picks the variant: 240 draws the 300, 241 keeps the 640', () => {
    // 240 × 1.25 = 300 exactly → the 300 still fits. One pixel more and it does not.
    expect(coverThumbUrl(SP640, 240)).toContain('ab67616d00001e02')
    expect(coverThumbUrl(SP640, 241)).toBe(SP640)
  })
  it('the 64 boundary is inclusive too', () => {
    expect(coverThumbUrl(SP640, 51.2)).toContain('ab67616d00004851') // 51.2 × 1.25 = 64
    expect(coverThumbUrl(SP640, 52)).toContain('ab67616d00001e02')
  })
  it('SoundCloud boundaries follow the same rule', () => {
    const sc = 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg'
    expect(coverThumbUrl(sc, 160)).toContain('t200x200') // 160 × 1.25 = 200
    expect(coverThumbUrl(sc, 161)).toContain('t300x300')
    expect(coverThumbUrl(sc, 240)).toContain('t300x300') // 300 exactly
    expect(coverThumbUrl(sc, 241)).toContain('t500x500')
  })
  it('a SoundCloud-shaped filename on another host is left alone', () => {
    const fake = 'https://cdn.example.com/artworks-abc-t500x500.jpg'
    expect(coverThumbUrl(fake, 192)).toBe(fake)
  })
})

describe('coverThumbUrl — our bucket asks the render endpoint for 2× the draw size, capped', () => {
  const ours = (f: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${f}`
  it('a 192px tile asks for a 384 box', () => {
    expect(coverThumbUrl(ours('a1/c.jpg'), 192)).toMatch(/width=384/)
  })
  it('a 400px draw is capped at 640 — the endpoint is not asked to upscale past the original', () => {
    expect(coverThumbUrl(ours('a1/c.jpg'), 400)).toMatch(/width=640/)
  })
  it('a bare sndcdn.com host (no subdomain) still counts as SoundCloud', () => {
    expect(coverThumbUrl('https://sndcdn.com/artworks-abc-t500x500.jpg', 192)).toContain('t300x300')
  })
  it('a bare scdn.co host still counts as Spotify', () => {
    expect(coverThumbUrl('https://scdn.co/image/ab67616d0000b27302e3919b9f17620c0e5a12ab', 192)).toContain('1e02')
  })
})
