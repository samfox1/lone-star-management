// WCAG 2.x contrast for the Colors playground's "Easy to read" / "Hard to read"
// verdict. Deliberately a SEPARATE curve from color.ts's contrastInk (Rec. 601 luma,
// used only to keep the picker's drag-handle ring visible) — different spec, different
// threshold, and this file pins the WCAG one against numbers the spec itself publishes.
import { describe, expect, it } from 'vitest'
import { contrastRatio, isReadable, rgbToHex } from '@/lib/color'

describe('contrastRatio', () => {
  it('is 21:1 for pure black on pure white, the maximum possible', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio('#3366cc', '#3366cc')).toBeCloseTo(1, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('does not care which argument is foreground vs background', () => {
    expect(contrastRatio('#222222', '#eeeeee')).toBeCloseTo(contrastRatio('#eeeeee', '#222222'), 10)
  })

  it('matches the WCAG spec\'s own worked example: #767676 on white is 4.54:1', () => {
    // This is the grey WCAG's own examples use as "just barely passes AA on white" —
    // a real anchor, not a number this test invented from the implementation.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })

  it('accepts the hex shapes normalizeHex accepts: 3-digit and with alpha', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 2)
    expect(contrastRatio('#000000ff', '#ffffff80')).toBeCloseTo(21, 2) // alpha ignored
  })

  it('a DARK channel takes the spec\'s linear segment (c / 12.92): #0a0a0a on black is 1.06:1', () => {
    // 10/255 = 0.039 sits under WCAG's 0.03928 knee, so its luminance is 0.00304 — the
    // worked value, not one derived from this implementation.
    expect(contrastRatio('#0a0a0a', '#000000')).toBeCloseTo(1.0607, 3)
  })

  it('CRITICAL: reads an unparsable hex as no contrast (1), not a crash or NaN', () => {
    // A mid-edit hex field ("#a", "", "red") must not blow up a live playground.
    expect(contrastRatio('nope', '#ffffff')).toBe(1)
    expect(contrastRatio('#ffffff', '')).toBe(1)
    expect(Number.isNaN(contrastRatio('#zzzzzz', '#000000'))).toBe(false)
  })
})

describe('isReadable', () => {
  it('CRITICAL: is true only at or above the 4.5:1 AA threshold', () => {
    // This pins the threshold BETWEEN 4.48 and 4.54, not the `=` in `>= 4.5`: turning it into
    // `> 4.5` stays green (checked 2026-09-23), and it is an equivalent mutant for this
    // input — no 6-digit colour is exactly 4.5:1 on white or on black (all 16.7M tried).
    expect(isReadable('#767676', '#ffffff')).toBe(true) // 4.54:1
    expect(isReadable('#949494', '#ffffff')).toBe(false) // ~3.5:1, a shade lighter
  })

  it('black on white and white on black both read easily', () => {
    expect(isReadable('#000000', '#ffffff')).toBe(true)
    expect(isReadable('#ffffff', '#000000')).toBe(true)
  })

  it('two similar mid-greys are hard to read', () => {
    expect(isReadable('#888888', '#999999')).toBe(false)
  })
})

describe('rgbToHex', () => {
  it('two digits per channel, zero-padded, rounded and clamped', () => {
    expect(rgbToHex(0, 10, 255)).toBe('#000aff')
    expect(rgbToHex(300, -5, 127.6)).toBe('#ff0080')
  })
})
