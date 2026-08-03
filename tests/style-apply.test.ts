import { describe, it, expect } from 'vitest'
import {
  isItemKey,
  mergeStyle,
  resolveRegionStyle,
  resolveStyle,
  siteSwatches,
  usedColors,
} from '@/lib/site-editor/style-apply'

describe('resolveStyle — arbitrary colours leave the class string', () => {
  it('lifts border/text/background hexes into inline CSS', () => {
    expect(resolveStyle('border-[#123abc]')).toEqual({ className: '', style: { borderColor: '#123abc' } })
    expect(resolveStyle('text-[#fff]')).toEqual({ className: '', style: { color: '#fff' } })
    expect(resolveStyle('bg-[#00ff0080]')).toEqual({ className: '', style: { backgroundColor: '#00ff0080' } })
  })

  it('keeps everything a build CAN compile as a class', () => {
    // border-[4px] is a LENGTH, not a colour: it is safelisted, so it must stay a class.
    const r = resolveStyle('scale-110 opacity-50 border-[4px] border-[#ff0000] rounded-[6px] shadow-lg')
    expect(r.className).toBe('scale-110 opacity-50 border-[4px] rounded-[6px] shadow-lg')
    expect(r.style).toEqual({ borderColor: '#ff0000' })
  })

  it('leaves named colour utilities alone — the site compiles its own tokens', () => {
    const r = resolveStyle('bg-flash-1 text-red-500 border-2')
    expect(r.className).toBe('bg-flash-1 text-red-500 border-2')
    expect(r.style).toEqual({})
  })

  it('is empty for an empty string, and the last token of a property wins', () => {
    expect(resolveStyle('')).toEqual({ className: '', style: {} })
    expect(resolveStyle('border-[#000000] border-[#ffffff]').style).toEqual({ borderColor: '#ffffff' })
  })

  it('ignores a prefix with no colour meaning, and a malformed arbitrary value', () => {
    expect(resolveStyle('ring-[#ff0000]').className).toBe('ring-[#ff0000]') // not a managed prop
    expect(resolveStyle('border-[#xyz]').className).toBe('border-[#xyz]') // not a hex
  })
})

describe('isItemKey', () => {
  it('reads the colon convention: items are prefixed, sections are bare', () => {
    expect(isItemKey('slot:polaroid_1_photo')).toBe(true)
    expect(isItemKey('image:1f0a4c2e-0000-4000-8000-000000000000')).toBe(true)
    expect(isItemKey('hero_wordmark')).toBe(false)
    expect(isItemKey('footer')).toBe(false)
  })
})

describe('mergeStyle — items add, sections replace', () => {
  const BASE = 'absolute inset-0 h-full w-full object-cover'

  it('a section override REPLACES the base (the manager edited the whole string)', () => {
    expect(mergeStyle('hero_video', BASE, 'h-32 w-32')).toBe('h-32 w-32')
  })

  it('an item overlay is APPENDED to the base, and wins on equal specificity', () => {
    expect(mergeStyle('slot:polaroid_1_photo', BASE, 'scale-110 rounded-[6px]')).toBe(
      `${BASE} scale-110 rounded-[6px]`,
    )
  })

  it('an item overlay on an unstyled element is just the overlay', () => {
    expect(mergeStyle('image:abc', '', 'scale-110')).toBe('scale-110')
  })

  it('a blank override falls back to the base for BOTH kinds — clearing restores', () => {
    expect(mergeStyle('hero_video', BASE, '')).toBe(BASE)
    expect(mergeStyle('slot:polaroid_1_photo', BASE, '   ')).toBe(BASE)
  })
})

describe('usedColors — what the site already uses', () => {
  it('collects every hex across all regions, most-used first', () => {
    const styles = {
      hero_wordmark: 'text-[#ff0000]',
      'slot:polaroid_1_photo': 'border-[4px] border-[#123abc]',
      'slot:polaroid_2_photo': 'border-[#123abc]',
      footer: 'bg-[#123abc] text-[#ff0000]',
    }
    expect(usedColors(styles)).toEqual(['#123abc', '#ff0000'])
  })

  it('treats #FFF and #ffffff as one colour', () => {
    expect(usedColors({ a: 'text-[#FFF]', b: 'bg-[#ffffff]' })).toEqual(['#ffffff'])
  })

  it('keeps first-seen order when counts tie, so the row does not reshuffle', () => {
    expect(usedColors({ a: 'text-[#111111]', b: 'text-[#222222]' })).toEqual(['#111111', '#222222'])
  })

  it('ignores non-colour classes, empty strings and named tokens', () => {
    expect(usedColors({ a: 'scale-110 border-[4px] bg-flash-1', b: '', c: 'rounded-full' })).toEqual([])
    expect(usedColors({})).toEqual([])
  })

  it('caps the list so the swatch row cannot run away', () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`r${i}`, `text-[#${i.toString(16).padStart(6, '0')}]`]),
    )
    expect(usedColors(many)).toHaveLength(12)
    expect(usedColors(many, 3)).toHaveLength(3)
  })
})

describe('siteSwatches — the site palette, then its one-offs', () => {
  const OPTIONS = {
    textColors: [
      { value: 'text-flash-1', label: 'Red', hex: '#c63a2a' },
      { value: 'text-black', label: 'Black', hex: '#000000' },
    ],
    bgColors: [
      { value: 'bg-cream', label: 'Cream', hex: '#f4f1ea' },
      { value: 'bg-flash-1', label: 'Red', hex: '#c63a2a' }, // same colour, one swatch
    ],
  }

  it('offers the declared palette first, then colours only used in saved styles', () => {
    expect(siteSwatches(OPTIONS, { footer: 'border-[#123abc]' })).toEqual([
      '#c63a2a',
      '#000000',
      '#f4f1ea',
      '#123abc',
    ])
  })

  it('never lists a palette colour twice, however it was reached', () => {
    // Using a palette colour on an item must not duplicate its swatch.
    expect(siteSwatches(OPTIONS, { 'slot:a': 'border-[#C63A2A]' })).toEqual([
      '#c63a2a',
      '#000000',
      '#f4f1ea',
    ])
  })

  it('ignores colour options that declare no hex — a class name is not a colour', () => {
    // This is why skeen showed nothing at first: it declared `text-flash-1` with no hex,
    // and the editor has no access to the site's stylesheet to look it up.
    expect(siteSwatches({ textColors: [{ value: 'text-flash-1', label: 'Red' }] }, {})).toEqual([])
  })

  it('works with no palette at all, and caps the row', () => {
    expect(siteSwatches(undefined, { a: 'border-[#111111]' })).toEqual(['#111111'])
    expect(siteSwatches(undefined, {}, 5)).toEqual([])
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`r${i}`, `text-[#${i.toString(16).padStart(6, '0')}]`]),
    )
    expect(siteSwatches(OPTIONS, many, 6)).toHaveLength(6)
  })
})

describe('resolveRegionStyle — the whole pipeline', () => {
  it('merges the overlay, then splits the colour out of it', () => {
    expect(resolveRegionStyle('slot:polaroid_1_photo', 'w-full object-cover', 'border-[4px] border-[#123abc]')).toEqual({
      className: 'w-full object-cover border-[4px]',
      style: { borderColor: '#123abc' },
    })
  })

  it('a cleared item leaves the base untouched and NO inline colour', () => {
    expect(resolveRegionStyle('slot:polaroid_1_photo', 'w-full object-cover', '')).toEqual({
      className: 'w-full object-cover',
      style: {},
    })
  })
})
