// Font samples on the Brand page are sized by their MEASURED capital height.
/**
 * Sam, 2026-09-23: Skeen's handwriting face ("Sorg Font") read "super small" at 16px.
 * `font-size-adjust` was tried and failed twice over (the face's own metrics understate it,
 * and React turned the number into an invalid "0.5px"). Now the browser measures an "H"
 * and `fittedFontSize` picks the px giving every face the same capital height. jsdom has
 * no canvas, so the maths is pinned here, on the pure function all three samples use.
 */
import { describe, expect, it } from 'vitest'
import { faceOf, fittedFontSize, SAMPLE_CAP_PX, SAMPLE_MAX_PX, SAMPLE_MIN_PX } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/fonts/face'

describe('fittedFontSize', () => {
  it('gives a short-capped face a bigger size than a tall-capped one, to the same cap height', () => {
    const sorg = fittedFontSize(0.59) // measured on Skeen's Sorg Font
    const sans = fittedFontSize(0.72) // measured on Instrument Sans
    expect(sorg).toBeGreaterThan(sans)
    expect(Math.abs(sorg * 0.59 - SAMPLE_CAP_PX)).toBeLessThanOrEqual(0.6)
    expect(Math.abs(sans * 0.72 - SAMPLE_CAP_PX)).toBeLessThanOrEqual(0.6)
  })

  it('falls back to the plain size before the face is measured, or when it cannot be', () => {
    for (const r of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(fittedFontSize(r, SAMPLE_CAP_PX, 16), String(r)).toBe(16)
  })

  it('clamps a face with broken metrics, so a sample is never huge or unreadable', () => {
    expect(fittedFontSize(0.05)).toBe(SAMPLE_MAX_PX)
    expect(fittedFontSize(5)).toBe(SAMPLE_MIN_PX)
  })

  it('scales the clamp with a bigger target (the preview stage)', () => {
    expect(fittedFontSize(0.59, 23, 32)).toBeGreaterThan(fittedFontSize(0.59))
    expect(fittedFontSize(0.05, SAMPLE_CAP_PX * 2)).toBe(SAMPLE_MAX_PX * 2)
    // …and the floor scales UP with it, not down: a face with a huge cap at the preview's
    // target gets twice the minimum, not half.
    expect(fittedFontSize(5, SAMPLE_CAP_PX * 2)).toBe(SAMPLE_MIN_PX * 2)
  })
})

/**
 * `faceOf` — the CSS family a Brand sample is set in. An upload's token goes through the
 * sanitizer (the family is a CSS-injection sink); a GOOGLE font (20260925120000) is set in
 * its real family, because Google's stylesheet declares that and the token names no face —
 * but only a Google-shaped name gets through, or the token is used instead.
 */
describe('faceOf', () => {
  it('an upload is set in its sanitized token', () => {
    expect(faceOf('pp-mori')).toBe("'pp-mori', sans-serif")
    expect(faceOf("x'; } body{")).not.toContain('}')
  })

  it('CRITICAL: a Google font is set in its REAL family', () => {
    expect(faceOf('big-shoulders-display', 'Big Shoulders Display')).toBe("'Big Shoulders Display', sans-serif")
  })

  it('CRITICAL: a Google name that is not Google-shaped never reaches the style — the token does', () => {
    expect(faceOf('evil', "Evil'); } body{")).toBe("'evil', sans-serif")
    expect(faceOf('inter', null)).toBe("'inter', sans-serif")
  })
})
