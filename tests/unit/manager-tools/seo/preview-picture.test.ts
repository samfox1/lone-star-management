/**
 * The preview picture made on the Listing tab is 1200 × 630 with the logo centred, never cropped,
 * on a SOLID background that is never transparent.
 *
 * Code:     src/lib/manager-tools/seo/og-card.ts (OG_CARD_WIDTH / HEIGHT, ogCardDrawBox,
 *           OG_BACKGROUNDS, ogBackgroundHex)
 * Feature:  SEO / GEO page · Listing tab, "Preview picture"; feeds the `share` and `preview` tests
 *           (Looks right when shared)
 * Tier:     STRICT (AGENTS.md "Test depth"): the broken render happens on someone else's server,
 *           invisible from inside the app. TRANSPARENCY: a logo PNG has alpha, and platforms lay
 *           it on THEIR background, so a black logo turns into a blank square in dark mode.
 *           ASPECT: previews are ~1.91:1, and a logo of another shape is cropped or letterboxed
 *           as the platform likes. Baking a solid background into the right shape settles both here.
 * Covers:   • the card is the 1.91:1 shape every platform crops to
 *           • the logo is contained (never cropped), never stretched, centred, with a margin
 *           • an image that failed to decode gives an empty box, not NaN
 *           • every offered background, and a picked colour, fills as an opaque hex; anything
 *             else (unknown, alpha, transparent) falls back to WHITE, never to transparent
 *           • light and dark are both offered
 * Not here: the picture editor on the page (tests/components/manager-tools/seo/details-tab.test.tsx).
 * Fixtures: none: pure functions over made-up image sizes and colour strings.
 */
import { describe, expect, it } from 'vitest'
import { OG_CARD_WIDTH, OG_CARD_HEIGHT, OG_BACKGROUNDS, ogCardDrawBox, ogBackgroundHex } from '@/lib/manager-tools/seo/og-card'

describe('card dimensions', () => {
  // The shape: 1200 × 630, the 1.91:1 the platforms publish (a range, since the need is "nobody crops it").
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

  // Contained, never cropped, whatever the logo's shape (a cropped wordmark loses its last letter).
  it('CONTAINS the logo — never crops it, whatever its shape', () => {
    // A cropped logo is a wordmark with its last letter missing, on the image that
    // represents the artist everywhere the link is shared.
    for (const [w, h] of [[1000, 700], [700, 1000], [4000, 100], [100, 4000], [1200, 630]]) {
      const b = box(w, h)
      expect(b.width).toBeLessThanOrEqual(OG_CARD_WIDTH + 0.001)
      expect(b.height).toBeLessThanOrEqual(OG_CARD_HEIGHT + 0.001)
    }
  })

  // Never stretched: the logo keeps its shape.
  it('preserves the aspect ratio — a logo is never stretched', () => {
    const b = box(1000, 500)
    expect(b.width / b.height).toBeCloseTo(2, 5)
  })

  // Centred on both axes.
  it('centres the logo on both axes', () => {
    const b = box(600, 600)
    expect(b.x + b.width / 2).toBeCloseTo(OG_CARD_WIDTH / 2, 5)
    expect(b.y + b.height / 2).toBeCloseTo(OG_CARD_HEIGHT / 2, 5)
  })

  // A margin all round: platforms round corners and lay badges over the edges.
  it('CRITICAL: leaves margin — the logo never touches the edge', () => {
    // Platforms round the corners and overlay UI (a play badge, a domain label) on the
    // card. A logo run to the bleed loses its edge to whichever chrome lands on it.
    const b = box(4000, 4000) // would fill the height exactly with no inset
    expect(b.x).toBeGreaterThan(0)
    expect(b.y).toBeGreaterThan(0)
    expect(b.height).toBeLessThan(OG_CARD_HEIGHT)
  })

  // A failed image gives an empty box, not NaN (which paints nothing and reports nothing).
  it('a zero-dimension image yields an empty box, not NaN', () => {
    // An image that failed to decode must not poison the canvas with NaN geometry,
    // which paints nothing and reports no error.
    expect(ogCardDrawBox({ width: 0, height: 100 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(ogCardDrawBox({ width: 100, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('ogBackgroundHex', () => {
  // Every offered background is a hex the canvas can fill.
  it('every offered background resolves to a hex the canvas can fill', () => {
    for (const bg of OG_BACKGROUNDS) {
      expect(ogBackgroundHex(bg.value)).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  // A bad stored value falls back to white, never to transparent (that is the black-on-black bug).
  it('CRITICAL: an unknown value falls back to WHITE, never to transparent', () => {
    // The entire point is that the card is opaque. A bad stored value degrading to
    // "no fill" reintroduces exactly the black-on-black bug.
    expect(ogBackgroundHex('nonsense')).toBe('#ffffff')
    expect(ogBackgroundHex('')).toBe('#ffffff')
    expect(ogBackgroundHex(undefined)).toBe('#ffffff')
  })

  // A picked colour fills as itself, opaque; anything with alpha is not a colour here, so white.
  it('CRITICAL: a picked colour (a Brand colour, or one mixed in the picker) fills as itself, opaque', () => {
    expect(ogBackgroundHex('#1A2B3C')).toBe('#1a2b3c')
    expect(ogBackgroundHex('#abc')).toBe('#aabbcc')
    // An alpha channel would bring the transparency back: not a colour here, so white.
    for (const v of ['#1a2b3c80', '#abcd', 'rgba(0,0,0,0)', 'transparent', '#12345g', 'url(x)']) expect(ogBackgroundHex(v), v).toBe('#ffffff')
  })

  // Both light and dark are offered: a white logo needs a dark card, a black logo a light one.
  it('offers both light and dark, because a logo is one or the other', () => {
    // A white logo needs a dark card and a black logo needs a light one; offering only
    // one guarantees half of all artists get an invisible image.
    const hexes = OG_BACKGROUNDS.map((b) => ogBackgroundHex(b.value).toLowerCase())
    expect(hexes).toContain('#ffffff')
    expect(hexes).toContain('#000000')
  })
})
