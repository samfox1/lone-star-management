// Primary and Secondary lead the palette everywhere it is read, and a slot is written by one upsert.
/**
 * lib/brand-colors.ts, the built-in colours (20260924130000), over the fake client — no
 * database. What the live constraints hold is pinned by
 * tests/integration/brand/brand-colors-slots.test.ts; this pins what the lib does with it:
 *
 *   - listBrandColors puts Primary, then Secondary, then the added colours in the order the
 *     database gave them — whatever sort_order the slotted rows carry. Every reader (the
 *     Colors tab, the site editor's swatches, the logo circles, the kit's colors.txt) takes
 *     this order, so the editor shows Primary first by construction.
 *   - it reads `*`, so the Logos/Colors/kit pages do not break on a database without `slot`;
 *     a row without one is an added colour.
 *   - setSlotColor is ONE upsert keyed on (artist_id, slot), with the fixed name.
 */
import { describe, expect, it } from 'vitest'
import {
  COLOR_SLOTS,
  COLOR_SLOT_NAMES,
  FIRST_ADDED_COLOR,
  MAX_ADDED_COLORS,
  MAX_BRAND_COLORS,
  listBrandColors,
  nextColorName,
  paletteOrder,
  setSlotColor,
} from '@/lib/brand-colors'
import { fakeClient } from '@tests/unit/brand/_fake-client'

const row = (id: string, name: string, slot: string | null, sort_order: number) => ({
  id,
  name,
  hex: '#112233',
  note: null,
  sort_order,
  artist_id: 'a1',
  created_at: '2026-09-24T00:00:00Z',
  ...(slot === undefined ? {} : { slot }),
})

describe('listBrandColors', () => {
  it('CRITICAL: Primary, then Secondary, then the added colours in the database’s order', async () => {
    // The database orders by sort_order; the built-ins carry whatever sort_order they got.
    const fake = fakeClient(() => ({
      data: [
        row('c3', 'Color 3', null, 0),
        row('s2', 'Secondary', 'secondary', 1),
        row('c4', 'Color 4', null, 2),
        row('s1', 'Primary', 'primary', 5),
        row('c5', 'Color 5', null, 6),
      ],
    }))
    const colors = await listBrandColors(fake.client, 'a1')
    expect(colors.map((c) => c.id)).toEqual(['s1', 's2', 'c3', 'c4', 'c5'])
    expect(colors.map((c) => c.slot)).toEqual(['primary', 'secondary', null, null, null])
    const read = fake.calls[0]
    expect(read.table).toBe('brand_colors')
    expect(read.filters).toContainEqual(['eq', 'artist_id', 'a1'])
  })

  it('CRITICAL: reads every column, so a database without `slot` (before the push) still reads — all added', async () => {
    const fake = fakeClient(() => ({
      data: [
        { id: 'c1', name: 'Color 1', hex: '#000000', note: null, sort_order: 0 },
        { id: 'c2', name: 'Color 2', hex: '#ffffff', note: 'x', sort_order: 1 },
      ],
    }))
    const colors = await listBrandColors(fake.client, 'a1')
    expect(fake.calls[0].cols).toBe('*')
    expect(colors.map((c) => [c.id, c.slot])).toEqual([
      ['c1', null],
      ['c2', null],
    ])
  })

  it('a slot value the page does not know is read as an added colour, never as a built-in', async () => {
    const fake = fakeClient(() => ({ data: [row('x', 'Tertiary', 'tertiary', 0), row('p', 'Primary', 'primary', 1)] }))
    const colors = await listBrandColors(fake.client, 'a1')
    expect(colors.map((c) => [c.id, c.slot])).toEqual([
      ['p', 'primary'],
      ['x', null],
    ])
  })

  it('a refused read throws (the page shows its error, not an empty palette)', async () => {
    const fake = fakeClient(() => ({ error: { message: 'boom' } }))
    await expect(listBrandColors(fake.client, 'a1')).rejects.toThrow('boom')
  })
})

describe('paletteOrder', () => {
  it('is stable: added colours keep their order, and so do two rows of one slot', () => {
    const list = [
      { id: 'a', slot: null },
      { id: 'b', slot: 'secondary' as const },
      { id: 'c', slot: null },
      { id: 'd', slot: 'primary' as const },
    ]
    expect(paletteOrder(list).map((c) => c.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']) // not sorted in place
  })
})

describe('setSlotColor', () => {
  it('CRITICAL: ONE upsert of the slot, its fixed name and the stored hex — no read, no second write', async () => {
    const fake = fakeClient(() => ({ data: [row('s1', 'Primary', 'primary', 0)] }))
    const res = await setSlotColor(fake.client, 'a1', 'primary', ' #ABC ')
    expect(res.ok).toBe(true)
    expect(res.color).toMatchObject({ id: 's1', name: 'Primary', slot: 'primary' })
    expect(fake.calls.map((c) => c.op)).toEqual(['upsert'])
    expect(fake.calls[0].payload).toEqual({ artist_id: 'a1', slot: 'primary', name: 'Primary', hex: '#aabbcc' })
    expect(fake.calls[0].selected).toBe(true)
  })

  it('CRITICAL: the upsert conflicts on (artist_id, slot) — the unique constraint the database keeps — and reads the slot back', async () => {
    // The shared fake ignores upsert options, so a minimal client records them here. Without
    // the conflict target PostgREST inserts, and the second pick is a unique violation.
    const seen: { payload?: unknown; opts?: unknown; cols?: string } = {}
    const client = {
      from: () => ({
        upsert: (payload: unknown, opts: unknown) => {
          Object.assign(seen, { payload, opts })
          return {
            select: (cols: string) => {
              seen.cols = cols
              return Promise.resolve({ data: [row('s1', 'Primary', 'primary', 0)], error: null })
            },
          }
        },
      }),
    }
    const res = await setSlotColor(client as never, 'a1', 'primary', '#000000')
    expect(res.color?.slot).toBe('primary')
    expect(seen.opts).toEqual({ onConflict: 'artist_id,slot' })
    expect(seen.cols?.split(',').map((c) => c.trim())).toEqual(expect.arrayContaining(['id', 'name', 'hex', 'slot']))
  })

  it('an unrecognised refusal says a sentence of its own, not the raw message', async () => {
    const fake = fakeClient(() => ({ error: { code: 'XX000', message: 'internal thing' } }))
    expect(await setSlotColor(fake.client, 'a1', 'primary', '#000000')).toEqual({ ok: false, error: 'Could not save that color.' })
  })

  it('every slot writes its OWN fixed name', async () => {
    for (const slot of COLOR_SLOTS) {
      const fake = fakeClient(() => ({ data: [row('s', COLOR_SLOT_NAMES[slot], slot, 0)] }))
      await setSlotColor(fake.client, 'a1', slot, '#000000')
      expect((fake.calls[0].payload as { name: string }).name).toBe(COLOR_SLOT_NAMES[slot])
    }
    expect(COLOR_SLOT_NAMES).toEqual({ primary: 'Primary', secondary: 'Secondary' })
  })

  it('an unknown slot writes nothing', async () => {
    const fake = fakeClient()
    expect(await setSlotColor(fake.client, 'a1', 'tertiary' as never, '#000000')).toEqual({ ok: false, error: 'Unknown color.' })
    expect(fake.calls).toEqual([])
  })

  it('a refusal is a sentence; nothing back is an error, never a quiet success', async () => {
    let fake = fakeClient(() => ({ error: { code: '42501', message: 'new row violates row-level security policy' } }))
    expect(await setSlotColor(fake.client, 'a1', 'primary', '#000000')).toEqual({ ok: false, error: 'You can’t change this artist’s brand.' })
    fake = fakeClient(() => ({ data: [] }))
    expect((await setSlotColor(fake.client, 'a1', 'primary', '#000000')).ok).toBe(false)
  })
})

describe('the numbers the page is built on', () => {
  it('the built-ins keep their room under the cap, and the first added colour is "Color 3"', () => {
    expect(MAX_ADDED_COLORS).toBe(MAX_BRAND_COLORS - COLOR_SLOTS.length)
    expect(FIRST_ADDED_COLOR).toBe(COLOR_SLOTS.length + 1)
    expect(nextColorName([], FIRST_ADDED_COLOR)).toBe('Color 3')
    expect(nextColorName(['Color 3', 'color 4'], FIRST_ADDED_COLOR)).toBe('Color 5')
    // Counting from 1 is still the default (the lib's other callers).
    expect(nextColorName([])).toBe('Color 1')
  })
})
