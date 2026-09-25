// What the brand kit lists, and what each file is called, from the published door alone.
/**
 * kit/kit-entries.ts (pure). The route suite (brand-kit-route.test.ts) runs it end to end;
 * this file pins the naming and the door's odd shapes that a 2026-09-23 mutation run showed
 * the route suite never reached: a null entry in the door's arrays, a slot whose font is
 * missing, a font whose title does not slug, a long title cut at a hyphen, skipped.txt's
 * exact text.
 */
import { describe, expect, it } from 'vitest'
import { liveColors, nameSlug, planBrandKit, skippedTxt, type LiveBrand } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/kit-entries'

const A = 'a1'
const names = (live: LiveBrand) => planBrandKit(A, live).entries.map((e) => e.name)

describe('nameSlug', () => {
  it('folds accents and ß, lowercases, one hyphen between words, none at the ends', () => {
    expect(nameSlug('Café Straße')).toBe('cafe-strasse')
    expect(nameSlug('  --Tour   Logo!!-- ')).toBe('tour-logo')
    expect(nameSlug(null)).toBe('')
  })

  it('stops at 40 characters, and a cut that lands on a hyphen drops it', () => {
    expect(nameSlug('a'.repeat(50))).toBe('a'.repeat(40))
    expect(nameSlug(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39))
  })
})

describe('planBrandKit', () => {
  it('the door’s null entries are skipped, not a crash', () => {
    const live = {
      media: [null, { purpose: 'logo_primary', path: `${A}/brand/p.png` }, null],
      fonts: [null, { family: 'mori', label: 'Mori', path: `${A}/fonts/m.woff2` }],
      font_slots: { primary: 'mori' },
    } as unknown as LiveBrand
    expect(names(live)).toEqual(['logo-primary.png', 'font-mori.woff2'])
  })

  it('a slot ships the font NAMED by its family — not the first font in the list', () => {
    const live: LiveBrand = {
      fonts: [
        { family: 'mori', label: 'Mori', path: `${A}/fonts/m.woff2` },
        { family: 'spare', label: 'Spare', path: `${A}/fonts/s.ttf` },
      ],
      font_slots: { primary: 'spare' },
    }
    expect(names(live)).toEqual(['font-spare.ttf'])
  })

  it('a slot whose font is not in the door, or has no file, ships nothing and breaks nothing', () => {
    const live: LiveBrand = {
      fonts: [{ family: 'nofile', label: 'No file', path: null }],
      font_slots: { primary: 'gone', secondary: 'nofile', custom_1: null as unknown as string },
    }
    expect(planBrandKit(A, live)).toEqual({ entries: [], skipped: [] })
  })

  it('a font is named by its TITLE; its family only when the title will not slug; "font" when neither will', () => {
    const live: LiveBrand = {
      fonts: [
        { family: 'pp-mori-2', label: 'PP Mori', path: `${A}/fonts/1.woff2` },
        { family: 'grotesk', label: '★', path: `${A}/fonts/2.woff2` },
        { family: '☆', label: '★', path: `${A}/fonts/3.woff2` },
      ],
      font_slots: { primary: 'pp-mori-2', secondary: 'grotesk', custom_1: '☆' },
    }
    expect(names(live)).toEqual(['font-pp-mori.woff2', 'font-grotesk.woff2', 'font-font.woff2'])
  })

  it('three logos of one title: -2, then -3', () => {
    const logo = (n: number) => ({ purpose: 'logo', label: 'Tour', path: `${A}/brand/${n}.png` })
    expect(names({ media: [logo(1), logo(2), logo(3)] })).toEqual(['logo-tour.png', 'logo-tour-2.png', 'logo-tour-3.png'])
  })

  it('a path that is not this artist’s is reported by name, with the reason', () => {
    expect(planBrandKit(A, { media: [{ purpose: 'favicon', path: 'b2/brand/f.png' }] }).skipped).toEqual([
      { name: 'tab-icon', reason: 'not a file of this artist' },
    ])
  })

  it('CRITICAL: a GOOGLE font in a slot has no file to ship, so skipped.txt says where to get it — once, however many slots', () => {
    // 20260925120000: a Google font's door entry has no path. Silently leaving it out made
    // a kit whose Primary font was just missing. An upload beside it still ships.
    const live: LiveBrand = {
      fonts: [
        { family: 'archivo', label: 'Archivo', path: null, source: 'google', google_family: 'Archivo' },
        { family: 'mori', label: 'Mori', path: `${A}/fonts/m.woff2`, source: 'upload' },
      ],
      font_slots: { primary: 'archivo', secondary: 'mori', custom_1: 'archivo' },
    }
    expect(planBrandKit(A, live)).toEqual({
      entries: [{ name: 'font-mori.woff2', bucket: 'fonts', path: `${A}/fonts/m.woff2` }],
      skipped: [{ name: 'font-archivo', reason: 'a Google font, get Archivo from fonts.google.com' }],
    })
  })

  it('a Google font whose family is not Google-shaped is still reported, without repeating the name', () => {
    const live: LiveBrand = {
      fonts: [{ family: 'odd', label: 'Odd', path: null, source: 'google', google_family: 'Odd\nfake.png: line' }],
      font_slots: { primary: 'odd' },
    }
    expect(planBrandKit(A, live).skipped).toEqual([{ name: 'font-odd', reason: 'a Google font, get it from fonts.google.com' }])
  })
})

describe('liveColors — colors.txt reads the PUBLISHED palette', () => {
  it('the door’s brand.colors, in its order, name and hex only', () => {
    const live: LiveBrand = {
      brand: { colors: [{ key: 'primary', name: 'Red', hex: '#c63a2a' }, { key: 'cream', name: 'Cream', hex: '#f4f1ea' }] },
    }
    expect(liveColors(live)).toEqual([{ name: 'Red', hex: '#c63a2a' }, { name: 'Cream', hex: '#f4f1ea' }])
  })

  it('nothing published, no brand key (a door older than 20260925120000), or a malformed entry: no colour', () => {
    expect(liveColors(null)).toEqual([])
    expect(liveColors({})).toEqual([])
    expect(liveColors({ brand: { colors: null } })).toEqual([])
    const odd = { brand: { colors: [null, { name: 'No hex' }, { hex: '#000000' }, { name: 'Ok', hex: '#ffffff' }] } } as unknown as LiveBrand
    expect(liveColors(odd)).toEqual([{ name: 'Ok', hex: '#ffffff' }])
  })
})

describe('skippedTxt', () => {
  it('notes first, then one "name: why" line per file, each ending in a newline', () => {
    expect(skippedTxt([{ name: 'a.png', reason: 'x' }, { name: 'b.png', reason: 'y' }], ['Note.'])).toBe('Note.\na.png: x\nb.png: y\n')
    expect(skippedTxt([{ name: 'a.png', reason: 'x' }])).toBe('a.png: x\n')
  })
})
