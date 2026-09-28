// A region painted a BRAND colour follows the Brand page: `text-[brand-cream_#f4f1ea]` renders
// `color: var(--brand-cream, #f4f1ea)`, and anything malformed is dropped, never interpolated.
/**
 * BRAND COLOUR TOKENS (bridge 0.42.0; Sam, 2026-09-28: "They all should share and look at
 * the same variable, so if it changes on the brand page, it should everywhere").
 *
 * Before this, picking the Cream swatch stored `text-[#f4f1ea]`, a copy of the hex, so the
 * region never followed a Brand change. The brand token names the variable the site already
 * emits (`brandCss` → `--brand-cream`) and carries the hex it had when picked as the fallback,
 * so a site with no published brand still paints the colour the manager saw.
 *
 * STRICT, because the output lands in an inline `style` on every page a fan loads: the key
 * becomes part of a `var()` name and the hex a CSS value. The key must be brand.ts's key
 * shape (the door's and the DB CHECK's), the hex the colour tokens' existing hex shape.
 * Anything else is dropped: no style, and not even a dead class.
 */
import { describe, expect, it } from 'vitest'
import {
  auditRegions,
  colorClass,
  colorToken,
  familyOf,
  isBrandColorKey,
  mergeStyle,
  resolveRegionStyle,
  resolveStyle,
} from '@samfox1/site-bridge'

const CREAM = 'text-[brand-cream_#f4f1ea]'

describe('colorToken reads both shapes as { kind, hex, brandKey? }', () => {
  it('a plain hex token reads as kind hex, with no key', () => {
    expect(colorToken('text-[#f4f1ea]')).toEqual({ prop: 'color', kind: 'hex', hex: '#f4f1ea' })
    expect(colorToken('bg-[#000]')).toEqual({ prop: 'backgroundColor', kind: 'hex', hex: '#000' })
    expect(colorToken('border-[#ffffffcc]')).toEqual({ prop: 'borderColor', kind: 'hex', hex: '#ffffffcc' })
  })

  it('CRITICAL: a brand token reads as kind brand, its key, and the hex it carries', () => {
    expect(colorToken(CREAM)).toEqual({ prop: 'color', kind: 'brand', hex: '#f4f1ea', brandKey: 'cream' })
    expect(colorToken('bg-[brand-primary_#c63a2a]')).toEqual({
      prop: 'backgroundColor', kind: 'brand', hex: '#c63a2a', brandKey: 'primary',
    })
    expect(colorToken('border-[brand-dark-red-2_#AA0000]')).toEqual({
      prop: 'borderColor', kind: 'brand', hex: '#AA0000', brandKey: 'dark-red-2',
    })
  })

  it('only the three colour prefixes the editor writes', () => {
    expect(colorToken('decocolor-[brand-cream_#f4f1ea]')).toBeNull()
    expect(colorToken('hovercolor-[#f4f1ea]')).toBeNull()
    // A prototype member is not a colour prefix (`COLOR_PROPS.constructor` is a function).
    expect(colorToken('constructor-[#f4f1ea]')).toBeNull()
    expect(resolveStyle('constructor-[#f4f1ea]').style).toEqual({})
  })
})

describe('colorClass writes the brand token only for a valid key', () => {
  it('with a key: the brand token; without one: the plain hex, as before', () => {
    expect(colorClass('text', '#f4f1ea', 'cream')).toBe(CREAM)
    expect(colorClass('bg', '#c63a2a', 'primary')).toBe('bg-[brand-primary_#c63a2a]')
    expect(colorClass('border', '#0a0a0a', 'black')).toBe('border-[brand-black_#0a0a0a]')
    expect(colorClass('text', '#f4f1ea')).toBe('text-[#f4f1ea]')
  })

  it('CRITICAL: a hostile or malformed key falls back to the plain hex token', () => {
    for (const key of ['', 'Cream', 'cr_eam', 'cream);color:red', '-cream', 'cream-', 'cr--eam', 'a'.repeat(41), 'crème']) {
      expect(colorClass('text', '#f4f1ea', key), JSON.stringify(key)).toBe('text-[#f4f1ea]')
    }
  })

  it('a hex that is not a hex never becomes a brand token', () => {
    expect(colorClass('text', 'red', 'cream')).not.toContain('brand-')
    expect(colorClass('text', '#f4f1ea;x', 'cream')).not.toContain('brand-')
  })

  it('round trip: what colorClass writes, colorToken reads back', () => {
    for (const prefix of ['text', 'bg', 'border'] as const) {
      for (const key of ['primary', 'secondary', 'cream', 'dark-red-2', 'a'.repeat(40)]) {
        const read = colorToken(colorClass(prefix, '#12ab34', key))
        expect(read, `${prefix}/${key}`).toMatchObject({ kind: 'brand', hex: '#12ab34', brandKey: key })
      }
      expect(colorToken(colorClass(prefix, '#12ab34'))).toMatchObject({ kind: 'hex', hex: '#12ab34' })
    }
  })

  it('isBrandColorKey is the brand.ts rule: kebab words, at most 40', () => {
    expect(isBrandColorKey('cream')).toBe(true)
    expect(isBrandColorKey('color-3')).toBe(true)
    expect(isBrandColorKey('a'.repeat(40))).toBe(true)
    expect(isBrandColorKey('a'.repeat(41))).toBe(false)
    expect(isBrandColorKey('Cream')).toBe(false)
    expect(isBrandColorKey(undefined)).toBe(false)
  })
})

describe('the site renders a brand token as var(--brand-<key>, <hex>)', () => {
  it('CRITICAL: a section text colour becomes var(--brand-cream, #f4f1ea) and replaces the base colour', () => {
    const r = resolveRegionStyle('hero', 'relative text-ink bg-black', `lse-delta ${CREAM}`)
    expect(r.style.color).toBe('var(--brand-cream, #f4f1ea)')
    // The delta replaced the textColor family: the base palette class is gone, the
    // background (another family) stays, and the token itself never reaches the class list.
    expect(r.className.split(' ')).toEqual(['relative', 'bg-black'])
  })

  it('background and border colours too', () => {
    expect(resolveRegionStyle('band', 'bg-black', 'lse-delta bg-[brand-primary_#c63a2a]').style.backgroundColor).toBe(
      'var(--brand-primary, #c63a2a)',
    )
    expect(resolveStyle('border-[brand-black_#0a0a0a]').style.borderColor).toBe('var(--brand-black, #0a0a0a)')
    // A per-item overlay (the photo border) lifts it the same way.
    expect(resolveRegionStyle('image:1', 'border-4', 'border-[brand-black_#0a0a0a]').style.borderColor).toBe(
      'var(--brand-black, #0a0a0a)',
    )
  })

  it('CRITICAL: a section BORDER colour keeps the base border width (a 0.41 applier stripped it)', () => {
    // The base's width (`border`) stays; its hex colour, the same family, is replaced.
    const r = resolveRegionStyle('card', 'border border-[#333333]', 'lse-delta border-[brand-black_#0a0a0a]')
    expect(r.className.split(' ')).toEqual(['border'])
    expect(r.style.borderColor).toBe('var(--brand-black, #0a0a0a)')
  })

  it('families: text / bg / border brand tokens are the three colour families', () => {
    expect(familyOf(CREAM)).toBe('textColor')
    expect(familyOf('bg-[brand-cream_#f4f1ea]')).toBe('bgColor')
    expect(familyOf('border-[brand-cream_#f4f1ea]')).toBe('borderColor')
    // A brand token and a hex token of one channel replace each other in a delta.
    expect(mergeStyle('r', 'text-[#123456]', `lse-delta ${CREAM}`)).toBe(CREAM)
    expect(mergeStyle('r', CREAM, 'lse-delta text-[#123456]')).toBe('text-[#123456]')
  })

  it('a site base may wear one: the audit recognises it as a colour the picker can show', () => {
    expect(auditRegions([{ key: 'hero', base: `grid ${CREAM}` }], [])).toEqual([])
  })
})

describe('CRITICAL: anything malformed is dropped, never interpolated', () => {
  const HOSTILE = [
    'text-[brand-cream);background:url(//evil)_#f4f1ea]',
    'text-[brand-cream_#f4f1ea);background:url(//evil]',
    'text-[brand-cream_#f4f1ea;color:red]',
    'text-[brand-Cream_#f4f1ea]',
    'text-[brand-_#f4f1ea]',
    'text-[brand--cream_#f4f1ea]',
    'text-[brand-cream-_#f4f1ea]',
    'text-[brand-cr--eam_#f4f1ea]',
    'text-[brand-cr_eam_#f4f1ea]',
    `text-[brand-${'a'.repeat(41)}_#f4f1ea]`,
    'text-[brand-cream_red]',
    'text-[brand-cream_#ggg]',
    'text-[brand-cream_#123456789]',
    'text-[brand-cream_#f4f1ea_#000000]',
    'text-[brand-cream]',
    'text-[brand-cream,#f4f1ea]',
    'text-[brand-cream_]',
    'bg-[brand-x}body{color:red_#000]',
    'border-[brand-x\\;_#000]',
  ]

  for (const token of HOSTILE) {
    it(token, () => {
      expect(colorToken(token)).toBeNull()
      // Neither the section path (colour-only lift) nor the item path (full lift) puts
      // anything of it in a style, and neither leaves it behind as a class.
      for (const r of [resolveRegionStyle('hero', 'text-ink', `lse-delta ${token}`), resolveStyle(token)]) {
        const css = Object.values(r.style).join(' ')
        expect(css).not.toContain('var(')
        expect(css).not.toContain('brand')
        expect(r.className.split(' ')).not.toContain(token)
      }
      // It is no colour family, so it strips nothing: the base colour still shows.
      expect(familyOf(token)).toBeNull()
      expect(resolveRegionStyle('hero', 'text-ink', `lse-delta ${token}`).className).toBe('text-ink')
    })
  }

  it('the boundary key (40 characters) is accepted', () => {
    const key = 'a'.repeat(40)
    expect(resolveStyle(`text-[brand-${key}_#f4f1ea]`).style.color).toBe(`var(--brand-${key}, #f4f1ea)`)
  })
})
