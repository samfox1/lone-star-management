// The Brand page's reads: custom font slots, the palette's defaults, and the logo list.
/**
 * The pure helpers and read shapes the Brand page's tabs are built on. Fake client, no
 * database; the reads' RLS and the columns themselves are pinned by
 * tests/integration/brand/brand-page.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { CUSTOM_FONT_SLOTS, FONT_SLOTS, isCustomSlot, loadBrandFonts, nextFreeCustomSlot } from '@/lib/fonts'
import { MAX_BRAND_COLORS, nextColorName, toStoredHex } from '@/lib/brand-colors'
import { brandRefusal, cleanLine, cleanNote, loadBrandLogos } from '@/lib/brand'
import { fakeClient, filterValue } from '@tests/unit/brand/_fake-client'

describe('custom font slots', () => {
  it('are DERIVED from the platform vocabulary: every custom_* slot, nothing else', () => {
    expect(CUSTOM_FONT_SLOTS).toEqual(FONT_SLOTS.filter((s) => s.startsWith('custom_')))
    expect(CUSTOM_FONT_SLOTS.length).toBeGreaterThan(0)
    for (const s of FONT_SLOTS) expect(isCustomSlot(s)).toBe(s.startsWith('custom_'))
  })

  it('the next free one is the first unfilled, and null when all are used (the Add row hides)', () => {
    expect(nextFreeCustomSlot([])).toBe(CUSTOM_FONT_SLOTS[0])
    expect(nextFreeCustomSlot(['primary', CUSTOM_FONT_SLOTS[0]])).toBe(CUSTOM_FONT_SLOTS[1])
    // A gap is filled before the end: removing the first added font frees its slot.
    expect(nextFreeCustomSlot([CUSTOM_FONT_SLOTS[1]])).toBe(CUSTOM_FONT_SLOTS[0])
    expect(nextFreeCustomSlot(CUSTOM_FONT_SLOTS)).toBeNull()
  })

  it('loadBrandFonts: built-ins always present, added rows only once filled, weights and notes carried', async () => {
    const fake = fakeClient((c) => {
      if (c.table === 'artist_fonts')
        return {
          data: [
            { id: 'f1', label: 'Mori', family: 'mori', format: 'woff2', storage_path: 'a1/fonts/1.woff2', weight: 700 },
            { id: 'f2', label: 'Mono', family: 'mono-1', format: 'ttf', storage_path: 'a1/fonts/2.ttf', weight: null },
          ],
        }
      if (c.table === 'artist_font_slots')
        return {
          data: [
            { slot: 'primary', font_id: 'f1', label: null, note: null },
            { slot: 'custom_2', font_id: 'f2', label: 'Credits', note: 'liner notes' },
          ],
        }
      return { data: [] }
    })
    const fonts = await loadBrandFonts(fake.client, 'a1')
    expect(fonts.primary.font?.weight).toBe(700)
    expect(fonts.secondary).toEqual({ slot: 'secondary', label: null, note: null, font: null })
    expect(fonts.custom).toEqual([
      {
        slot: 'custom_2',
        label: 'Credits',
        note: 'liner notes',
        font: { id: 'f2', label: 'Mono', family: 'mono-1', format: 'ttf', storagePath: 'a1/fonts/2.ttf', weight: null },
      },
    ])
    expect(fonts.nextCustomSlot).toBe('custom_1')
    expect(fonts.fonts).toHaveLength(2)
    // Reads the TABLES: the publish view deliberately lacks weight/label/note.
    expect(fake.calls.map((c) => c.table).sort()).toEqual(['artist_font_slots', 'artist_fonts'])
  })

  it('a failed read throws rather than showing an empty Fonts tab — either read', async () => {
    for (const table of ['artist_fonts', 'artist_font_slots']) {
      const fake = fakeClient((c) => (c.table === table ? { error: { message: `boom ${table}` } } : { data: [] }))
      await expect(loadBrandFonts(fake.client, 'a1')).rejects.toThrow(`boom ${table}`)
    }
  })
})

describe('colours', () => {
  it('a new colour pre-fills the first free "Color N"', () => {
    expect(nextColorName([])).toBe('Color 1')
    expect(nextColorName(['Color 1', 'color 2', 'Ink'])).toBe('Color 3')
    expect(nextColorName(['Color 2'])).toBe('Color 1')
  })

  it('a typed hex is normalised; anything else goes to the database as typed', () => {
    expect(toStoredHex('ABC')).toBe('#aabbcc')
    expect(toStoredHex(' #1A2B3C ')).toBe('#1a2b3c')
    expect(toStoredHex('teal')).toBe('teal')
    // 8 digits is a hex to the picker, but the column takes 6 — the CHECK says no.
    expect(toStoredHex('#11223344')).toBe('#11223344')
  })

  it('the cap is stated where the UI can read it', () => {
    expect(MAX_BRAND_COLORS).toBe(24)
  })
})

describe('titles and notes', () => {
  it('one line, trimmed; an empty note is no note', () => {
    expect(cleanLine('  Tour\r\n  logo ')).toBe('Tour logo')
    expect(cleanNote('   ')).toBeNull()
    expect(cleanNote(undefined)).toBeNull()
  })

  it('an unrecognised refusal falls back to the caller’s sentence, a denial says so', () => {
    expect(brandRefusal({ code: '23505', message: 'duplicate key' }, 'Could not save.')).toBe('Could not save.')
    expect(brandRefusal({ code: '42501', message: 'new row violates row-level security policy' }, 'x')).toBe(
      'You can’t change this artist’s brand.',
    )
  })
})

describe('loadBrandLogos', () => {
  it('splits built-ins from added logos, in order, with notes and originals', async () => {
    const row = (id: string, purpose: string, extra: Record<string, unknown> = {}) => ({
      id,
      purpose,
      label: null,
      note: null,
      storage_path: `a1/brand/${id}.png`,
      source_path: null,
      sort_order: 1,
      ...extra,
    })
    const fake = fakeClient(() => ({
      data: [
        row('p1', 'logo_primary'),
        row('l1', 'logo', { label: 'Tour', note: 'for merch', source_path: 'a1/brand/o.png' }),
        row('l2', 'logo', { label: 'Mono' }),
      ],
    }))
    const logos = await loadBrandLogos(fake.client, 'a1')
    expect(logos.primary?.id).toBe('p1')
    expect(logos.secondary).toBeNull()
    expect(logos.added.map((l) => [l.id, l.label, l.note, l.sourcePath])).toEqual([
      ['l1', 'Tour', 'for merch', 'a1/brand/o.png'],
      ['l2', 'Mono', null, null],
    ])
    // Only logo purposes are read — never the favicon or a gallery photo.
    expect(filterValue(fake.calls[0], 'purpose', 'in')).toEqual(['logo_primary', 'logo_secondary', 'logo'])
  })
})
