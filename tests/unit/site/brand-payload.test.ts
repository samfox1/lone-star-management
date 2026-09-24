// The preview payload's brand colours and fonts follow the door's rules exactly.
/**
 * `getWorkingSitePayload` (lib/site.ts) is the preview's copy of `get_public_site`: the
 * editor posts it to a custom site over `init-data`, and preview-parity compares the two
 * with toEqual. The brand-sync migration (20260925120000) taught the door two new rules, and
 * these are the TypeScript halves, pinned DB-free (the live comparison is in
 * tests/integration/manager-tools/brand/brand-sync.test.ts):
 *
 *   brand.colors   Primary, Secondary, then the rest in their order; a row whose key or hex
 *                  the bridge could not put in CSS is DROPPED, as the door drops it.
 *   fonts          an upload needs its file; a Google font needs a well-formed Google name;
 *                  every font says its `source`, and only a Google font has a
 *                  `google_family` key at all (the door's exact object shape).
 */
import { describe, expect, it } from 'vitest'
import { brandColorsPayload, fontPayload } from '@/lib/site'

describe('brandColorsPayload', () => {
  it('CRITICAL: Primary, Secondary, then the added colours in the order they came', () => {
    const rows = [
      { key: 'cream', name: 'Cream', hex: '#f4f1ea', slot: null },
      { key: 'secondary', name: 'Secondary', hex: '#8dbfd5', slot: 'secondary' },
      { key: 'black', name: 'Black', hex: '#0a0a0a', slot: null },
      { key: 'primary', name: 'Primary', hex: '#c63a2a', slot: 'primary' },
    ]
    expect(brandColorsPayload(rows)).toEqual([
      { key: 'primary', name: 'Primary', hex: '#c63a2a' },
      { key: 'secondary', name: 'Secondary', hex: '#8dbfd5' },
      { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
      { key: 'black', name: 'Black', hex: '#0a0a0a' },
    ])
  })

  it('CRITICAL: a key or hex the bridge could not interpolate is dropped, as the door drops it', () => {
    const good = { key: 'ink', name: 'Ink', hex: '#111111', slot: null }
    const rows = [
      good,
      { key: 'x;}body{', name: 'Evil', hex: '#111111', slot: null },
      { key: 'Upper', name: 'Upper', hex: '#111111', slot: null },
      { key: 'a--b', name: 'Double', hex: '#111111', slot: null },
      { key: 'k'.repeat(41), name: 'Long', hex: '#111111', slot: null },
      { key: 'red', name: 'Red', hex: 'red', slot: null },
      { key: 'shout', name: 'Shout', hex: '#FFFFFF', slot: null },
      { name: 'Before the migration', hex: '#222222', slot: null }, // no key yet: not on the wire
    ]
    expect(brandColorsPayload(rows)).toEqual([{ key: 'ink', name: 'Ink', hex: '#111111' }])
  })

  it('the note never rides — only key, name and hex', () => {
    const [c] = brandColorsPayload([{ key: 'ink', name: 'Ink', hex: '#111111', slot: null, note: 'SECRET' } as never])
    expect(Object.keys(c).sort()).toEqual(['hex', 'key', 'name'])
  })
})

describe('fontPayload', () => {
  const upload = { family: 'sorg', label: 'Sorg', storage_path: 'a1/fonts/x.woff2', format: 'woff2', source: 'upload', google_family: null }
  const google = { family: 'big-shoulders-display', label: 'Big Shoulders Display', storage_path: null, format: null, source: 'google', google_family: 'Big Shoulders Display' }

  it('CRITICAL: an upload keeps its shape plus `source` — and has NO google_family key', () => {
    expect(fontPayload(upload)).toEqual({ family: 'sorg', label: 'Sorg', path: 'a1/fonts/x.woff2', format: 'woff2', source: 'upload' })
    expect(fontPayload(upload)).not.toHaveProperty('google_family')
  })

  it('a row from before the migration (no source) is an upload', () => {
    const old: Record<string, unknown> = { ...upload }
    delete old.source
    delete old.google_family
    expect(fontPayload(old)).toMatchObject({ source: 'upload', path: 'a1/fonts/x.woff2' })
  })

  it('CRITICAL: a Google font carries its Google name and null path/format', () => {
    expect(fontPayload(google)).toEqual({
      family: 'big-shoulders-display',
      label: 'Big Shoulders Display',
      path: null,
      format: null,
      source: 'google',
      google_family: 'Big Shoulders Display',
    })
  })

  it('CRITICAL: what the door would not load is dropped — an upload with no file, a malformed Google name', () => {
    expect(fontPayload({ ...upload, storage_path: null })).toBeNull()
    expect(fontPayload({ ...google, google_family: "Evil'); }" })).toBeNull()
    expect(fontPayload({ ...google, google_family: null })).toBeNull()
    expect(fontPayload({ ...upload, family: '' })).toBeNull()
  })
})
