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
import { fakeClient, filterValue, type Call, type Reply } from '@tests/unit/brand/_fake-client'

const A = 'a1'
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
  /** The vacate returns `replaced`; the revision count says whether a row was ever published. */
  const world = (o: { replaced?: unknown[]; published?: number; del?: Reply; ins?: Reply } = {}) =>
    fakeClient((c: Call) => {
      if (c.table === 'media' && c.op === 'delete') return o.del ?? { data: o.replaced ?? [] }
      if (c.table === 'media' && c.op === 'insert') return o.ins ?? { data: null }
      if (c.table === 'revisions') return { data: [], count: o.published ?? 0 }
      return { data: [] }
    })

  it('CRITICAL: a path outside this artist\'s folder is refused before anything is touched', async () => {
    const fake = world()
    expect(await setBrandAsset(fake.client, A, 'logo_primary', FOREIGN)).toEqual({ ok: false, error: 'That file location is not valid.' })
    expect(fake.calls).toEqual([])
  })

  it('vacates THIS slot of THIS artist, then inserts the new file on the site, stamped now', async () => {
    const fake = world()
    const before = nowSeconds()
    expect(await setBrandAsset(fake.client, A, 'favicon', PATH)).toEqual({ ok: true })
    const del = fake.calls.find((c) => c.op === 'delete')!
    expect([filterValue(del, 'artist_id'), filterValue(del, 'purpose'), del.cols]).toEqual([A, 'favicon', 'id, storage_path, source_path'])
    const ins = fake.calls.find((c) => c.op === 'insert')!
    expect(ins.table).toBe('media')
    const p = ins.payload as Record<string, unknown>
    expect(p).toMatchObject({ artist_id: A, purpose: 'favicon', storage_path: PATH, on_site: true })
    expect(p.sort_order).toBeGreaterThanOrEqual(before)
    expect(p.sort_order).toBeLessThanOrEqual(nowSeconds())
  })

  it('a failed vacate stops there — no insert, and the error is said', async () => {
    const fake = world({ del: { error: { message: 'permission denied' } } })
    expect(await setBrandAsset(fake.client, A, 'favicon', PATH)).toEqual({ ok: false, error: 'permission denied' })
    expect(fake.calls.filter((c) => c.op === 'insert')).toEqual([])
  })

  it('a refused insert is an error; a clear (null) inserts nothing and is a success', async () => {
    expect(await setBrandAsset(world({ ins: { error: { message: 'bad' } } }).client, A, 'favicon', PATH)).toEqual({ ok: false, error: 'bad' })
    const clear = world()
    expect(await setBrandAsset(clear.client, A, 'logo_secondary', null)).toEqual({ ok: true })
    expect(clear.calls.filter((c) => c.op === 'insert')).toEqual([])
  })

  it('CRITICAL: the replaced row\'s files go when it was never published — but never a file the slot still names', async () => {
    const fake = world({ replaced: [{ id: 'old', storage_path: `${A}/brand/old.png`, source_path: `${A}/brand/orig.png` }, { id: 'same', storage_path: NEW }] })
    await setBrandAsset(fake.client, A, 'favicon', NEW)
    expect(fake.removed.sort()).toEqual([`${A}/brand/old.png`, `${A}/brand/orig.png`])
  })

  it('a replaced row that WAS published keeps its files (the site may serve them); nothing replaced asks nothing', async () => {
    const pub = world({ replaced: [{ id: 'old', storage_path: `${A}/brand/old.png` }], published: 1 })
    await setBrandAsset(pub.client, A, 'favicon', NEW)
    expect(pub.removed).toEqual([])
    const none = world()
    await setBrandAsset(none.client, A, 'favicon', NEW)
    expect(none.calls.some((c) => c.table === 'revisions')).toBe(false)
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
    const src = fake.calls.find((c) => c.table === 'artists')!
    expect([src.cols, filterValue(src, 'id')]).toEqual(['favicon_source_media_id, home_icon_source_media_id', A])
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
    // One media revision and one font revision were written (the witness), and both count.
    const n = await publishBrand(fake.client, A, 'u1')
    expect(fake.calls.filter((c) => c.table === 'revisions' && c.op === 'insert').map((c) => (c.payload as unknown[]).length)).toEqual([1, 1])
    expect(n).toBe(2)
  })
})
