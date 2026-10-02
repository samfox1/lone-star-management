// lib/brand.ts on its own: what each write sends, what each refusal says, what each read defaults to.
/**
 * The action suite (brand-actions.test.ts) reaches these through `callerOwns` and a happy
 * fake; the live suite reaches them through RLS. A 2026-09-23 mutation run showed what
 * neither pinned in the DB-free slice: the SHAPE of each write (payload, scope, the column
 * list a read asks for), each function's own fallback sentence, and the defaults a sparse
 * row reads as. Each test here names the rule; the witness is the success case beside it.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FRAMING,
  addIconSource,
  addLogo,
  brandPending,
  brandPendingMessage,
  brandRefusal,
  brandSubjects,
  cleanFraming,
  deleteLogo,
  drawFavicon,
  faviconDrawBox,
  loadBrandLogos,
  loadFraming,
  loadIconSettings,
  publishBrand,
  renameLogo,
  sameFraming,
  saveFraming,
  setBrandAsset,
  setIconSource,
  setLogoFile,
  setLogoNote,
  setThemeColor,
} from '@/lib/brand'
import type { ContentRow } from '@/lib/content'
import { fakeClient, filterValue, type Call, type Reply } from '@tests/helpers/fake-client'

const A = '0f3c2b1a-5d4e-4c3b-9a8f-7e6d5c4b3a21' // real-shaped: storage-gc scopes a path by the artist id in front
const PATH = `${A}/brand/0a0a0a0a-0000-4000-8000-000000000000.png`
const NEW = `${A}/brand/1b1b1b1b-0000-4000-8000-000000000000.png`
const FOREIGN = `b2/brand/0a0a0a0a-0000-4000-8000-000000000000.png`
/** An error no REFUSALS pattern matches, so the caller's fallback sentence shows. */
const UNKNOWN = { code: '99999', message: 'something unexpected' }
const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('framing', () => {
  it('cleanFraming: anything but an object is the default; a non-number field falls back alone', () => {
    for (const raw of [null, undefined, 3, 'zoom'] as unknown[]) expect(cleanFraming(raw), String(raw)).toEqual(DEFAULT_FRAMING)
    expect(cleanFraming({ zoom: '3', offsetY: '0.2' })).toEqual(DEFAULT_FRAMING) // strings are not numbers
    expect(cleanFraming({ zoom: 3 })).toEqual({ zoom: 3, offsetY: 0 })
    expect(cleanFraming({ offsetY: -0.4 })).toEqual({ zoom: 1, offsetY: -0.4 })
    expect(cleanFraming({ zoom: 99, offsetY: -9 })).toEqual({ zoom: 6, offsetY: -1 })
  })

  it('sameFraming: closer than 0.005 on BOTH is the same; 0.005 apart on either is a change', () => {
    expect(sameFraming({ zoom: 2, offsetY: 0 }, { zoom: 2, offsetY: 0.004 })).toBe(true)
    expect(sameFraming({ zoom: 2, offsetY: 0 }, { zoom: 2, offsetY: 0.005 })).toBe(false)
    expect(sameFraming({ zoom: 2, offsetY: 0 }, { zoom: 2, offsetY: 0.3 })).toBe(false) // offset alone
    expect(sameFraming({ zoom: 2, offsetY: 0 }, { zoom: 2.3, offsetY: 0 })).toBe(false) // zoom alone
  })

  it('a logo with no width OR no height has nothing to draw — an empty box, and no drawImage', () => {
    const empty = { x: 0, y: 0, width: 0, height: 0 }
    expect(faviconDrawBox({ width: 0, height: 100 }, DEFAULT_FRAMING, 180)).toEqual(empty)
    expect(faviconDrawBox({ width: 100, height: 0 }, DEFAULT_FRAMING, 180)).toEqual(empty)
    const ctx = { clearRect: vi.fn(), drawImage: vi.fn() }
    drawFavicon(ctx as unknown as CanvasRenderingContext2D, { width: 0, height: 100 } as never, DEFAULT_FRAMING, 180)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 180, 180)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('loadFraming reads the tab icon\'s own columns (the default target), and a missing row is the default', async () => {
    const fake = fakeClient(() => ({ data: { favicon_zoom: 2.5, favicon_offset_y: null } }))
    expect(await loadFraming(fake.client, A)).toEqual({ zoom: 2.5, offsetY: 0 })
    expect([fake.calls[0].table, fake.calls[0].cols, filterValue(fake.calls[0], 'id')]).toEqual(['artists', 'favicon_zoom, favicon_offset_y', A])
    expect(await loadFraming(fakeClient(() => ({ data: null })).client, A)).toEqual(DEFAULT_FRAMING)
    const home = fakeClient(() => ({ data: { home_icon_zoom: 3, home_icon_offset_y: -0.5 } }))
    expect(await loadFraming(home.client, A, 'home_icon')).toEqual({ zoom: 3, offsetY: -0.5 })
  })

  it('saveFraming writes the tab icon\'s columns by default, clamped; a refusal is an error', async () => {
    const fake = fakeClient()
    expect(await saveFraming(fake.client, A, { zoom: 9, offsetY: 0.25 })).toEqual({ ok: true })
    expect(fake.calls[0].payload).toEqual({ favicon_zoom: 6, favicon_offset_y: 0.25 })
    expect([fake.calls[0].table, filterValue(fake.calls[0], 'id')]).toEqual(['artists', A])
    expect(await saveFraming(fakeClient(() => ({ error: { message: 'nope' } })).client, A, DEFAULT_FRAMING)).toEqual({ ok: false, error: 'nope' })
  })

  it('loadIconSettings: each icon\'s source and framing, and the bar colour; a sparse row reads as defaults', async () => {
    const fake = fakeClient(() => ({
      data: { favicon_source_media_id: 'm1', favicon_zoom: 2, favicon_offset_y: 0.1, home_icon_zoom: 3, theme_color: '#0a0b0c' },
    }))
    expect(await loadIconSettings(fake.client, A)).toEqual({
      favicon: { sourceMediaId: 'm1', framing: { zoom: 2, offsetY: 0.1 } },
      homeIcon: { sourceMediaId: null, framing: { zoom: 3, offsetY: 0 } },
      themeColor: '#0a0b0c',
    })
    expect([fake.calls[0].table, filterValue(fake.calls[0], 'id')]).toEqual(['artists', A])
    expect(fake.calls[0].cols).toContain('home_icon_source_media_id')
    expect(await loadIconSettings(fakeClient(() => ({ data: null })).client, A)).toEqual({
      favicon: { sourceMediaId: null, framing: DEFAULT_FRAMING },
      homeIcon: { sourceMediaId: null, framing: DEFAULT_FRAMING },
      themeColor: null,
    })
  })
})

describe('setBrandAsset (a single-occupancy slot)', () => {
  type MediaRow = { id: string; artist_id: string; purpose: string; storage_path: string; source_path?: string | null }
  const OLD = `${A}/brand/old.png`
  const ORIG = `${A}/brand/orig.png`
  const row = (id: string, purpose: string, storage_path: string, source_path: string | null = null): MediaRow => ({
    id,
    artist_id: A,
    purpose,
    storage_path,
    source_path,
  })

  /**
   * An in-memory `media` table behind the PostgREST fake, so a test reads the rows LEFT and the
   * files removed, never a return value. `published`: row ids with a revision. `fail`: make that
   * statement answer an error and change nothing; `failDeletes` fails only the first N deletes.
   */
  const table = (seed: MediaRow[] = [], o: { published?: string[]; fail?: { select?: string; insert?: string }; failDeletes?: number } = {}) => {
    const rows = seed.map((r) => ({ ...r }))
    let made = 0
    let deletesLeftToFail = o.failDeletes ?? 0
    const matches = (c: Call) => (r: MediaRow) =>
      c.filters.every(([m, col, v]) => {
        const got = (r as Record<string, unknown>)[col]
        if (m === 'eq') return got === v
        if (m === 'neq') return got !== v
        if (m === 'in') return (v as unknown[]).includes(got)
        return true
      })
    const fake = fakeClient((c: Call) => {
      if (c.table === 'revisions') {
        const id = filterValue(c, 'entity_id')
        return { data: [], count: id !== undefined && (o.published ?? []).includes(String(id)) ? 1 : 0 }
      }
      if (c.table !== 'media') return { data: [] }
      if (c.op === 'insert') {
        if (o.fail?.insert) return { error: { message: o.fail.insert } }
        const r = { id: `new-${++made}`, ...(c.payload as object) } as MediaRow
        rows.push(r)
        return { data: c.terminal ? { id: r.id } : [{ id: r.id }] }
      }
      if (c.op === 'delete') {
        if (deletesLeftToFail > 0) {
          deletesLeftToFail--
          return { error: { message: 'delete refused' } }
        }
        const gone = rows.filter(matches(c))
        for (const g of gone) rows.splice(rows.indexOf(g), 1)
        return { data: gone }
      }
      if (o.fail?.select && filterValue(c, 'purpose') !== undefined) return { error: { message: o.fail.select } }
      const found = rows.filter(matches(c))
      return { data: found, count: found.length }
    })
    return { ...fake, rows, slot: (purpose: string) => rows.filter((r) => r.purpose === purpose).map((r) => r.storage_path) }
  }

  // The path comes from the browser: another tenant's folder is refused before anything runs.
  it('CRITICAL: a path outside this artist\'s folder is refused before anything is touched', async () => {
    const t = table([row('old', 'favicon', OLD)])
    expect(await setBrandAsset(t.client, A, 'logo_primary', FOREIGN)).toEqual({ ok: false, error: 'That file location is not valid.' })
    expect(t.calls).toEqual([])
  })

  // The new row lands FIRST (on the site, stamped now); only then do the rows it replaces go, by id.
  it('CRITICAL: inserts the new file first, then deletes the replaced rows BY ID; the slot ends with the new file alone', async () => {
    const t = table([row('old', 'favicon', OLD), row('logo-1', 'logo_primary', PATH)])
    const before = nowSeconds()
    expect(await setBrandAsset(t.client, A, 'favicon', NEW)).toEqual({ ok: true })
    const writes = t.writes().filter((c) => c.table === 'media')
    expect(writes.map((c) => c.op)).toEqual(['insert', 'delete'])
    const p = writes[0].payload as Record<string, unknown>
    expect(p).toMatchObject({ artist_id: A, purpose: 'favicon', storage_path: NEW, on_site: true })
    expect(p.sort_order).toBeGreaterThanOrEqual(before)
    expect(p.sort_order).toBeLessThanOrEqual(nowSeconds())
    expect([filterValue(writes[1], 'artist_id'), filterValue(writes[1], 'purpose'), filterValue(writes[1], 'id', 'in')]).toEqual([A, 'favicon', ['old']])
    expect(t.slot('favicon')).toEqual([NEW])
    expect(t.slot('logo_primary')).toEqual([PATH]) // another slot is never touched
    expect(t.removed).toEqual([OLD]) // never published, named by nothing now
  })

  // The bug this guards (review of d558c8e, the profile photo's twin): vacate-then-insert left an
  // empty slot on a failed insert AND swept the old file, so the live icon lost its file too.
  it('CRITICAL: a failed insert keeps the old asset row AND its file', async () => {
    const t = table([row('old', 'favicon', OLD, ORIG)], { fail: { insert: 'insert refused' } })
    expect(await setBrandAsset(t.client, A, 'favicon', NEW)).toEqual({ ok: false, error: 'insert refused' })
    expect(t.calls.some((c) => c.op === 'delete')).toBe(false)
    expect(t.rows).toEqual([row('old', 'favicon', OLD, ORIG)])
    expect(t.removed).toEqual([])
  })

  // The delete fails after a good insert: the new row is taken back out, so the slot is exactly as
  // it was and the error is true. The caller (performUpload) then removes the new file, which no
  // row names. The old row keeps its file.
  it('CRITICAL: a failed delete undoes the insert: the old row and file stay, nothing swept, the error is said', async () => {
    const t = table([row('old', 'favicon', OLD)], { failDeletes: 1 })
    const res = await setBrandAsset(t.client, A, 'favicon', NEW)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/could not be replaced.*delete refused/i)
    expect(t.slot('favicon')).toEqual([OLD])
    expect(t.removed).toEqual([])
  })

  // Worst case, the undo fails too: two rows, never none. The new row names the new file, so this
  // must not read as a failure (performUpload would remove a file a row names). The Brand page
  // shows the newest; the next save deletes both old rows by id.
  it('CRITICAL: a failed delete AND a failed undo leave two rows, keep both files, and do not report a failure', async () => {
    const t = table([row('old', 'favicon', OLD)], { failDeletes: 2 })
    expect(await setBrandAsset(t.client, A, 'favicon', NEW)).toEqual({ ok: true })
    expect(t.slot('favicon').sort()).toEqual([NEW, OLD].sort())
    expect(t.removed).toEqual([])
    // …and the next save clears the extra row.
    expect(await setBrandAsset(t.client, A, 'favicon', PATH)).toEqual({ ok: true })
    expect(t.slot('favicon')).toEqual([PATH])
  })

  // A read of the slot that failed is not "empty": nothing is written.
  it('a failed read of the slot stops there: no insert, no delete, the error is said', async () => {
    const t = table([row('old', 'favicon', OLD)], { fail: { select: 'permission denied' } })
    expect(await setBrandAsset(t.client, A, 'favicon', PATH)).toEqual({ ok: false, error: 'permission denied' })
    expect(t.writes()).toEqual([])
    expect(t.slot('favicon')).toEqual([OLD])
  })

  // Two overlapping saves (the tab icon autosaves) each delete only what they read, so the slot can
  // end with two rows but never none, and neither new file is removed.
  it('CRITICAL: two overlapping saves never empty the slot or remove either new file', async () => {
    const t = table([row('old', 'favicon', OLD)])
    await Promise.all([setBrandAsset(t.client, A, 'favicon', NEW), setBrandAsset(t.client, A, 'favicon', PATH)])
    expect(t.slot('favicon').length).toBeGreaterThan(0)
    expect(t.slot('favicon')).not.toContain(OLD)
    expect(t.removed).toEqual([OLD])
  })

  // A clear (null) inserts nothing and empties the slot; its never-published files go with it.
  it('a clear inserts nothing, empties the slot and takes a never-published file and its original', async () => {
    const t = table([row('old', 'logo_secondary', OLD, ORIG)])
    expect(await setBrandAsset(t.client, A, 'logo_secondary', null)).toEqual({ ok: true })
    expect(t.calls.filter((c) => c.op === 'insert')).toEqual([])
    expect(t.slot('logo_secondary')).toEqual([])
    expect(t.removed.sort()).toEqual([OLD, ORIG].sort())
  })

  // A stray second row (an old race) is cleared by the next replace; a file the slot still names stays.
  it('CRITICAL: a replace over two rows leaves one, and never removes a file the slot still names', async () => {
    const t = table([row('old', 'favicon', OLD, ORIG), row('same', 'favicon', NEW)])
    expect(await setBrandAsset(t.client, A, 'favicon', NEW)).toEqual({ ok: true })
    expect(t.slot('favicon')).toEqual([NEW])
    expect(t.removed.sort()).toEqual([OLD, ORIG].sort())
  })

  // A published row's file may be what the live site serves: it waits for the publish sweep.
  it('a replaced row that WAS published keeps its files; nothing replaced asks nothing', async () => {
    const pub = table([row('old', 'favicon', OLD)], { published: ['old'] })
    await setBrandAsset(pub.client, A, 'favicon', NEW)
    expect(pub.slot('favicon')).toEqual([NEW])
    expect(pub.removed).toEqual([])
    const none = table()
    await setBrandAsset(none.client, A, 'favicon', NEW)
    expect(none.calls.some((c) => c.table === 'revisions')).toBe(false)
    expect(none.calls.some((c) => c.op === 'delete')).toBe(false)
  })
})

describe('logos', () => {
  const logoRow = (id: string, purpose: string, extra: Record<string, unknown> = {}) => ({
    id,
    purpose,
    label: null,
    note: null,
    storage_path: `${A}/brand/${id}.png`,
    source_path: null,
    sort_order: 1,
    ...extra,
  })

  it('loadBrandLogos asks for THIS artist\'s logos in order, and a stray second primary is the newest one', async () => {
    const fake = fakeClient(() => ({
      data: [logoRow('p-old', 'logo_primary'), logoRow('p-new', 'logo_primary', { sort_order: undefined }), logoRow('s1', 'logo_secondary')],
    }))
    const logos = await loadBrandLogos(fake.client, A)
    expect(logos.primary?.id).toBe('p-new')
    expect(logos.secondary?.id).toBe('s1')
    expect(logos.primary?.sortOrder).toBe(0)
    const [read] = fake.calls
    expect([read.table, read.cols]).toEqual(['media', 'id, purpose, label, note, storage_path, source_path, sort_order, created_at'])
    expect(read.filters).toEqual([
      ['eq', 'artist_id', A],
      ['in', 'purpose', ['logo_primary', 'logo_secondary', 'logo']],
      ['order', 'sort_order', { ascending: true }],
      ['order', 'created_at', { ascending: true }],
    ])
    await expect(loadBrandLogos(fakeClient(() => ({ error: { message: 'boom' } })).client, A)).rejects.toThrow('boom')
  })

  it('addLogo: one insert — a cleaned title, the note, the file, on the site, stamped now — and the logo back', async () => {
    const fake = fakeClient(() => ({ data: logoRow('n1', 'logo', { label: 'Tour logo', note: 'merch' }) }))
    const res = await addLogo(fake.client, A, { title: ' Tour\nlogo ', note: ' merch ', storagePath: PATH })
    expect(res.ok).toBe(true)
    expect(res.logo).toMatchObject({ id: 'n1', label: 'Tour logo', note: 'merch' })
    const ins = fake.calls[0]
    expect(ins.table).toBe('media')
    expect(ins.payload).toMatchObject({ artist_id: A, purpose: 'logo', label: 'Tour logo', note: 'merch', storage_path: PATH, on_site: true })
    expect((ins.payload as { sort_order: number }).sort_order).toBeLessThanOrEqual(nowSeconds())
  })

  it('addLogo: a foreign path, an unknown refusal and an empty answer are each an error', async () => {
    const none = fakeClient()
    expect(await addLogo(none.client, A, { title: 'T', storagePath: FOREIGN })).toEqual({ ok: false, error: 'That file location is not valid.' })
    expect(none.calls).toEqual([])
    expect(await addLogo(fakeClient(() => ({ error: UNKNOWN })).client, A, { title: 'T', storagePath: PATH })).toEqual({
      ok: false,
      error: 'Could not save that logo.',
    })
    expect(await addLogo(fakeClient(() => ({ data: null })).client, A, { title: 'T', storagePath: PATH })).toEqual({
      ok: false,
      error: 'Could not save that logo.',
    })
  })

  it('rename and note: one column each, scoped to the id, each with its own fallback sentence', async () => {
    const ok = fakeClient(() => ({ data: [{ id: 'l1' }] }))
    expect(await renameLogo(ok.client, A, 'l1', ' Mono ')).toEqual({ ok: true })
    expect(ok.calls[0].payload).toEqual({ label: 'Mono' })
    expect([filterValue(ok.calls[0], 'id'), ok.calls[0].cols]).toEqual(['l1', 'id'])
    expect(await setLogoNote(ok.client, A, 'l1', '  ')).toEqual({ ok: true })
    expect(ok.calls[1].payload).toEqual({ note: null })
    expect(await renameLogo(fakeClient(() => ({ error: UNKNOWN })).client, A, 'l1', 'x')).toEqual({ ok: false, error: 'Could not rename that logo.' })
    expect(await setLogoNote(fakeClient(() => ({ error: UNKNOWN })).client, A, 'l1', 'x')).toEqual({ ok: false, error: 'Could not save that note.' })
    expect(await renameLogo(fakeClient(() => ({ data: [] })).client, A, 'l1', 'x')).toEqual({ ok: false, error: 'That logo is no longer there.' })
  })

  it('deleteLogo: hands back both files; a refusal and a missing row are errors in their own words', async () => {
    const ok = fakeClient(() => ({ data: [{ storage_path: `${A}/brand/c.png`, source_path: `${A}/brand/o.png` }] }))
    expect(await deleteLogo(ok.client, A, 'l1')).toEqual({ ok: true, storagePath: `${A}/brand/c.png`, sourcePath: `${A}/brand/o.png` })
    expect([filterValue(ok.calls[0], 'id'), ok.calls[0].cols]).toEqual(['l1', 'storage_path, source_path'])
    expect(await deleteLogo(fakeClient(() => ({ error: UNKNOWN })).client, A, 'l1')).toEqual({ ok: false, error: 'Could not remove that logo.' })
    expect(await deleteLogo(fakeClient(() => ({ data: [] })).client, A, 'l1')).toEqual({ ok: false, error: 'That logo is no longer there.' })
  })

  describe('setLogoFile', () => {
    const world = (o: { row?: unknown; up?: Reply; published?: number } = {}) =>
      fakeClient((c: Call) => {
        // No OTHER row names the old files (storage-gc.ts stillNamed, 2026-10-02).
        if (c.op === 'select' && filterValue(c, 'storage_path') !== undefined) return { data: null, count: 0 }
        if (c.op === 'select' && c.table === 'media')
          return { data: o.row === undefined ? { storage_path: `${A}/brand/cut.png`, source_path: `${A}/brand/orig.png` } : o.row }
        if (c.op === 'update') return o.up ?? { data: [{ id: 'l1' }] }
        if (c.table === 'revisions') return { data: [], count: o.published ?? 0 }
        return { data: [] }
      })

    it('reads the row it will repoint by id and artist, and a missing row is an error with no write', async () => {
      const gone = world({ row: null })
      expect(await setLogoFile(gone.client, A, 'l1', NEW, { keepOriginal: false })).toEqual({ ok: false, error: 'That logo is no longer there.' })
      expect(gone.writes()).toEqual([])
      const read = gone.calls[0]
      expect([read.cols, filterValue(read, 'id'), filterValue(read, 'artist_id')]).toEqual(['storage_path, source_path', 'l1', A])
    })

    it('an unknown refusal and a lost race are errors, in their own words', async () => {
      expect(await setLogoFile(world({ up: { error: UNKNOWN } }).client, A, 'l1', NEW, { keepOriginal: false })).toEqual({
        ok: false,
        error: 'Could not save that logo.',
      })
      expect(await setLogoFile(world({ up: { data: [] } }).client, A, 'l1', NEW, { keepOriginal: false })).toEqual({
        ok: false,
        error: 'That logo changed while you were editing it. Try again.',
      })
    })

    it('the update is scoped to the id, the artist and the file it read', async () => {
      const fake = world()
      await setLogoFile(fake.client, A, 'l1', NEW, { keepOriginal: false })
      const up = fake.calls.find((c) => c.op === 'update')!
      expect([filterValue(up, 'id'), filterValue(up, 'artist_id'), filterValue(up, 'storage_path'), up.cols]).toEqual([
        'l1',
        A,
        `${A}/brand/cut.png`,
        'id',
      ])
    })

    it('CRITICAL: a fresh upload over a never-published cut-out drops BOTH old files; a cut-out keeps the original', async () => {
      const fresh = world()
      await setLogoFile(fresh.client, A, 'l1', NEW, { keepOriginal: false })
      expect(fresh.removed.sort()).toEqual([`${A}/brand/cut.png`, `${A}/brand/orig.png`])
      const cut = world()
      await setLogoFile(cut.client, A, 'l1', NEW, { keepOriginal: true })
      expect(cut.removed).toEqual([`${A}/brand/cut.png`])
      const published = world({ published: 1 })
      await setLogoFile(published.client, A, 'l1', NEW, { keepOriginal: false })
      expect(published.removed).toEqual([])
    })
  })
})

describe('icons and the browser bar', () => {
  it('choosing the PRIMARY (null) looks nothing up — it is always allowed', async () => {
    const fake = fakeClient((c: Call) => (c.table === 'artists' && c.op === 'update' ? { data: [{ id: A }] } : { data: null }))
    expect(await setIconSource(fake.client, A, 'favicon', null)).toEqual({ ok: true })
    expect(fake.calls.some((c) => c.table === 'media' && c.terminal === 'maybeSingle')).toBe(false)
  })

  it('a chosen source is looked up by id AND artist before it is written', async () => {
    const fake = fakeClient((c: Call) =>
      c.table === 'artists' && c.op === 'update' ? { data: [{ id: A }] } : c.terminal === 'maybeSingle' ? { data: { id: 'm1', purpose: 'logo' } } : { data: [] },
    )
    expect(await setIconSource(fake.client, A, 'home_icon', 'm1')).toEqual({ ok: true })
    const look = fake.calls.find((c) => c.table === 'media' && c.terminal === 'maybeSingle')!
    expect([look.cols, filterValue(look, 'id'), filterValue(look, 'artist_id')]).toEqual(['id, purpose', 'm1', A])
    const up = fake.calls.find((c) => c.table === 'artists' && c.op === 'update')!
    expect([up.payload, filterValue(up, 'id'), up.cols]).toEqual([{ home_icon_source_media_id: 'm1' }, A, 'id'])
    expect(await setIconSource(fakeClient(() => ({ error: UNKNOWN })).client, A, 'favicon', null)).toEqual({
      ok: false,
      error: 'Could not change the icon.',
    })
  })

  it('addIconSource: an off-site icon image, made the source, and its id back — nothing deleted on success', async () => {
    const fake = fakeClient((c: Call) => {
      if (c.op === 'insert') return { data: { id: 'u1' } }
      if (c.table === 'media' && c.terminal === 'maybeSingle') return { data: { id: 'u1', purpose: 'icon_source' } }
      if (c.table === 'artists' && c.op === 'update') return { data: [{ id: A }] }
      if (c.table === 'artists') return { data: { favicon_source_media_id: 'u1', home_icon_source_media_id: null } }
      return { data: [] }
    })
    expect(await addIconSource(fake.client, A, 'favicon', PATH)).toEqual({ ok: true, mediaId: 'u1' })
    const ins = fake.calls.find((c) => c.op === 'insert')!
    expect([ins.table, ins.cols]).toEqual(['media', 'id'])
    expect(ins.payload).toMatchObject({ artist_id: A, purpose: 'icon_source', storage_path: PATH, on_site: false })
    expect((ins.payload as { sort_order: number }).sort_order).toBeLessThanOrEqual(nowSeconds())
    expect(fake.calls.filter((c) => c.op === 'delete')).toEqual([])
    expect(await addIconSource(fakeClient(() => ({ error: UNKNOWN })).client, A, 'favicon', PATH)).toEqual({
      ok: false,
      error: 'Could not save that image.',
    })
    expect(await addIconSource(fakeClient(() => ({ data: null })).client, A, 'favicon', PATH)).toEqual({
      ok: false,
      error: 'Could not save that image.',
    })
  })

  it('CRITICAL: pruning an unused icon image whose row would NOT delete keeps its file — a row never names a missing file', async () => {
    const fake = fakeClient((c: Call) => {
      if (c.table === 'artists' && c.op === 'update') return { data: [{ id: A }] }
      if (c.table === 'artists') return { data: { favicon_source_media_id: null, home_icon_source_media_id: null } }
      if (c.table === 'media' && c.op === 'select') return { data: [{ id: 'u-old', storage_path: `${A}/brand/old.png` }] }
      if (c.table === 'media' && c.op === 'delete') return { error: { message: 'permission denied' } }
      if (c.table === 'revisions') return { data: [], count: 0 }
      return { data: [] }
    })
    expect(await setIconSource(fake.client, A, 'favicon', null)).toEqual({ ok: true })
    const del = fake.calls.find((c) => c.table === 'media' && c.op === 'delete')! // the witness: it tried
    expect([filterValue(del, 'id'), filterValue(del, 'artist_id')]).toEqual(['u-old', A])
    expect(fake.removed).toEqual([])
    // What it read to decide: THIS artist's two sources, and THIS artist's icon images.
    const src = fake.calls.find((c) => c.table === 'artists' && c.op === 'select' && c.cols !== 'id')!
    expect([src.cols, filterValue(src, 'id')]).toEqual(['favicon_source_media_id, home_icon_source_media_id', A])
    const imgs = fake.calls.find((c) => c.table === 'media' && c.op === 'select')!
    expect([imgs.cols, filterValue(imgs, 'artist_id'), filterValue(imgs, 'purpose')]).toEqual(['id, storage_path', A, 'icon_source'])
  })

  it('setThemeColor: typed text is trimmed, lowercased, or cleared; a refusal says so', async () => {
    const fake = fakeClient(() => ({ data: [{ id: A }] }))
    await setThemeColor(fake.client, A, ' Teal ')
    expect(fake.calls[0].payload).toEqual({ theme_color: 'teal' })
    await setThemeColor(fake.client, A, null)
    expect(fake.calls[1].payload).toEqual({ theme_color: null })
    expect(await setThemeColor(fakeClient(() => ({ error: UNKNOWN })).client, A, '#000000')).toEqual({ ok: false, error: 'Could not save that color.' })
    expect(await setThemeColor(fakeClient(() => ({ data: [] })).client, A, '#000000')).toEqual({ ok: false, error: 'Not found.' })
  })
})

describe('refusals', () => {
  it('the icon-source FK and the weight range have their own sentences; no error at all is the fallback', () => {
    expect(brandRefusal({ message: 'violates foreign key constraint "artists_home_icon_source_fk"' }, 'x')).toBe('Pick one of this artist’s logos.')
    expect(brandRefusal({ message: 'violates check constraint "artist_fonts_weight_range"' }, 'x')).toBe('Font weight must be between 100 and 900.')
    expect(brandRefusal(null, 'Fallback.')).toBe('Fallback.')
    expect(brandRefusal(undefined, 'Fallback.')).toBe('Fallback.')
  })
})

describe('the Brand bar\'s subjects', () => {
  const change = (id: string, change: 'added' | 'edited' | 'deleted', snapshot: Record<string, unknown>) => ({ id, change, snapshot })

  it('two added logos are two changes, each by its own title; a blank title reads "Logo"', () => {
    expect(brandPendingMessage(brandSubjects([change('l1', 'added', { purpose: 'logo', label: 'A' }), change('l2', 'added', { purpose: 'logo', label: 'B' })], []))).toBe('2 changes')
    expect(brandPendingMessage(brandSubjects([change('l1', 'added', { purpose: 'logo', label: '  ' })], []))).toBe('Logo added')
  })

  it('an icon image neither icon uses is "Icons changed" — never "added"; fonts are "Fonts"', () => {
    expect(brandPendingMessage(brandSubjects([change('u9', 'added', { purpose: 'icon_source' })], []))).toBe('Icons changed')
    expect(brandPendingMessage(brandSubjects([change('u1', 'added', { purpose: 'icon_source' })], [], { favicon: 'u1', homeIcon: null }))).toBe('Tab icon changed')
    expect(brandPendingMessage(brandSubjects([], [change('f1', 'added', {})]))).toBe('Fonts added')
    // A font and an unlinked image are two subjects, not one.
    expect(brandPendingMessage(brandSubjects([change('u9', 'added', { purpose: 'icon_source' })], [change('f1', 'added', {})]))).toBe('2 changes')
  })

  it('brandPending asks for THIS artist\'s log and icon sources; a HOME-screen icon image names the home-screen icon', async () => {
    const img: ContentRow = {
      id: 'h1', artist_id: A, purpose: 'icon_source', storage_path: `${A}/brand/h1.png`, sort_order: 1, created_at: 'x',
      on_site: false, orientation: null, site_role: null, label: null, collection: null, alt: null, kind: 'photo',
    }
    const fake = fakeClient((c: Call) => {
      if (c.op === 'rpc') return { data: [] }
      if (c.table === 'media') return { data: [img], count: 1 }
      if (c.table === 'artists') return { data: { favicon_source_media_id: null, home_icon_source_media_id: 'h1' } }
      return { data: [], count: 0 }
    })
    expect((await brandPending(fake.client, A)).message).toBe('Home-screen icon changed')
    expect(fake.calls.find((c) => c.op === 'rpc')!.args).toEqual({ p_artist_id: A })
    // Two reads of `artists` now: the icon sources, and the browser-bar colour (a published
    // singleton since 20260925120000). Both this artist's.
    const src = fake.calls.find((c) => c.table === 'artists' && c.cols !== 'id, theme_color')!
    expect([src.cols, filterValue(src, 'id')]).toEqual(['favicon_source_media_id, home_icon_source_media_id', A])
    const bar = fake.calls.find((c) => c.table === 'artists' && c.cols === 'id, theme_color')!
    expect(filterValue(bar, 'id')).toBe(A)
  })

  it('publishBrand reports every revision it wrote — media AND fonts', async () => {
    const logo: ContentRow = {
      id: 'p1', artist_id: A, purpose: 'logo_primary', storage_path: PATH, sort_order: 1, created_at: 'x', on_site: true,
      orientation: null, site_role: null, label: null, collection: null, alt: null, kind: 'photo',
    }
    const f = { id: 'f1', artist_id: A, label: 'Mori', family: 'mori', storage_path: `${A}/fonts/f1.woff2`, format: 'woff2', created_at: 'x', slots: ['primary'] }
    const fake = fakeClient((c: Call) => {
      if (c.op === 'rpc') return { data: [] }
      if (c.op === 'select' && c.table === 'media') return { data: [logo], count: 1 }
      if (c.op === 'select' && c.table === 'artist_fonts_with_slots') return { data: [f], count: 1 }
      if (c.op === 'insert') return { data: (c.payload as unknown[]).map((_, i) => ({ id: `r${i}` })) }
      return { data: [] }
    })
    // One media revision and one font revision were written (the witness), in ONE insert
    // (one publish moment), and both count.
    const n = await publishBrand(fake.client, A, 'u1')
    expect(fake.calls.filter((c) => c.table === 'revisions' && c.op === 'insert').map((c) => (c.payload as unknown[]).length)).toEqual([2])
    expect(n).toBe(2)
  })
})
