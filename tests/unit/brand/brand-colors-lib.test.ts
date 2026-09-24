// The palette's reads and writes say exactly what they mean to the database.
/**
 * lib/brand-colors.ts over the PostgREST-shaped fake (no database). The action suite
 * (brand-actions.test.ts) pins ownership and the zero-row rule through the actions; this
 * file pins the lib's own promises, each of which a 2026-09-23 mutation run showed nothing
 * was watching:
 *   - the palette's ORDER (sort_order, then created_at, then Primary/Secondary first) and
 *     the defaults a sparse row reads as;
 *   - a new colour goes to the END (after the highest sort_order), and the first one is 0;
 *   - an add that the database refused, or that came back empty, is an error;
 *   - each write sends only its own column, and an unknown refusal gets that write's own
 *     fallback sentence.
 * The CHECKs, the cap and RLS themselves are the live suite's (tests/integration/brand).
 */
import { describe, expect, it } from 'vitest'
import {
  addBrandColor,
  deleteBrandColor,
  listBrandColors,
  nextColorName,
  renameBrandColor,
  setBrandColorHex,
  setBrandColorNote,
  setSlotColor,
} from '@/lib/brand-colors'
import { fakeClient, filterValue, type Call, type Reply } from '@tests/unit/brand/_fake-client'

const A = 'a1'
/** An error no REFUSALS pattern matches, so the caller's fallback sentence is what shows. */
const UNKNOWN = { code: '99999', message: 'something unexpected' }

describe('listBrandColors', () => {
  it('reads THIS artist, in sort_order then created_at order, and puts Primary and Secondary first', async () => {
    const fake = fakeClient(() => ({
      data: [
        { id: 'c1', name: 'Ink', hex: '#111111', note: 'body', sort_order: 3, slot: null },
        { id: 'c2', name: 'Secondary', hex: '#222222', sort_order: 0, slot: 'secondary' },
        { id: 'c3', name: 'Primary', hex: '#333333', sort_order: 9, slot: 'primary' },
      ],
    }))
    const colors = await listBrandColors(fake.client, A)
    expect(colors.map((c) => c.id)).toEqual(['c3', 'c2', 'c1'])
    const [read] = fake.calls
    expect(read.table).toBe('brand_colors')
    expect(read.filters).toEqual([
      ['eq', 'artist_id', A],
      ['order', 'sort_order', { ascending: true }],
      ['order', 'created_at', { ascending: true }],
    ])
  })

  it('a sparse row reads as no note, order 0, no slot — never undefined, never a bogus slot', async () => {
    const fake = fakeClient(() => ({ data: [{ id: 'c1', name: 'Ink', hex: '#111111', slot: 'tertiary' }] }))
    expect(await listBrandColors(fake.client, A)).toEqual([{ id: 'c1', name: 'Ink', hex: '#111111', note: null, sortOrder: 0, slot: null }])
  })

  it('a failed read throws (an empty palette would be a lie)', async () => {
    const fake = fakeClient(() => ({ error: { message: 'boom' } }))
    await expect(listBrandColors(fake.client, A)).rejects.toThrow('boom')
  })
})

describe('addBrandColor', () => {
  const world = (last: unknown[], insert: Reply) =>
    fakeClient((c: Call) => (c.op === 'select' ? { data: last } : c.op === 'insert' ? insert : { data: [] }))

  it('the first colour of an empty palette is sort_order 0; the next goes after the HIGHEST', async () => {
    const saved = { data: { id: 'n1', name: 'Ink', hex: '#aabbcc', note: null, sort_order: 0 } }
    let fake = world([], saved)
    await addBrandColor(fake.client, A, { name: 'Ink', hex: 'ABC' })
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ sort_order: 0 })

    fake = world([{ sort_order: 6 }], saved)
    await addBrandColor(fake.client, A, { name: 'Ink', hex: 'ABC' })
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ sort_order: 7 })
    // "The highest" is a descending read of this artist's sort_order, one row.
    const read = fake.calls.find((c) => c.op === 'select')!
    expect([read.table, read.cols]).toEqual(['brand_colors', 'sort_order'])
    expect(read.filters).toEqual([
      ['eq', 'artist_id', A],
      ['order', 'sort_order', { ascending: false }],
      ['limit', 1, undefined],
    ])
  })

  it('a failed "last" read still adds — at the start, never a crash', async () => {
    const fake = fakeClient((c: Call) => (c.op === 'select' ? { data: null, error: { message: 'x' } } : { data: { id: 'n1', name: 'Ink', hex: '#000000', sort_order: 0 } }))
    expect((await addBrandColor(fake.client, A, { name: 'Ink', hex: '#000000' })).ok).toBe(true)
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ sort_order: 0 })
  })

  it('returns the saved colour, as the database has it', async () => {
    const fake = world([], { data: { id: 'n1', name: 'Ink', hex: '#aabbcc', note: 'x', sort_order: 0 } })
    const res = await addBrandColor(fake.client, A, { name: ' Ink ', hex: 'ABC', note: 'x' })
    expect(res).toEqual({ ok: true, color: { id: 'n1', name: 'Ink', hex: '#aabbcc', note: 'x', sortOrder: 0, slot: null } })
    const ins = fake.calls.find((c) => c.op === 'insert')!
    expect(ins.table).toBe('brand_colors')
    expect(ins.payload).toEqual({ artist_id: A, name: 'Ink', hex: '#aabbcc', note: 'x', sort_order: 0 })
  })

  it('a refusal is its sentence, an unknown one the add\'s own; no row back is an error too', async () => {
    expect(await addBrandColor(world([], { error: UNKNOWN }).client, A, { name: 'Ink', hex: '#000000' })).toEqual({
      ok: false,
      error: 'Could not add that color.',
    })
    expect(await addBrandColor(world([], { data: null }).client, A, { name: 'Ink', hex: '#000000' })).toEqual({
      ok: false,
      error: 'Could not add that color.',
    })
  })
})

describe('the one-column writes', () => {
  const cases = [
    ['rename', (c: ReturnType<typeof fakeClient>['client']) => renameBrandColor(c, A, 'c1', '  Night\nink '), { name: 'Night ink' }, 'Could not rename that color.'],
    ['hex', (c: ReturnType<typeof fakeClient>['client']) => setBrandColorHex(c, A, 'c1', 'ABC'), { hex: '#aabbcc' }, 'Could not change that color.'],
    ['note', (c: ReturnType<typeof fakeClient>['client']) => setBrandColorNote(c, A, 'c1', '  '), { note: null }, 'Could not save that note.'],
  ] as const

  for (const [what, run, patch, fallback] of cases) {
    it(`${what}: sends only its column, and succeeds when the row came back`, async () => {
      const fake = fakeClient(() => ({ data: [{ id: 'c1' }] }))
      expect(await run(fake.client)).toEqual({ ok: true })
      const [up] = fake.calls
      expect([up.table, up.op, up.cols]).toEqual(['brand_colors', 'update', 'id'])
      expect(up.payload).toEqual(patch)
      expect([filterValue(up, 'id'), filterValue(up, 'artist_id')]).toEqual(['c1', A])
    })

    it(`${what}: an unknown refusal is "${fallback}"; no row back is "no longer there"`, async () => {
      expect(await run(fakeClient(() => ({ error: UNKNOWN })).client)).toEqual({ ok: false, error: fallback })
      expect(await run(fakeClient(() => ({ data: [] })).client)).toEqual({ ok: false, error: 'That color is no longer there.' })
    })
  }

  it('delete: succeeds on a returned row; a refusal and a missing row are errors, each in its own words', async () => {
    const ok = fakeClient(() => ({ data: [{ id: 'c1' }] }))
    expect(await deleteBrandColor(ok.client, A, 'c1')).toEqual({ ok: true })
    expect([ok.calls[0].op, ok.calls[0].cols]).toEqual(['delete', 'id'])
    expect(await deleteBrandColor(fakeClient(() => ({ error: UNKNOWN })).client, A, 'c1')).toEqual({
      ok: false,
      error: 'Could not remove that color.',
    })
    expect(await deleteBrandColor(fakeClient(() => ({ data: [] })).client, A, 'c1')).toEqual({
      ok: false,
      error: 'That color is no longer there.',
    })
  })
})

describe('setSlotColor (Primary / Secondary)', () => {
  it('one upsert with the slot\'s fixed name; an unknown slot, a refusal and an empty answer are errors', async () => {
    const ok = fakeClient(() => ({ data: [{ id: 's1', name: 'Primary', hex: '#aabbcc', note: null, sort_order: 0, slot: 'primary' }] }))
    const res = await setSlotColor(ok.client, A, 'primary', 'ABC')
    expect(res).toEqual({ ok: true, color: { id: 's1', name: 'Primary', hex: '#aabbcc', note: null, sortOrder: 0, slot: 'primary' } })
    expect(ok.calls[0].payload).toEqual({ artist_id: A, slot: 'primary', name: 'Primary', hex: '#aabbcc' })

    const none = fakeClient()
    expect(await setSlotColor(none.client, A, 'tertiary' as never, '#000000')).toEqual({ ok: false, error: 'Unknown color.' })
    expect(none.calls).toEqual([])
    expect(await setSlotColor(fakeClient(() => ({ error: UNKNOWN })).client, A, 'secondary', '#000000')).toEqual({
      ok: false,
      error: 'Could not save that color.',
    })
    expect(await setSlotColor(fakeClient(() => ({ data: [] })).client, A, 'secondary', '#000000')).toEqual({
      ok: false,
      error: 'Could not save that color.',
    })
  })
})

describe('nextColorName', () => {
  it('a name with stray spaces still counts as taken', () => {
    expect(nextColorName(['  Color 1 '])).toBe('Color 2')
    expect(nextColorName(['Color 3'], 3)).toBe('Color 4')
  })
})
