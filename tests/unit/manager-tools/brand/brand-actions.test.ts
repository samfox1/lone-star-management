// Every Brand action refuses a stranger, reports a write that matched nothing, and says no in
//   plain words.
/**
 * The Brand page's server actions, over a fake PostgREST client (no database).
 *
 * THREE PROMISES, each pinned for EVERY action rather than a hand-picked few:
 *
 *   1. OWNERSHIP FIRST. `callerOwns` runs before any write. RLS would block a stranger's
 *      write anyway — but a row-filtered UPDATE or DELETE returns `error: null`, so without
 *      the check a stranger gets `{}` and the UI shows a success. The table below is typed
 *      against the module's own exports, so a new action that is not listed here is a
 *      COMPILE error, not a silently unguarded door.
 *   2. ZERO ROWS IS AN ERROR (AGENTS.md rule 3). The fake returns rows only when `.select`
 *      was chained onto the write, exactly like PostgREST, so an action that drops
 *      `.select` — or ignores what came back — goes red here.
 *   3. REFUSALS ARE SENTENCES, and a refused call never reaches the write.
 *
 * The live-database halves (the CHECKs, the cap trigger, RLS itself) are in
 * tests/integration/manager-tools/brand/brand-page.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, filterValue, isOwnershipRead, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let fake = fakeClient()
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => fake.client) }))

type Actions = typeof import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions')
const load = (): Promise<Actions> => import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions')

const A = 'a1'
const PATH = `${A}/brand/0a0a0a0a-0000-4000-8000-000000000000.png`
const FONT_PATH = `${A}/fonts/0a0a0a0a-0000-4000-8000-000000000000.woff2`

/**
 * One well-formed call per exported action. `satisfies Record<keyof Actions, …>` is the
 * registry: export a new action without adding it here and this file stops compiling.
 */
const CALLS = {
  setBrandAssetAction: (m) => m.setBrandAssetAction(A, 'logo_primary', PATH),
  saveFramingAction: (m) => m.saveFramingAction(A, { zoom: 2, offsetY: 0 }, 'home_icon'),
  addLogoAction: (m) => m.addLogoAction(A, { title: 'Tour', storagePath: PATH }),
  renameLogoAction: (m) => m.renameLogoAction(A, 'm1', 'Tour'),
  setLogoNoteAction: (m) => m.setLogoNoteAction(A, 'm1', 'for merch'),
  deleteLogoAction: (m) => m.deleteLogoAction(A, 'm1'),
  replaceLogoFileAction: (m) => m.replaceLogoFileAction(A, 'm1', PATH),
  cutOutLogoAction: (m) => m.cutOutLogoAction(A, 'm1', PATH),
  setIconSourceAction: (m) => m.setIconSourceAction(A, 'favicon', 'm1'),
  addIconSourceAction: (m) => m.addIconSourceAction(A, 'home_icon', PATH),
  setThemeColorAction: (m) => m.setThemeColorAction(A, '#112233'),
  addBrandColorAction: (m) => m.addBrandColorAction(A, { name: 'Color 1', hex: '#112233' }),
  renameBrandColorAction: (m) => m.renameBrandColorAction(A, 'c1', 'Ink'),
  setBrandColorHexAction: (m) => m.setBrandColorHexAction(A, 'c1', '#445566'),
  setBrandColorNoteAction: (m) => m.setBrandColorNoteAction(A, 'c1', 'buttons'),
  deleteBrandColorAction: (m) => m.deleteBrandColorAction(A, 'c1'),
  setBrandColorSlotAction: (m) => m.setBrandColorSlotAction(A, 'primary', '#112233'),
  addArtistFontAction: (m) => m.addArtistFontAction(A, { label: 'Mori', storagePath: FONT_PATH, format: 'woff2' }),
  addGoogleFontAction: (m) => m.addGoogleFontAction(A, 'Archivo', 'primary'),
  removeArtistFontAction: (m) => m.removeArtistFontAction(A, 'f1'),
  renameArtistFontAction: (m) => m.renameArtistFontAction(A, 'f1', 'Sorg'),
  setFontSlotAction: (m) => m.setFontSlotAction(A, 'custom_1', 'f1', { label: 'Mono' }),
  setFontSlotMetaAction: (m) => m.setFontSlotMetaAction(A, 'custom_1', { note: 'credits' }),
  clearCustomFontSlotAction: (m) => m.clearCustomFontSlotAction(A, 'custom_1'),
  revertBrandAction: (m) => m.revertBrandAction(A),
} satisfies Record<keyof Actions, (m: Actions) => Promise<{ error?: string }>>

/** A database where every read finds the row it asks for and every write matches one. */
function happy(overrides: (c: Call) => Reply | undefined = () => undefined, owner = true) {
  return (c: Call): Reply => {
    if (isOwnershipRead(c)) return { data: owner ? { id: A } : null }
    const o = overrides(c)
    if (o) return o
    if (c.table === 'media' && c.op === 'select' && c.terminal === 'maybeSingle')
      return { data: { id: 'm1', purpose: 'logo', storage_path: `${A}/brand/old.png`, source_path: null } }
    if (c.op === 'rpc') return { data: [] }
    if (c.op === 'select') return { data: [], count: 0 }
    if (c.op === 'insert' && c.table === 'artist_fonts')
      return { data: { id: 'f1', label: 'Mori', family: 'mori', storage_path: FONT_PATH, format: 'woff2' } }
    if (c.op === 'insert') return { data: { id: 'new1', name: 'Color 1', hex: '#112233', sort_order: 0, purpose: 'logo', storage_path: PATH } }
    return { data: [{ id: 'x', slot: 'custom_1', storage_path: PATH, source_path: null }] }
  }
}

beforeEach(() => {
  fake = fakeClient(happy())
})

describe('1. every action refuses a caller who does not manage the artist', () => {
  for (const [name, call] of Object.entries(CALLS)) {
    it(`CRITICAL: ${name} — 'Not found.' and no write reached`, async () => {
      fake = fakeClient(happy(undefined, false))
      const res = await call(await load())
      expect(res.error).toBe('Not found.')
      expect(fake.writes()).toEqual([])
      expect(fake.removed).toEqual([])
    })
  }

  it('the same calls DO write for the owner (the witness that the table can fail)', async () => {
    const m = await load()
    for (const [name, call] of Object.entries(CALLS)) {
      fake = fakeClient(happy())
      await call(m)
      // Revert reads the log first and, with nothing published, writes nothing — its
      // own write paths are pinned in brand-revert.test.ts.
      if (name === 'revertBrandAction') continue
      expect(fake.writes().length, `${name} should have written`).toBeGreaterThan(0)
    }
  })
})

describe('2. a write that matched no row is an error, not a success', () => {
  /** Every update/delete now matches nothing — what RLS or a stale id looks like. */
  const noRows = (c: Call): Reply | undefined =>
    c.op === 'update' || c.op === 'delete' || c.op === 'upsert' ? { data: [] } : undefined

  const ZERO_ROW = [
    'renameLogoAction',
    'setLogoNoteAction',
    'deleteLogoAction',
    'replaceLogoFileAction',
    'cutOutLogoAction',
    'setIconSourceAction',
    'setThemeColorAction',
    'renameBrandColorAction',
    'setBrandColorHexAction',
    'setBrandColorNoteAction',
    'deleteBrandColorAction',
    'setFontSlotMetaAction',
    'clearCustomFontSlotAction',
    'setFontSlotAction',
    'renameArtistFontAction',
    'setBrandColorSlotAction',
  ] as const satisfies readonly (keyof Actions)[]

  for (const name of ZERO_ROW) {
    it(`CRITICAL: ${name}`, async () => {
      fake = fakeClient(happy(noRows))
      const res = await CALLS[name](await load())
      expect(res.error, `${name} reported success for a write that matched nothing`).toBeTruthy()
    })

    it(`${name} succeeds when the row was there`, async () => {
      const res = await CALLS[name](await load())
      expect(res.error).toBeUndefined()
    })
  }

  it('CRITICAL: an added logo that could not be made an icon source is removed again', async () => {
    // addIconSource is performUpload's writeRow: an error must mean nothing was left
    // behind, or the caller deletes the file from under a row that still names it.
    fake = fakeClient(
      happy((c) => {
        if (c.table === 'media' && c.op === 'select' && c.terminal === 'maybeSingle')
          return { data: { id: 'new1', purpose: 'icon_source' } }
        if (c.table === 'artists' && c.op === 'update') return { data: [] }
      }),
    )
    const res = await (await load()).addIconSourceAction(A, 'favicon', PATH)
    expect(res.error).toBeTruthy()
    const undo = fake.calls.find((c) => c.table === 'media' && c.op === 'delete')
    expect(undo && [filterValue(undo, 'id'), filterValue(undo, 'artist_id')]).toEqual(['new1', A])
  })
})

describe('3. refusals are sentences, and never reach the write', () => {
  it('CRITICAL: an icon cannot be framed from a derived PNG', async () => {
    fake = fakeClient(
      happy((c) =>
        c.table === 'media' && c.terminal === 'maybeSingle' ? { data: { id: 'm1', purpose: 'favicon' } } : undefined,
      ),
    )
    const res = await (await load()).setIconSourceAction(A, 'home_icon', 'm1')
    expect(res.error).toBe('Pick one of this artist’s logos.')
    expect(fake.writes()).toEqual([])
  })

  it('CRITICAL: an icon cannot be framed from media this artist does not have', async () => {
    fake = fakeClient(happy((c) => (c.table === 'media' && c.terminal === 'maybeSingle' ? { data: null } : undefined)))
    const res = await (await load()).setIconSourceAction(A, 'favicon', 'someone-elses')
    expect(res.error).toBe('Pick one of this artist’s logos.')
    expect(fake.writes()).toEqual([])
  })

  it('null (the primary logo) is a real choice, and writes null', async () => {
    const res = await (await load()).setIconSourceAction(A, 'favicon', null)
    expect(res.error).toBeUndefined()
    const w = fake.calls.find((c) => c.table === 'artists' && c.op === 'update')
    expect(w?.payload).toEqual({ favicon_source_media_id: null })
  })

  it('an unknown icon target is refused before the ownership read even matters', async () => {
    const m = await load()
    for (const res of [
      await m.setIconSourceAction(A, 'apple' as never, null),
      await m.saveFramingAction(A, { zoom: 1, offsetY: 0 }, 'apple' as never),
      await m.addIconSourceAction(A, 'apple' as never, PATH),
    ])
      expect(res.error).toBe('Unknown icon.')
    expect(fake.writes()).toEqual([])
    // "Before the ownership read": not one query ran. Without this the action's own guard
    // could be deleted and the lib's copy below would still say 'Unknown icon.' (a
    // mutation check, 2026-09-23, left it green).
    expect(fake.calls).toEqual([])
  })

  it('the lib refuses an unknown icon target on its own, too (the action is not the only caller)', async () => {
    const { saveFraming, setIconSource, addIconSource } = await import('@/lib/brand')
    for (const res of [
      await saveFraming(fake.client, A, { zoom: 2, offsetY: 0 }, 'apple' as never),
      await setIconSource(fake.client, A, 'apple' as never, null),
      await addIconSource(fake.client, A, 'apple' as never, PATH),
    ])
      expect(res).toEqual({ ok: false, error: 'Unknown icon.' })
    expect(fake.calls).toEqual([])
  })

  it('CRITICAL: a file path outside this artist’s folder is refused', async () => {
    const m = await load()
    const foreign = 'b2/brand/0a0a0a0a-0000-4000-8000-000000000000.png'
    expect((await m.addLogoAction(A, { title: 'Tour', storagePath: foreign })).error).toBe('That file location is not valid.')
    expect((await m.cutOutLogoAction(A, 'm1', foreign)).error).toBe('That file location is not valid.')
    expect((await m.addIconSourceAction(A, 'favicon', foreign)).error).toBe('That file location is not valid.')
    expect(fake.writes()).toEqual([])
  })

  it('the database’s refusals come back as sentences, keyed on the constraint', async () => {
    const refuse = (message: string) => (c: Call) =>
      c.op === 'insert' || c.op === 'update' ? { error: { code: '23514', message } } : undefined
    const cases: [string, (m: Actions) => Promise<{ error?: string }>, string][] = [
      ['new row for relation "media" violates check constraint "media_logo_title"', CALLS.addLogoAction, 'Give the logo a name, up to 40 characters.'],
      ['brand color cap reached: at most 24 colors per artist', CALLS.addBrandColorAction, 'You can keep up to 24 colors. Remove one first.'],
      ['new row for relation "brand_colors" violates check constraint "brand_colors_hex"', CALLS.setBrandColorHexAction, 'Use a color code like #1a2b3c.'],
      ['new row for relation "brand_colors" violates check constraint "brand_colors_name"', CALLS.renameBrandColorAction, 'Give the color a name, up to 40 characters.'],
      ['new row for relation "artists" violates check constraint "artists_theme_color_hex"', CALLS.setThemeColorAction, 'Use a color code like #1a2b3c.'],
      ['new row for relation "brand_colors" violates check constraint "brand_colors_note"', CALLS.setBrandColorNoteAction, 'Keep the note to one line, up to 500 characters.'],
      ['new row for relation "media" violates check constraint "media_note_clean"', CALLS.setLogoNoteAction, 'Keep the note to one line, up to 500 characters.'],
      ['new row for relation "artist_font_slots" violates check constraint "artist_font_slots_label_custom"', (m) => m.setFontSlotMetaAction(A, 'custom_1', { label: 'x' }), 'Give the font a name, up to 40 characters.'],
    ]
    for (const [message, call, sentence] of cases) {
      fake = fakeClient(happy(refuse(message)))
      expect((await call(await load())).error, message).toBe(sentence)
    }
  })

  it('CRITICAL: built-in font rows take no title or note, and cannot be removed', async () => {
    const m = await load()
    expect((await m.setFontSlotMetaAction(A, 'primary', { label: 'Heads' })).error).toBe('Only an added font has a name and a note.')
    expect((await m.setFontSlotAction(A, 'secondary', 'f1', { note: 'body' })).error).toBe('Only an added font has a name and a note.')
    expect((await m.clearCustomFontSlotAction(A, 'primary')).error).toBe('Primary and Secondary can’t be removed.')
    expect(fake.writes()).toEqual([])
  })

  it('CRITICAL: a font cannot be renamed to nothing', async () => {
    const m = await load()
    for (const label of ['', '   ', '\n'])
      expect((await m.renameArtistFontAction(A, 'f1', label)).error, JSON.stringify(label)).toBe('Give the font a name first.')
    expect(fake.writes()).toEqual([])
  })

  it('CRITICAL: only Primary and Secondary are colour slots', async () => {
    const m = await load()
    for (const slot of ['tertiary', 'custom_1', '', 'Primary'])
      expect((await m.setBrandColorSlotAction(A, slot as never, '#112233')).error, slot).toBe('Unknown color.')
    expect(fake.writes()).toEqual([])
  })

  it('CRITICAL: a font weight outside 100–900 is refused before the insert', async () => {
    const m = await load()
    for (const weight of [50, 950, 450.5]) {
      const res = await m.addArtistFontAction(A, { label: 'Mori', storagePath: FONT_PATH, format: 'woff2', weight })
      expect(res.error).toBe('Font weight must be between 100 and 900.')
    }
    expect(fake.writes()).toEqual([])
  })
})

describe('what the writes actually say', () => {
  it('a weight is stored when known, and absent (not null) when not', async () => {
    const m = await load()
    await m.addArtistFontAction(A, { label: 'Mori', storagePath: FONT_PATH, format: 'woff2', weight: 700 })
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ weight: 700 })
    fake = fakeClient(happy())
    await m.addArtistFontAction(A, { label: 'Mori', storagePath: FONT_PATH, format: 'woff2' })
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).not.toHaveProperty('weight')
  })

  it('weights 100 and 900 are the edges of the range, not past them', async () => {
    const m = await load()
    for (const weight of [100, 900]) {
      fake = fakeClient(happy())
      const res = await m.addArtistFontAction(A, { label: 'Mori', storagePath: FONT_PATH, format: 'woff2', weight })
      expect(res.error, String(weight)).toBeUndefined()
      expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ weight })
    }
  })

  it('CRITICAL: renaming a font writes its LABEL only — never the family token — on THIS artist’s font', async () => {
    // The family is derived once and baked into every per-region style row (`font-<family>`);
    // a rename that touched it would retype the site from a page nobody edited.
    await (await load()).renameArtistFontAction(A, 'f1', '  Sorg \n Display ')
    const up = fake.calls.find((c) => c.op === 'update')!
    expect(up.table).toBe('artist_fonts')
    expect(up.payload).toEqual({ label: 'Sorg Display' })
    expect([filterValue(up, 'id'), filterValue(up, 'artist_id')]).toEqual(['f1', A])
  })

  it('a font name keeps to the 80 characters an upload allows', async () => {
    await (await load()).renameArtistFontAction(A, 'f1', 'x'.repeat(90))
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ label: 'x'.repeat(80) })
  })

  it('CRITICAL: a colour slot is ONE upsert of the slot, its fixed name and the hex — never a second row', async () => {
    const m = await load()
    await m.setBrandColorSlotAction(A, 'secondary', 'ABC')
    const writes = fake.writes().filter((c) => c.table === 'brand_colors')
    expect(writes.map((c) => c.op)).toEqual(['upsert'])
    expect(writes[0].payload).toEqual({ artist_id: A, slot: 'secondary', name: 'Secondary', hex: '#aabbcc' })
  })

  it('CRITICAL: filling a BUILT-IN slot writes exactly the slot and the font — no title, no note', async () => {
    const res = await (await load()).setFontSlotAction(A, 'primary', 'f1')
    expect(res.error).toBeUndefined()
    const up = fake.calls.find((c) => c.op === 'upsert')!
    expect(up.table).toBe('artist_font_slots')
    expect(up.payload).toEqual({ artist_id: A, slot: 'primary', font_id: 'f1' })
  })

  it('CRITICAL: changing only the note leaves the title alone (and the reverse)', async () => {
    const m = await load()
    await m.setFontSlotMetaAction(A, 'custom_1', { note: ' back cover ' })
    let up = fake.calls.find((c) => c.op === 'update')!
    expect(up.table).toBe('artist_font_slots')
    expect(up.payload).toEqual({ note: 'back cover' })
    expect([filterValue(up, 'artist_id'), filterValue(up, 'slot')]).toEqual([A, 'custom_1'])

    fake = fakeClient(happy())
    await m.setFontSlotMetaAction(A, 'custom_1', { label: '  ' })
    up = fake.calls.find((c) => c.op === 'update')!
    expect(up.payload).toEqual({ label: null }) // an emptied title clears, it is not saved as ''
  })

  it('a title and note on an added slot ride the upsert that fills it', async () => {
    await (await load()).setFontSlotAction(A, 'custom_2', 'f1', { label: 'Credits', note: '' })
    expect(fake.calls.find((c) => c.op === 'upsert')?.payload).toEqual({
      artist_id: A,
      slot: 'custom_2',
      font_id: 'f1',
      label: 'Credits',
      note: null,
    })
  })

  it('an empty meta on a BUILT-IN slot is no meta at all (not a refusal)', async () => {
    expect((await (await load()).setFontSlotAction(A, 'primary', 'f1', {})).error).toBeUndefined()
  })

  it('a vanished font row says so in its own words', async () => {
    fake = fakeClient(happy((c) => (c.op === 'update' || c.op === 'delete' ? { data: [] } : undefined)))
    const m = await load()
    expect((await m.setFontSlotMetaAction(A, 'custom_1', { note: 'x' })).error).toBe('That font row is no longer there.')
    expect((await m.clearCustomFontSlotAction(A, 'custom_1')).error).toBe('That font row is no longer there.')
  })

  it('an empty meta change writes nothing and is not an error', async () => {
    const res = await (await load()).setFontSlotMetaAction(A, 'custom_1', {})
    expect(res.error).toBeUndefined()
    expect(fake.writes()).toEqual([])
  })

  it('removing an added font row deletes the SLOT, scoped to this artist — never the font', async () => {
    await (await load()).clearCustomFontSlotAction(A, 'custom_3')
    const del = fake.calls.filter((c) => c.op === 'delete')
    expect(del.map((c) => c.table)).toEqual(['artist_font_slots'])
    expect([filterValue(del[0], 'artist_id'), filterValue(del[0], 'slot')]).toEqual([A, 'custom_3'])
  })

  it('an added logo is saved with its title and note in ONE insert, on the site', async () => {
    await (await load()).addLogoAction(A, { title: '  Tour\nlogo ', note: '', storagePath: PATH })
    const inserts = fake.calls.filter((c) => c.op === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toMatchObject({ purpose: 'logo', label: 'Tour logo', note: null, storage_path: PATH, on_site: true })
  })

  it('CRITICAL: a cut-out keeps the original; a second cut-out keeps the FIRST original', async () => {
    const m = await load()
    await m.cutOutLogoAction(A, 'm1', PATH)
    let w = fake.calls.find((c) => c.op === 'update')!
    expect(w.payload).toEqual({ storage_path: PATH, source_path: `${A}/brand/old.png` })
    // Conditional on the file it read, so two editors cannot both save over each other.
    expect(filterValue(w, 'storage_path')).toBe(`${A}/brand/old.png`)

    fake = fakeClient(
      happy((c) =>
        c.table === 'media' && c.terminal === 'maybeSingle'
          ? { data: { storage_path: `${A}/brand/cut1.png`, source_path: `${A}/brand/first.png` } }
          : undefined,
      ),
    )
    await m.cutOutLogoAction(A, 'm1', PATH)
    w = fake.calls.find((c) => c.op === 'update')!
    expect(w.payload).toEqual({ storage_path: PATH, source_path: `${A}/brand/first.png` })
  })

  it('a fresh upload is its own original (source_path clears)', async () => {
    await (await load()).replaceLogoFileAction(A, 'm1', PATH)
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ storage_path: PATH, source_path: null })
  })

  it('rename, note and delete are scoped to ADDED logos — a built-in cannot be deleted here', async () => {
    const m = await load()
    await m.deleteLogoAction(A, 'm1')
    const del = fake.calls.find((c) => c.table === 'media' && c.op === 'delete')!
    expect(filterValue(del, 'purpose')).toBe('logo')
    expect(filterValue(del, 'artist_id')).toBe(A)

    // Rename and note too: the action takes any media id, and a built-in's `label` IS in
    // the published snapshot. Only the delete was pinned until 2026-09-23; dropping the
    // purpose filter from the shared update stayed green.
    for (const call of [CALLS.renameLogoAction, CALLS.setLogoNoteAction]) {
      fake = fakeClient(happy())
      await call(m)
      const up = fake.calls.find((c) => c.table === 'media' && c.op === 'update')!
      expect(filterValue(up, 'purpose')).toBe('logo')
      expect(filterValue(up, 'artist_id')).toBe(A)
    }
  })

  it('CRITICAL: a new file (upload or cut-out) can only go on a LOGO row of this artist', async () => {
    // setLogoFile reads the row it will repoint; the read is what scopes it. Without the
    // purpose filter, replaceLogoFileAction(galleryPhotoId, …) would repoint a gallery
    // photo — and a cut-out would give it a source_path.
    const { LOGO_PURPOSES } = await import('@/lib/brand')
    const m = await load()
    for (const call of [CALLS.replaceLogoFileAction, CALLS.cutOutLogoAction]) {
      fake = fakeClient(happy())
      await call(m)
      const read = fake.calls.find((c) => c.table === 'media' && c.op === 'select' && c.terminal === 'maybeSingle')!
      expect(filterValue(read, 'purpose', 'in')).toEqual([...LOGO_PURPOSES])
      expect(filterValue(read, 'artist_id')).toBe(A)
    }
  })

  it('every colour write is scoped to THIS artist, not just the colour id', async () => {
    const m = await load()
    const cases: [keyof Actions, 'update' | 'delete'][] = [
      ['renameBrandColorAction', 'update'],
      ['setBrandColorHexAction', 'update'],
      ['setBrandColorNoteAction', 'update'],
      ['deleteBrandColorAction', 'delete'],
    ]
    for (const [name, op] of cases) {
      fake = fakeClient(happy())
      await CALLS[name](m)
      const w = fake.calls.find((c) => c.table === 'brand_colors' && c.op === op)!
      expect([filterValue(w, 'id'), filterValue(w, 'artist_id')], name).toEqual(['c1', A])
    }
  })

  it('deleting a never-published logo removes both its files', async () => {
    fake = fakeClient(
      happy((c) =>
        c.table === 'media' && c.op === 'delete'
          ? { data: [{ storage_path: `${A}/brand/cut.png`, source_path: `${A}/brand/orig.png` }] }
          : c.table === 'revisions'
            ? { data: [], count: 0 }
            : undefined,
      ),
    )
    await (await load()).deleteLogoAction(A, 'm1')
    expect(fake.removed.sort()).toEqual([`${A}/brand/cut.png`, `${A}/brand/orig.png`])
  })

  it('colours: a typed hex is normalised, and a new colour goes to the END', async () => {
    fake = fakeClient(
      happy((c) => (c.table === 'brand_colors' && c.op === 'select' ? { data: [{ sort_order: 6 }] } : undefined)),
    )
    await (await load()).addBrandColorAction(A, { name: ' Ink ', hex: 'ABC' })
    expect(fake.calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ name: 'Ink', hex: '#aabbcc', sort_order: 7 })
  })

  it('the browser-bar colour: shorthand expands, empty clears', async () => {
    const m = await load()
    await m.setThemeColorAction(A, 'FFF')
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ theme_color: '#ffffff' })
    fake = fakeClient(happy())
    await m.setThemeColorAction(A, '  ')
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ theme_color: null })
  })

  it('an unrecognised hex is passed to the database to refuse, not silently fixed', async () => {
    await (await load()).setBrandColorHexAction(A, 'c1', 'teal')
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ hex: 'teal' })
  })

  it('home-screen framing writes the home-screen columns, not the tab icon’s', async () => {
    await (await load()).saveFramingAction(A, { zoom: 2, offsetY: -0.5 }, 'home_icon')
    expect(fake.calls.find((c) => c.op === 'update')?.payload).toEqual({ home_icon_zoom: 2, home_icon_offset_y: -0.5 })
  })

  it('revert with nothing ever published says so, and changes nothing', async () => {
    const res = await (await load()).revertBrandAction(A)
    expect(res.error).toBe('Nothing is on the site yet, so there is nothing to go back to.')
    expect(fake.writes().filter((c) => c.op !== 'rpc')).toEqual([])
  })

  it('CRITICAL: a revert that skipped a never-published type and changed nothing is an error, not a success', async () => {
    // The site HAS something (a gallery photo, so hasPublished is true), but the fonts were
    // never published, so the lib skips them rather than wiping them — and nothing else
    // differs. Answering `{ changed: 0 }` would read as "reverted" with the bar still up.
    const { publicSnapshot } = await import('@/lib/content')
    const photo = {
      id: 'g1', artist_id: A, purpose: 'gallery_image', storage_path: `${A}/gallery/g1.png`, sort_order: 1,
      created_at: '2026-09-01T00:00:00+00:00', on_site: true, orientation: null, site_role: null, label: null,
      collection: null, alt: null, kind: 'photo',
    }
    fake = fakeClient(
      happy((c) => {
        if (c.op === 'rpc') return { data: [{ entity_type: 'media', entity_id: 'g1', data: publicSnapshot('media', photo) }] }
        if (c.op === 'select' && c.table === 'media') return { data: [photo], count: 1 }
      }),
    )
    const res = await (await load()).revertBrandAction(A)
    expect(res).toEqual({ error: 'These changes have never been on the site, so there is nothing to go back to.' })
    expect(fake.writes().filter((c) => c.op !== 'rpc')).toEqual([])
  })

  it('a revert that changed something reports how much', async () => {
    const { publicSnapshot } = await import('@/lib/content')
    const was = {
      id: 'p1', artist_id: A, purpose: 'logo_primary', storage_path: `${A}/brand/p1.png`, sort_order: 1,
      created_at: '2026-09-01T00:00:00+00:00', on_site: true, orientation: null, site_role: null, label: null,
      collection: null, alt: null, kind: 'photo',
    }
    fake = fakeClient(
      happy((c) => {
        if (c.op === 'rpc') return { data: [{ entity_type: 'media', entity_id: 'p1', data: publicSnapshot('media', was) }] }
        if (c.op === 'select' && c.table === 'media') return { data: [{ ...was, label: 'Renamed' }], count: 1 }
        if (c.op === 'update' && c.table === 'media') return { data: [{ id: 'p1' }] }
      }),
    )
    expect(await (await load()).revertBrandAction(A)).toEqual({ changed: 1 })
  })
})

describe('icon images nothing uses any more are removed — and only those', () => {
  it('CRITICAL: after a source change, the icon image still in use is KEPT; an unused one goes, file and all', async () => {
    // pruneIconSources runs after every setIconSource. Only the live suite covered it, so
    // deleting its "in use" check (which would delete the icon image just chosen) stayed
    // green in the DB-free run. `u-live` is the tab icon's source; `u-old` is nobody's.
    fake = fakeClient(
      happy((c) => {
        if (c.table === 'media' && c.op === 'select' && c.terminal === 'maybeSingle') return { data: { id: 'u-live', purpose: 'icon_source' } }
        if (c.table === 'artists' && c.op === 'update') return { data: [{ id: A }] }
        if (c.table === 'artists' && c.op === 'select' && c.terminal === 'maybeSingle' && c.cols !== 'id')
          return { data: { favicon_source_media_id: 'u-live', home_icon_source_media_id: null } }
        if (c.table === 'media' && c.op === 'select' && filterValue(c, 'purpose') === 'icon_source')
          return {
            data: [
              { id: 'u-live', storage_path: `${A}/brand/live.png` },
              { id: 'u-old', storage_path: `${A}/brand/old.png` },
            ],
          }
        if (c.table === 'revisions') return { data: [], count: 0 }
        if (c.table === 'media' && c.op === 'delete') return { data: [] }
      }),
    )
    expect(await (await load()).setIconSourceAction(A, 'favicon', 'u-live')).toEqual({})
    const deleted = fake.calls.filter((c) => c.table === 'media' && c.op === 'delete').map((c) => filterValue(c, 'id'))
    expect(deleted).toEqual(['u-old'])
    expect(fake.removed).toEqual([`${A}/brand/old.png`])
  })
})

/**
 * Storage no longer piles up (fix round, 2026-09-23). Every icon autosave uploads a new PNG
 * and swaps the row; every "Upload new" swaps a logo's file. The old object was left for a
 * sweep that the BRAND publish never runs, so a few slider drags left a folder of strays.
 * Now the replaced file goes at once — by the delete-time rule `gcDeletedMediaObject`
 * already enforces: only when the row was NEVER published (a published row's file may be
 * what the live site serves until the next publish; the sweep takes it then).
 */
describe('a replaced file goes at once — unless its row was ever published', () => {
  const OLD = `${A}/brand/old-icon.png`
  /** `media` delete answers with the rows it removed; `revisions` counts `published`. */
  const world = (o: { deleted?: Record<string, unknown>[]; published?: number; row?: Record<string, unknown> }) =>
    fakeClient(
      happy((c) => {
        if (c.table === 'media' && c.op === 'delete') return { data: o.deleted ?? [] }
        if (c.table === 'revisions') return { data: [], count: o.published ?? 0 }
        if (c.table === 'media' && c.terminal === 'maybeSingle' && o.row) return { data: o.row }
      }),
    )

  it('CRITICAL: a regenerated tab icon removes the PNG it replaced, when that PNG was never published', async () => {
    fake = world({ deleted: [{ id: 'fav-old', storage_path: OLD, source_path: null }] })
    expect(await (await load()).setBrandAssetAction(A, 'favicon', PATH)).toEqual({})
    expect(fake.removed).toEqual([OLD])
    // Asked about THAT row, not the new one.
    const count = fake.calls.find((c) => c.table === 'revisions')!
    expect([filterValue(count, 'entity_type'), filterValue(count, 'entity_id')]).toEqual(['media', 'fav-old'])
  })

  it('CRITICAL: a PUBLISHED PNG keeps its file (the site serves it until the next publish)', async () => {
    fake = world({ deleted: [{ id: 'fav-live', storage_path: OLD, source_path: null }], published: 1 })
    expect(await (await load()).setBrandAssetAction(A, 'home_icon', PATH)).toEqual({})
    expect(fake.removed).toEqual([])
  })

  it('clearing a never-published built-in logo takes its file and its cut-out original', async () => {
    fake = world({ deleted: [{ id: 's1', storage_path: `${A}/brand/cut.png`, source_path: `${A}/brand/orig.png` }] })
    await (await load()).setBrandAssetAction(A, 'logo_secondary', null)
    expect(fake.removed.sort()).toEqual([`${A}/brand/cut.png`, `${A}/brand/orig.png`])
  })

  it('CRITICAL: the NEW file is never removed, even if the old row named the same path', async () => {
    fake = world({ deleted: [{ id: 'fav-old', storage_path: PATH, source_path: null }] })
    await (await load()).setBrandAssetAction(A, 'favicon', PATH)
    expect(fake.removed).toEqual([])
  })

  it('CRITICAL: "Upload new" on a never-published logo removes the file it replaced (and the original the upload clears)', async () => {
    fake = world({ row: { storage_path: `${A}/brand/cut.png`, source_path: `${A}/brand/orig.png` } })
    expect(await (await load()).replaceLogoFileAction(A, 'm1', PATH)).toEqual({})
    expect(fake.removed.sort()).toEqual([`${A}/brand/cut.png`, `${A}/brand/orig.png`])
  })

  it('a cut-out keeps the original — only an earlier cut-out it replaces goes', async () => {
    fake = world({ row: { storage_path: `${A}/brand/orig.png`, source_path: null } })
    await (await load()).cutOutLogoAction(A, 'm1', PATH)
    expect(fake.removed).toEqual([]) // orig.png is now the row's source_path
    fake = world({ row: { storage_path: `${A}/brand/cut1.png`, source_path: `${A}/brand/orig.png` } })
    await (await load()).cutOutLogoAction(A, 'm1', PATH)
    expect(fake.removed).toEqual([`${A}/brand/cut1.png`])
  })

  it('a published logo keeps the file it replaced', async () => {
    fake = world({ row: { storage_path: `${A}/brand/live.png`, source_path: null }, published: 2 })
    await (await load()).replaceLogoFileAction(A, 'm1', PATH)
    expect(fake.removed).toEqual([])
  })

  it('a replace that matched no row removes nothing', async () => {
    fake = fakeClient(
      happy((c) => {
        if (c.table === 'media' && c.terminal === 'maybeSingle') return { data: { storage_path: `${A}/brand/x.png`, source_path: null } }
        if (c.table === 'media' && c.op === 'update') return { data: [] }
      }),
    )
    expect((await (await load()).replaceLogoFileAction(A, 'm1', PATH)).error).toBeTruthy()
    expect(fake.removed).toEqual([])
  })
})
