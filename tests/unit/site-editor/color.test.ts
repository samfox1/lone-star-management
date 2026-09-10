import { describe, it, expect } from 'vitest'
import { clamp, contrastInk, fractionAt, hexToHsv, hsvToHex, hueHex, normalizeHex } from '@/lib/color'

describe('normalizeHex', () => {
  it('accepts 3/6/8-digit hexes, with or without the #, and lowercases them', () => {
    expect(normalizeHex('#abc')).toBe('#abc')
    expect(normalizeHex('abc')).toBe('#abc')
    expect(normalizeHex('  #ABCDEF ')).toBe('#abcdef')
    expect(normalizeHex('FF00FF80')).toBe('#ff00ff80')
  })

  it('rejects anything that is not a hex', () => {
    expect(normalizeHex('')).toBe('')
    expect(normalizeHex('red')).toBe('')
    expect(normalizeHex('#12')).toBe('')
    expect(normalizeHex('#1234567')).toBe('')
    expect(normalizeHex('#zzzzzz')).toBe('')
  })
})

describe('hexToHsv', () => {
  it('reads the primaries', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 })
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 1, v: 1 })
  })

  it('reads greys as unsaturated, with hue 0 (the caller keeps its own hue)', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 })
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 })
  })

  it('expands a 3-digit hex and ignores alpha', () => {
    expect(hexToHsv('#f00')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv('#ff000080')).toEqual({ h: 0, s: 1, v: 1 })
  })

  it('is null for a non-hex', () => {
    expect(hexToHsv('nope')).toBeNull()
    expect(hexToHsv('')).toBeNull()
  })
})

describe('hsvToHex', () => {
  it('writes the primaries', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff')
    expect(hsvToHex({ h: 0, s: 0, v: 0 })).toBe('#000000')
    expect(hsvToHex({ h: 0, s: 0, v: 1 })).toBe('#ffffff')
  })

  it('clamps out-of-range saturation/brightness and wraps hue', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: -60, s: 1, v: 1 })).toBe('#ff00ff')
    expect(hsvToHex({ h: 0, s: 5, v: 5 })).toBe('#ff0000')
    expect(hsvToHex({ h: 0, s: -1, v: -1 })).toBe('#000000')
  })

  it('round-trips every hex the picker can produce', () => {
    // The round trip must be EXACT: the square re-reads the hex on every drag frame, so
    // any drift would walk the colour away under a stationary pointer.
    for (const hex of ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b', '#123abc', '#010203', '#fefefe']) {
      const hsv = hexToHsv(hex)!
      expect(hsvToHex(hsv)).toBe(hex)
    }
  })

  it('holds the hue across a full brightness sweep', () => {
    // 8-bit channels can't express every hue at every brightness — near black, one
    // rounding step is worth about a degree. Within 2° is as true as the format allows,
    // and the picker never compounds it: hue lives in the component's own state, so a
    // vertical drag re-reads the hue it set, not the hex's approximation of it.
    const h = hexToHsv('#3b82f6')!.h
    for (let v = 0.05; v <= 1; v += 0.05) {
      expect(Math.abs(hexToHsv(hsvToHex({ h, s: 1, v }))!.h - h)).toBeLessThan(2)
    }
  })
})

describe('hueHex', () => {
  it('is the saturated, full-brightness colour for the hue', () => {
    expect(hueHex(0)).toBe('#ff0000')
    expect(hueHex(180)).toBe('#00ffff')
  })
})

describe('fractionAt', () => {
  it('maps a client coordinate into 0→1 across the element', () => {
    expect(fractionAt(50, 0, 200)).toBe(0.25)
    expect(fractionAt(120, 20, 200)).toBe(0.5)
  })

  it('clamps outside the element, and is 0 for an unmeasurable one', () => {
    expect(fractionAt(-40, 0, 200)).toBe(0)
    expect(fractionAt(999, 0, 200)).toBe(1)
    expect(fractionAt(50, 0, 0)).toBe(0) // jsdom / display:none — never NaN
  })
})

describe('contrastInk', () => {
  it('picks the ink that stays visible on the colour', () => {
    expect(contrastInk('#000000')).toBe('#ffffff')
    expect(contrastInk('#ffffff')).toBe('#000000')
    expect(contrastInk('#3b82f6')).toBe('#ffffff')
    expect(contrastInk('')).toBe('#000000')
  })
})

describe('clamp', () => {
  it('bounds a number', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
