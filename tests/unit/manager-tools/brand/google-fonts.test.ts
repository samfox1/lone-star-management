// Google Fonts on the Brand page: the bundled catalogue, the search, and adding one to a slot.
/**
 * BRAND_SYNC_PLAN.md (Sam, 2026-09-24): "Brand gets Google Fonts (pick any Google family by
 * name) alongside uploads." What has to hold, DB-free:
 *
 *   the list     every bundled family is a name the database accepts (the CHECK in
 *                20260925120000 is the same shape) — a family the picker offers and the
 *                database refuses is a picker that errors on click. Read off the REAL
 *                bundled file, never a hand-typed sample (AGENTS.md rule 4).
 *   the search   exact → starts with → a word starts with → contains, popularity within.
 *   the preview  the css2 URL leaves out any name that is not Google-shaped.
 *   the write    `addGoogleFont` stores ONLY a catalogue family, in Google's spelling, as a
 *                file-less row (source 'google'); an existing row is reused, never doubled;
 *                the per-artist cap holds. The action checks ownership first, places the
 *                font in its slot, and reports a failed placement as a warning.
 *
 * The live halves (the CHECKs, the partial unique index, the door) are in
 * tests/integration/manager-tools/brand/brand-sync.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATEGORY_LABEL,
  findGoogleFamily,
  googlePreviewHref,
  isGoogleFamilyName,
  loadGoogleFonts,
  searchGoogleFonts,
  type GoogleFontRow,
} from '@/lib/google-fonts'
import { MAX_FONTS_PER_ARTIST, addGoogleFont } from '@/lib/fonts'
import { fakeClient, isOwnershipRead, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let fake = fakeClient()
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => fake.client) }))

const A = 'a1'

describe('the bundled catalogue', () => {
  it('CRITICAL: every family is a name the database accepts, with a known category', async () => {
    const rows = await loadGoogleFonts()
    expect(rows.length).toBeGreaterThan(1000) // non-vacuous: the whole catalogue, not a sample
    const refused = rows.filter(([family]) => !isGoogleFamilyName(family)).map(([f]) => f)
    expect(refused).toEqual([])
    const unknown = rows.filter(([, cat]) => !(cat in CATEGORY_LABEL))
    expect(unknown).toEqual([])
  })

  it('holds the families Skeen is seeded with, and no family twice', async () => {
    const rows = await loadGoogleFonts()
    for (const name of ['Archivo', 'Inter']) expect(findGoogleFamily(rows, name), name).toBe(name)
    expect(new Set(rows.map(([f]) => f)).size).toBe(rows.length)
  })
})

describe('isGoogleFamilyName — the shape the CHECK and the bridge both hold', () => {
  it('words of letters and digits, one space between', () => {
    for (const ok of ['Archivo', 'Big Shoulders Display', 'M PLUS 1p', 'Noto Sans JP']) expect(isGoogleFamilyName(ok), ok).toBe(true)
  })

  it('CRITICAL: anything that could close a CSS string or a URL parameter is refused', () => {
    for (const bad of ["Evil'); }", 'Inter&family=x', 'Inter:wght@900', ' Inter', 'Inter ', 'Big  Shoulders', '', 'x'.repeat(65), null, 7])
      expect(isGoogleFamilyName(bad), String(bad)).toBe(false)
  })
})

const ROWS: GoogleFontRow[] = [
  ['Roboto', 's'],
  ['Transansa', 'd'], // "sans" mid-word, and MORE popular than every word-start match below
  ['Open Sans', 's'],
  ['Inter', 's'],
  ['Noto Sans', 's'],
  ['Inter Tight', 's'],
  ['Sansita', 'd'],
  ['Josefin Sans', 's'],
  ['Kanit', 's'],
]

describe('findGoogleFamily', () => {
  it('matches without regard to case or spacing, and answers in Google\'s spelling', () => {
    expect(findGoogleFamily(ROWS, '  open   SANS ')).toBe('Open Sans')
    expect(findGoogleFamily(ROWS, 'Opensans')).toBeNull()
    expect(findGoogleFamily(ROWS, '')).toBeNull()
    expect(findGoogleFamily(ROWS, undefined)).toBeNull()
  })
})

describe('searchGoogleFonts', () => {
  it('exact, then starts-with, then a word starting with it, then anywhere — popularity within each', () => {
    expect(searchGoogleFonts(ROWS, 'inter').map(([f]) => f)).toEqual(['Inter', 'Inter Tight'])
    // "sans": Sansita starts with it; Open/Noto/Josefin Sans have a WORD starting with it.
    // Transansa only CONTAINS it, so it comes last despite being the most popular of them.
    expect(searchGoogleFonts(ROWS, 'sans').map(([f]) => f)).toEqual(['Sansita', 'Open Sans', 'Noto Sans', 'Josefin Sans', 'Transansa'])
    // "an": nothing starts with it or has a word starting with it; contains only.
    expect(searchGoogleFonts(ROWS, 'an').map(([f]) => f)).toEqual(['Transansa', 'Open Sans', 'Noto Sans', 'Sansita', 'Josefin Sans', 'Kanit'])
  })

  it('an empty search is the most popular families, capped', () => {
    expect(searchGoogleFonts(ROWS, '   ', 3).map(([f]) => f)).toEqual(['Roboto', 'Transansa', 'Open Sans'])
  })
})

describe('googlePreviewHref', () => {
  it('one css2 request for the rows on screen, regular weight, swap', () => {
    expect(googlePreviewHref(['Inter', 'Big Shoulders Display', 'Inter'])).toBe(
      'https://fonts.googleapis.com/css2?family=Inter&family=Big+Shoulders+Display&display=swap',
    )
  })

  it('CRITICAL: a name that is not Google-shaped never reaches the URL', () => {
    expect(googlePreviewHref(['Inter&family=Evil', "x'); }"])).toBeNull()
    expect(googlePreviewHref(['Inter', 'Inter:wght@900'])).toBe('https://fonts.googleapis.com/css2?family=Inter&display=swap')
  })
})

/** A world where the artist has these fonts (the view read) and every write lands. */
function world(existing: Record<string, unknown>[] = [], over: (c: Call) => Reply | undefined = () => undefined) {
  return fakeClient((c) => {
    if (isOwnershipRead(c)) return { data: { id: A } }
    const o = over(c)
    if (o) return o
    if (c.table === 'artist_fonts_with_slots') return { data: existing }
    if (c.op === 'insert' && c.table === 'artist_fonts') {
      const p = c.payload as Record<string, unknown>
      return { data: { id: 'g1', label: p.label, family: p.family } }
    }
    if (c.op === 'upsert') return { data: [{ slot: 'primary' }] }
    return { data: [] }
  })
}

const upload = (id: string, family: string) => ({ id, label: family, family, storage_path: `${A}/fonts/${id}.woff2`, format: 'woff2', slots: [], source: 'upload', google_family: null })
const googleRow = (id: string, name: string, family: string) => ({ id, label: name, family, storage_path: null, format: null, slots: [], source: 'google', google_family: name })

describe('addGoogleFont', () => {
  it('CRITICAL: a family not in the catalogue is refused, and nothing is written', async () => {
    const f = world()
    const res = await addGoogleFont(f.client, A, 'Comic Sans MS')
    expect(res).toEqual({ ok: false, error: 'That isn’t a Google font.' })
    expect(f.writes()).toEqual([])
  })

  it('CRITICAL: stores Google\'s spelling as a file-less google row, token derived and unique', async () => {
    // 'archivo-black' is TAKEN by an upload, so the new token is bumped past it.
    const f = world([upload('u1', 'archivo-black')])
    const res = await addGoogleFont(f.client, A, '  archivo   black ')
    expect(res.ok).toBe(true)
    const ins = f.calls.find((c) => c.op === 'insert' && c.table === 'artist_fonts')!
    expect(ins.payload).toEqual({
      artist_id: A,
      label: 'Archivo Black',
      family: 'archivo-black-2',
      source: 'google',
      google_family: 'Archivo Black',
    })
    expect(res.font).toMatchObject({ id: 'g1', source: 'google', google_family: 'Archivo Black', storage_path: null, format: null, slots: [] })
  })

  it('CRITICAL: the same family again REUSES the row — no second insert', async () => {
    const f = world([googleRow('g0', 'Archivo', 'archivo')])
    const res = await addGoogleFont(f.client, A, 'archivo')
    expect(res).toMatchObject({ ok: true, reused: true, font: { id: 'g0' } })
    expect(f.writes()).toEqual([])
  })

  it('an upload that happens to be LABELLED like the family is not reused (only a google row is)', async () => {
    const f = world([{ ...upload('u1', 'inter'), label: 'Inter' }])
    const res = await addGoogleFont(f.client, A, 'Inter')
    expect(res.reused).toBeUndefined()
    expect(f.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ family: 'inter-2', google_family: 'Inter' })
  })

  it('the per-artist cap counts Google fonts like uploads', async () => {
    const full = Array.from({ length: MAX_FONTS_PER_ARTIST }, (_, i) => upload(`u${i}`, `f-${i}`))
    const f = world(full)
    const res = await addGoogleFont(f.client, A, 'Inter')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/up to 12 fonts/)
    expect(f.writes()).toEqual([])
  })

  it('a refused insert is a sentence, and no font comes back', async () => {
    const f = world([], (c) => (c.op === 'insert' ? { error: { code: '42501', message: 'new row violates row-level security policy' } } : undefined))
    expect(await addGoogleFont(f.client, A, 'Inter')).toEqual({ ok: false, error: 'You can’t change this artist’s brand.' })
  })
})

describe('addGoogleFontAction', () => {
  const load = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions')

  beforeEach(() => {
    fake = world()
  })

  it('CRITICAL: places the NEW font in the slot, with an added row\'s title and note', async () => {
    const res = await (await load()).addGoogleFontAction(A, 'Inter', 'custom_2', { label: 'Captions', note: 'small print' })
    expect(res).toEqual({})
    const up = fake.calls.find((c) => c.op === 'upsert' && c.table === 'artist_font_slots')!
    expect(up.payload).toEqual({ artist_id: A, slot: 'custom_2', font_id: 'g1', label: 'Captions', note: 'small print' })
    // The insert came first: the slot names the row it made.
    const order = fake.calls.filter((c) => c.op !== 'select').map((c) => `${c.op}:${c.table}`)
    expect(order).toEqual(['insert:artist_fonts', 'upsert:artist_font_slots'])
  })

  it('CRITICAL: a failed placement is a WARNING — the font was added and stays in the menu', async () => {
    fake = world([], (c) => (c.op === 'upsert' ? { error: { message: 'boom' } } : undefined))
    const res = await (await load()).addGoogleFontAction(A, 'Inter', 'primary')
    expect(res.error).toBeUndefined()
    expect(res.warning).toBeTruthy()
  })

  it('a refused family is an error, and no slot is touched', async () => {
    const res = await (await load()).addGoogleFontAction(A, 'Not A Real Family', 'primary')
    expect(res.error).toBe('That isn’t a Google font.')
    expect(fake.writes()).toEqual([])
  })
})
