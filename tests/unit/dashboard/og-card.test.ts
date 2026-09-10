// The social preview card: fixed size, solid background, logo centred and never transparent.
/**
 * The social preview card: 1200x630, logo centred on a SOLID background.
 *
 * Two failures this exists to prevent, both invisible from inside the app because the
 * broken render happens on someone else's server:
 *
 *   TRANSPARENCY. A logo PNG is RGBA. Social platforms composite og:image onto THEIR
 *   background, so a black logo on alpha is black-on-black in every dark-mode client —
 *   the manager sees a perfect logo locally and a blank square in the share.
 *
 *   ASPECT. og:image previews are ~1.91:1. A 1.42:1 logo gets cropped or letterboxed by
 *   the platform, and which one is up to the platform.
 *
 * Baking a solid background into a correctly-shaped canvas settles both here, where we
 * can see the result, rather than hoping.
 */
import { describe, expect, it } from 'vitest'
import { OG_CARD_WIDTH, OG_CARD_HEIGHT, OG_BACKGROUNDS, ogCardDrawBox, ogBackgroundHex } from '@/lib/og-card'

describe('card dimensions', () => {
  it('is the 1.91:1 shape every platform crops to', () => {
    expect(OG_CARD_WIDTH).toBe(1200)
    expect(OG_CARD_HEIGHT).toBe(630)
    // 1200x630 is the size the platforms themselves publish; it works out at 1.9048,
    // which is what "1.91:1" means in practice. Asserted as a RANGE rather than to two
    // decimals, because the real requirement is "close enough that nobody crops it",
    // not a number that happens to round.
    const ratio = OG_CARD_WIDTH / OG_CARD_HEIGHT
    expect(ratio).toBeGreaterThan(1.9)
    expect(ratio).toBeLessThan(1.92)
  })
})

describe('ogCardDrawBox', () => {
  const box = (w: number, h: number) => ogCardDrawBox({ width: w, height: h })

  it('CONTAINS the logo — never crops it, whatever its shape', () => {
    // A cropped logo is a wordmark with its last letter missing, on the image that
    // represents the artist everywhere the link is shared.
    for (const [w, h] of [[1000, 700], [700, 1000], [4000, 100], [100, 4000], [1200, 630]]) {
      const b = box(w, h)
      expect(b.width).toBeLessThanOrEqual(OG_CARD_WIDTH + 0.001)
      expect(b.height).toBeLessThanOrEqual(OG_CARD_HEIGHT + 0.001)
    }
  })

  it('preserves the aspect ratio — a logo is never stretched', () => {
    const b = box(1000, 500)
    expect(b.width / b.height).toBeCloseTo(2, 5)
  })

  it('centres the logo on both axes', () => {
    const b = box(600, 600)
    expect(b.x + b.width / 2).toBeCloseTo(OG_CARD_WIDTH / 2, 5)
    expect(b.y + b.height / 2).toBeCloseTo(OG_CARD_HEIGHT / 2, 5)
  })

  it('CRITICAL: leaves margin — the logo never touches the edge', () => {
    // Platforms round the corners and overlay UI (a play badge, a domain label) on the
    // card. A logo run to the bleed loses its edge to whichever chrome lands on it.
    const b = box(4000, 4000) // would fill the height exactly with no inset
    expect(b.x).toBeGreaterThan(0)
    expect(b.y).toBeGreaterThan(0)
    expect(b.height).toBeLessThan(OG_CARD_HEIGHT)
  })

  it('a zero-dimension image yields an empty box, not NaN', () => {
    // An image that failed to decode must not poison the canvas with NaN geometry,
    // which paints nothing and reports no error.
    expect(ogCardDrawBox({ width: 0, height: 100 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(ogCardDrawBox({ width: 100, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('ogBackgroundHex', () => {
  it('every offered background resolves to a hex the canvas can fill', () => {
    for (const bg of OG_BACKGROUNDS) {
      expect(ogBackgroundHex(bg.value)).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('CRITICAL: an unknown value falls back to WHITE, never to transparent', () => {
    // The entire point is that the card is opaque. A bad stored value degrading to
    // "no fill" reintroduces exactly the black-on-black bug.
    expect(ogBackgroundHex('nonsense')).toBe('#ffffff')
    expect(ogBackgroundHex('')).toBe('#ffffff')
    expect(ogBackgroundHex(undefined)).toBe('#ffffff')
  })

  it('offers both light and dark, because a logo is one or the other', () => {
    // A white logo needs a dark card and a black logo needs a light one; offering only
    // one guarantees half of all artists get an invisible image.
    const hexes = OG_BACKGROUNDS.map((b) => ogBackgroundHex(b.value).toLowerCase())
    expect(hexes).toContain('#ffffff')
    expect(hexes).toContain('#000000')
  })
})
