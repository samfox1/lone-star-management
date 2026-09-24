// The Brand bar's Revert puts logos, icons and fonts back to what the site shows — and never
//   touches a gallery photo.
/**
 * `restoreBrandToPublished` over a fake client: which writes it makes, given a published
 * log and a working draft. The live-database run (real rows, real revisions) is in
 * tests/integration/manager-tools/brand/brand-page.test.ts; this file pins the DECISIONS, each against a
 * planted case that would make the wrong decision visible.
 */
import { describe, expect, it } from 'vitest'
import { restoreBrandToPublished } from '@/lib/brand'
import { publicSnapshot, type ContentRow } from '@/lib/content'
import { fakeClient, filterValue, type Call } from '@tests/unit/manager-tools/brand/_fake-client'

const A = 'a1'

const media = (id: string, purpose: string, extra: Record<string, unknown> = {}): ContentRow => ({
  id,
  artist_id: A,
  purpose,
  storage_path: `${A}/brand/${id}.png`,
  source_path: null,
  note: null,
  sort_order: 1,
  created_at: '2026-09-01T00:00:00+00:00',
  on_site: true,
  orientation: null,
  site_role: null,
  label: null,
  collection: null,
  alt: null,
  kind: 'photo',
  ...extra,
})
const font = (id: string, slots: string[], extra: Record<string, unknown> = {}): ContentRow => ({
  id,
  artist_id: A,
  label: `Font ${id}`,
  family: `family-${id}`,
  storage_path: `${A}/fonts/${id}.woff2`,
  format: 'woff2',
  created_at: '2026-09-01T00:00:00+00:00',
  slots,
  ...extra,
})
const pub = (type: 'media' | 'artist_font', row: ContentRow) => ({ entity_type: type, entity_id: row.id, data: publicSnapshot(type, row) })
const tomb = (type: string, id: string) => ({ entity_type: type, entity_id: id, data: { _deleted: true } })

/** A slot row. `created_at` defaults to BEFORE the last font publish (PUBLISHED_AT): the
 *  row the site had. A row made after it is a new row reusing the slot. */
type Slot = { slot: string; font_id: string; label?: string | null; note?: string | null; created_at?: string }

/** When the fonts were last published (the newest `artist_font` revision). */
const PUBLISHED_AT = '2026-09-10T12:00:00.000000+00:00'
const BEFORE_PUBLISH = '2026-09-01T00:00:00.000000+00:00'
const SINCE_PUBLISH = '2026-09-20T00:00:00.000000+00:00'

function world(o: {
  log: { entity_type: string; entity_id: string; data: Record<string, unknown> }[]
  media?: ContentRow[]
  fonts?: ContentRow[]
  slots?: Slot[]
  /** `artists.<icon>_source_media_id` before the revert (null = the primary logo). */
  sources?: { favicon_source_media_id: string | null; home_icon_source_media_id: string | null }
  /** A write the database refuses, once (a revert that fails partway). */
  refuseOnce?: (c: Call) => boolean
}) {
  /** The fonts and slots as the database holds them — written by the revert, read back by
   *  it (and by a second run). The slot FK's ON DELETE CASCADE is modelled: deleting a font
   *  takes every slot row naming it. */
  const db = {
    fonts: [...(o.fonts ?? [])],
    slots: (o.slots ?? []).map((s) => ({ created_at: BEFORE_PUBLISH, label: null, note: null, ...s })),
  }
  let refused = false
  const f = fakeClient((c: Call) => {
    if (c.op === 'rpc') return { data: o.log }
    if (!refused && o.refuseOnce?.(c)) {
      refused = true
      return { error: { message: 'refused' } }
    }
    if (c.op === 'select' && c.table === 'media') return { data: o.media ?? [], count: (o.media ?? []).length }
    if (c.op === 'select' && c.table === 'artist_fonts_with_slots') return { data: db.fonts, count: db.fonts.length }
    if (c.op === 'select' && c.table === 'artist_font_slots') return { data: db.slots.map((s) => ({ ...s })) }
    if (c.op === 'select' && c.table === 'artists')
      return { data: o.sources ?? { favicon_source_media_id: null, home_icon_source_media_id: null } }
    if (c.op === 'select' && c.table === 'revisions') {
      if (c.cols === 'published_at' && filterValue(c, 'entity_type') === 'artist_font' && filterValue(c, 'artist_id') === A)
        return { data: [{ published_at: PUBLISHED_AT }] }
      return { data: [], count: 0 }
    }
    if (c.op === 'delete' && c.table === 'artist_fonts') {
      const id = filterValue(c, 'id')
      db.fonts = db.fonts.filter((r) => r.id !== id)
      db.slots = db.slots.filter((s) => s.font_id !== id)
    }
    if (c.op === 'insert' && c.table === 'artist_fonts') db.fonts.push({ ...(c.payload as ContentRow), slots: [] })
    if (c.op === 'upsert' && c.table === 'artist_font_slots') {
      const p = c.payload as Slot
      const was = db.slots.find((s) => s.slot === p.slot)
      if (was) Object.assign(was, p)
      else db.slots.push({ created_at: new Date().toISOString(), label: null, note: null, ...p })
    }
    if (c.op === 'delete' && c.table === 'artist_font_slots') db.slots = db.slots.filter((s) => s.slot !== filterValue(c, 'slot'))
    return { data: [{}] }
  })
  return { ...f, db, run: () => restoreBrandToPublished(f.client, A) }
}

const on = (w: ReturnType<typeof world>, table: string, op: string) => w.calls.filter((c) => c.table === table && c.op === op)
const ids = (calls: Call[]) => calls.map((c) => filterValue(c, 'id') ?? (c.payload as { id?: string })?.id)

describe('the two guards restoreToPublished taught us', () => {
  it('CRITICAL: nothing ever published → nothing written', async () => {
    const w = world({ log: [], media: [media('l1', 'logo', { label: 'Tour' })], fonts: [font('f1', ['primary'])] })
    expect(await w.run()).toEqual({ changed: 0, hasPublished: false, skipped: [] })
    expect(w.writes().filter((c) => c.op !== 'rpc')).toEqual([])
  })

  it('CRITICAL: a type never published is SKIPPED, not wiped', async () => {
    // Fonts published once; media never. The added logo must survive, and the result says why.
    const f = font('f1', ['primary'])
    const w = world({ log: [pub('artist_font', f)], media: [media('l1', 'logo', { label: 'Tour' })], fonts: [f], slots: [{ slot: 'primary', font_id: 'f1' }] })
    const res = await w.run()
    expect(res.skipped).toEqual(['media'])
    expect(on(w, 'media', 'delete')).toEqual([])
  })

  it('CRITICAL: …and the other way round: fonts never published are SKIPPED, not wiped', async () => {
    // Media published once; fonts never. Without the guard the uploaded font and its slot
    // read as "added since the publish" and are deleted — a manager's whole font library
    // gone on a Revert. Only the media half was pinned until 2026-09-23.
    const logo = media('p1', 'logo_primary')
    const w = world({ log: [pub('media', logo)], media: [logo], fonts: [font('f1', ['primary'])], slots: [{ slot: 'primary', font_id: 'f1' }] })
    const res = await w.run()
    expect(res.skipped).toEqual(['artist_font'])
    expect(on(w, 'artist_fonts', 'delete')).toEqual([])
    expect(on(w, 'artist_font_slots', 'delete')).toEqual([])
  })
})

describe('media: the brand slice only', () => {
  it('CRITICAL: a gallery photo added since the publish is left alone', async () => {
    const photo = media('g0', 'gallery_image') // published, so media HAS a published state
    const w = world({ log: [pub('media', photo)], media: [photo, media('g1', 'gallery_image')] })
    await w.run()
    expect(on(w, 'media', 'delete')).toEqual([])
  })

  it('CRITICAL: a gallery photo deleted since the publish is NOT re-inserted', async () => {
    const w = world({ log: [pub('media', media('g1', 'gallery_image'))], media: [] })
    await w.run()
    expect(on(w, 'media', 'insert')).toEqual([])
  })

  it('CRITICAL: a replaced primary logo: the new row goes, the published one comes back, id and all', async () => {
    const was = media('p1', 'logo_primary')
    const now = media('p2', 'logo_primary')
    const w = world({ log: [pub('media', was)], media: [now] })
    const res = await w.run()
    expect(ids(on(w, 'media', 'delete'))).toEqual(['p2'])
    const [ins] = on(w, 'media', 'insert')
    expect(ins.payload).toMatchObject({ id: 'p1', artist_id: A, purpose: 'logo_primary', storage_path: `${A}/brand/p1.png` })
    expect(res.changed).toBe(2)
  })

  it('an added logo that was never published is removed, files and all', async () => {
    const photo = media('g0', 'gallery_image')
    const added = media('l1', 'logo', { label: 'Tour', source_path: `${A}/brand/orig.png` })
    const w = world({ log: [pub('media', photo)], media: [photo, added] })
    await w.run()
    expect(ids(on(w, 'media', 'delete'))).toEqual(['l1'])
    expect(w.removed.sort()).toEqual([`${A}/brand/l1.png`, `${A}/brand/orig.png`])
  })

  it('a tombstoned logo counts as not published (it goes)', async () => {
    const photo = media('g0', 'gallery_image')
    const w = world({ log: [pub('media', photo), tomb('media', 'l1')], media: [photo, media('l1', 'logo', { label: 'Tour' })] })
    await w.run()
    expect(ids(on(w, 'media', 'delete'))).toEqual(['l1'])
  })

  it('an edited logo gets only the changed columns back', async () => {
    const was = media('l1', 'logo', { label: 'Tour' })
    const w = world({ log: [pub('media', was)], media: [{ ...was, label: 'Renamed', note: 'draft note' }] })
    await w.run()
    const [up] = on(w, 'media', 'update')
    expect(up.payload).toEqual({ label: 'Tour' }) // the note is dashboard-only: not the log's to undo
  })

  it('CRITICAL: undoing a cut-out restores the published file and forgets the original', async () => {
    const was = media('p1', 'logo_primary')
    const cut = { ...was, storage_path: `${A}/brand/cut.png`, source_path: was.storage_path }
    const w = world({ log: [pub('media', was)], media: [cut] })
    await w.run()
    expect(on(w, 'media', 'update')[0].payload).toEqual({ storage_path: was.storage_path, source_path: null })
  })

  it('an older revision without `kind` reads as the default, so it is not a change', async () => {
    const was = media('p1', 'logo_primary')
    const old = pub('media', was)
    delete (old.data as Record<string, unknown>).kind
    const w = world({ log: [old], media: [was] })
    expect((await w.run()).changed).toBe(0)
  })
})

describe('fonts and their slots', () => {
  it('CRITICAL: fonts back, slots back — and removals before re-inserts (family is unique)', async () => {
    const kept = font('f1', ['primary'])
    const gone = font('f2', ['secondary'])
    const added = font('f3', ['custom_1'])
    const w = world({
      log: [pub('artist_font', kept), pub('artist_font', gone)],
      fonts: [kept, added],
      slots: [
        { slot: 'primary', font_id: 'f1' },
        { slot: 'custom_1', font_id: 'f3' },
        { slot: 'custom_2', font_id: 'f1' },
      ],
    })
    await w.run()
    const del = on(w, 'artist_fonts', 'delete')
    const ins = on(w, 'artist_fonts', 'insert')
    expect(ids(del)).toEqual(['f3'])
    expect(ins.map((c) => c.payload)).toEqual([
      { id: 'f2', artist_id: A, label: 'Font f2', family: 'family-f2', storage_path: `${A}/fonts/f2.woff2`, format: 'woff2' },
    ])
    expect(w.calls.indexOf(del[0])).toBeLessThan(w.calls.indexOf(ins[0]))

    // custom_2 was not published and its font stays → removed; custom_1 went with f3 (the
    // cascade); secondary names f2 again; primary unchanged → untouched.
    expect(on(w, 'artist_font_slots', 'delete').map((c) => filterValue(c, 'slot'))).toEqual(['custom_2'])
    expect(on(w, 'artist_font_slots', 'upsert').map((c) => c.payload)).toEqual([{ artist_id: A, slot: 'secondary', font_id: 'f2' }])
  })

  it('a surviving custom slot is upserted WITHOUT label/note, so its title and note survive', async () => {
    const f1 = font('f1', ['custom_2'])
    const f4 = font('f4', [])
    const w = world({ log: [pub('artist_font', f1), pub('artist_font', f4)], fonts: [f1, f4], slots: [{ slot: 'custom_2', font_id: 'f4' }] })
    await w.run()
    const [up] = on(w, 'artist_font_slots', 'upsert')
    expect(up.payload).toEqual({ artist_id: A, slot: 'custom_2', font_id: 'f1' })
  })
})

describe('a custom slot keeps its title and note through a revert', () => {
  it('CRITICAL: its font was uploaded since the publish — the slot goes back to the published font WITH its title and note', async () => {
    // custom_1 was published with f1. Since then f3 was uploaded into it; the title and note
    // were set on the SLOT row (dashboard-only, never in the log). Deleting f3 would cascade
    // the slot row away — the first code re-created it bare, title and note gone.
    const f1 = font('f1', ['custom_1'])
    const w = world({
      log: [pub('artist_font', f1)],
      fonts: [{ ...f1, slots: [] }, font('f3', ['custom_1'])],
      slots: [{ slot: 'custom_1', font_id: 'f3', label: 'Credits', note: 'back cover', created_at: BEFORE_PUBLISH }],
    })
    await w.run()
    expect(ids(on(w, 'artist_fonts', 'delete'))).toEqual(['f3'])
    expect(on(w, 'artist_font_slots', 'upsert').map((c) => c.payload)).toEqual([
      { artist_id: A, slot: 'custom_1', font_id: 'f1', label: 'Credits', note: 'back cover' },
    ])
    expect(w.db.slots).toEqual([expect.objectContaining({ slot: 'custom_1', font_id: 'f1', label: 'Credits', note: 'back cover' })])
    // The title and note were read before the first font delete, or the cascade had them.
    const read = w.calls.findIndex((c) => c.table === 'artist_font_slots' && c.op === 'select' && /label/.test(c.cols ?? ''))
    expect(read).toBeGreaterThanOrEqual(0)
    expect(read).toBeLessThan(w.calls.indexOf(on(w, 'artist_fonts', 'delete')[0]))
  })

  it('a slot with no title or note is written back without them (never a null that clears one)', async () => {
    const f1 = font('f1', ['primary'])
    const w = world({ log: [pub('artist_font', f1)], fonts: [{ ...f1, slots: [] }, font('f3', ['primary'])], slots: [{ slot: 'primary', font_id: 'f3' }] })
    await w.run()
    expect(on(w, 'artist_font_slots', 'upsert').map((c) => c.payload)).toEqual([{ artist_id: A, slot: 'primary', font_id: 'f1' }])
  })
})

/**
 * Icon sources are dashboard-only (never in the log), but an icon IMAGE (`icon_source`) is
 * brand media and IS reverted. Deleting one uploaded since the publish used to null its
 * icon's source through the FK — silently, and to the primary logo, while the PNG put back
 * was cut from something else. Now the revert settles each icon's source itself.
 *
 * The rule it leans on: `pruneIconSources` removes every icon image no icon uses, so each
 * icon image in the published log was, at publish time, the source of one of the icons.
 */
describe('icon sources follow the icons the revert puts back', () => {
  const sourceWrites = (w: ReturnType<typeof world>) => on(w, 'artists', 'update').map((c) => c.payload)

  it('CRITICAL: a new icon image goes, and the tab icon is pointed back at the PUBLISHED image its restored PNG was cut from', async () => {
    const png0 = media('fav0', 'favicon')
    const img0 = media('u0', 'icon_source', { on_site: false })
    const w = world({
      log: [pub('media', png0), pub('media', img0)],
      // Since the publish: a new image u1 (u0 pruned, its row gone) and a new PNG from it.
      media: [media('fav1', 'favicon'), media('u1', 'icon_source', { on_site: false })],
      sources: { favicon_source_media_id: 'u1', home_icon_source_media_id: null },
    })
    await w.run()
    expect(ids(on(w, 'media', 'delete')).sort()).toEqual(['fav1', 'u1'])
    expect(ids(on(w, 'media', 'insert')).sort()).toEqual(['fav0', 'u0'])
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: 'u0' }])
    // After the image it names is back.
    expect(w.calls.indexOf(on(w, 'artists', 'update')[0])).toBeGreaterThan(w.calls.indexOf(on(w, 'media', 'insert').at(-1)!))
  })

  it('CRITICAL: the published PNG was cut from the primary — the new image goes and the source goes back to the primary, written, not left to the FK', async () => {
    const png0 = media('fav0', 'favicon')
    const w = world({
      log: [pub('media', png0)],
      media: [media('fav1', 'favicon'), media('u1', 'icon_source', { on_site: false })],
      sources: { favicon_source_media_id: 'u1', home_icon_source_media_id: null },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: null }])
  })

  it('a source switched to a logo since the publish is pointed back at the published image the restored PNG came from', async () => {
    // u0 was the tab icon's image at publish; the manager then picked the Tour logo (u0 was
    // pruned) and the PNG regenerated. The PNG goes back to fav0 — cut from u0.
    const tour = media('l1', 'logo', { label: 'Tour' })
    const w = world({
      log: [pub('media', media('fav0', 'favicon')), pub('media', media('u0', 'icon_source', { on_site: false })), pub('media', tour)],
      media: [media('fav1', 'favicon'), tour],
      sources: { favicon_source_media_id: 'l1', home_icon_source_media_id: null },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: 'u0' }])
  })

  it('a tab icon taken away since the publish comes back pointed at the image it was cut from', async () => {
    // No PNG in the draft at all (it went with a logo the manager removed, say); the revert
    // re-inserts the published one and the published image beside it.
    const w = world({
      log: [pub('media', media('fav0', 'favicon')), pub('media', media('u0', 'icon_source', { on_site: false })), pub('media', media('l1', 'logo', { label: 'Tour' }))],
      media: [media('l1', 'logo', { label: 'Tour' })],
      sources: { favicon_source_media_id: 'l1', home_icon_source_media_id: null },
    })
    await w.run()
    expect(ids(on(w, 'media', 'insert')).sort()).toEqual(['fav0', 'u0'])
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: 'u0' }])
  })

  it('a PNG the revert left as it was is not "put back": a published image beside it is not matched to it', async () => {
    // The tab icon is exactly the published one (same row, same file); the home icon's
    // image was replaced by a logo pick that never regenerated. Nothing pairs the orphan
    // image with the tab icon, whose PNG did not move.
    const png = media('fav0', 'favicon')
    const w = world({
      log: [pub('media', png), pub('media', media('h0', 'icon_source', { on_site: false })), pub('media', media('p1', 'logo_primary'))],
      media: [png, media('p2', 'logo_primary')],
      sources: { favicon_source_media_id: null, home_icon_source_media_id: null },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([])
  })

  it('a PNG row that kept its id but not its file is put back too (and so is matched)', async () => {
    const pubPng = media('fav0', 'favicon')
    const w = world({
      log: [pub('media', pubPng), pub('media', media('u0', 'icon_source', { on_site: false }))],
      media: [{ ...pubPng, storage_path: `${A}/brand/regenerated.png` }],
      sources: { favicon_source_media_id: null, home_icon_source_media_id: null },
    })
    await w.run()
    expect(on(w, 'media', 'update').map((c) => c.payload)).toEqual([{ storage_path: pubPng.storage_path }])
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: 'u0' }])
  })

  it('an icon framed from a PUBLISHED image keeps it, even when its PNG is put back', async () => {
    // The tab icon was re-framed (new PNG) but its image u0 was on the site all along. The
    // unused published image h0 is the home icon's past, not a better answer for the tab.
    const img = media('u0', 'icon_source', { on_site: false })
    const home = media('home0', 'home_icon')
    const w = world({
      log: [pub('media', media('fav0', 'favicon')), pub('media', img), pub('media', home), pub('media', media('h0', 'icon_source'))],
      media: [media('fav1', 'favicon'), img, home],
      sources: { favicon_source_media_id: 'u0', home_icon_source_media_id: null },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([])
  })

  it('a published image one icon still uses is never handed to the other', async () => {
    const img = media('u0', 'icon_source', { on_site: false })
    const tab = media('fav0', 'favicon')
    const w = world({
      log: [pub('media', tab), pub('media', img), pub('media', media('home0', 'home_icon'))],
      media: [tab, img, media('home1', 'home_icon')],
      sources: { favicon_source_media_id: 'u0', home_icon_source_media_id: null },
    })
    await w.run()
    expect(ids(on(w, 'media', 'insert'))).toEqual(['home0']) // the witness: the home PNG was put back
    expect(sourceWrites(w)).toEqual([])
  })

  it('an icon the revert does not touch keeps its source — no write at all', async () => {
    const png = media('fav0', 'favicon')
    const img = media('u0', 'icon_source', { on_site: false })
    const w = world({
      log: [pub('media', png), pub('media', img), pub('media', media('p1', 'logo_primary'))],
      media: [png, img, media('p2', 'logo_primary')],
      sources: { favicon_source_media_id: 'u0', home_icon_source_media_id: null },
    })
    await w.run()
    expect(ids(on(w, 'media', 'delete'))).toEqual(['p2']) // the witness: the revert DID run
    expect(sourceWrites(w)).toEqual([])
  })

  it('two icons, two published images, both sources gone: which was whose cannot be known — both go back to the primary, nothing guessed', async () => {
    const w = world({
      log: ['fav0', 'home0'].map((id) => pub('media', media(id, id.startsWith('fav') ? 'favicon' : 'home_icon'))).concat(
        ['u0', 'h0'].map((id) => pub('media', media(id, 'icon_source', { on_site: false }))),
      ),
      media: [media('fav1', 'favicon'), media('home1', 'home_icon'), media('u1', 'icon_source'), media('h1', 'icon_source')],
      sources: { favicon_source_media_id: 'u1', home_icon_source_media_id: 'h1' },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: null }, { home_icon_source_media_id: null }])
  })

  it('the icon whose image went is matched before an icon whose PNG merely changed', async () => {
    // Both PNGs go back; only the home icon's image (h1) was new. The one published image
    // (h0) is the home icon's — the tab icon was re-framed, not re-sourced.
    const w = world({
      log: [pub('media', media('fav0', 'favicon')), pub('media', media('home0', 'home_icon')), pub('media', media('h0', 'icon_source'))],
      media: [media('fav1', 'favicon'), media('home1', 'home_icon'), media('h1', 'icon_source')],
      sources: { favicon_source_media_id: null, home_icon_source_media_id: 'h1' },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([{ home_icon_source_media_id: 'h0' }])
  })

  it('media never published: sources are not read or written', async () => {
    const f = font('f1', ['primary'])
    const w = world({ log: [pub('artist_font', f)], fonts: [f], media: [media('u1', 'icon_source')], sources: { favicon_source_media_id: 'u1', home_icon_source_media_id: null } })
    await w.run()
    expect(w.calls.filter((c) => c.table === 'artists')).toEqual([])
  })
})

/**
 * Gaps a 2026-09-23 mutation run found in the revert (each survived with its guard gone).
 */
describe('the revert, the paths nothing else reached', () => {
  const sourceWrites = (w: ReturnType<typeof world>) => on(w, 'artists', 'update').map((c) => c.payload)

  it('…and the mirror: an image the HOME icon still uses is never handed to the tab icon', async () => {
    const img = media('h0', 'icon_source', { on_site: false })
    const home = media('home0', 'home_icon')
    const w = world({
      log: [pub('media', home), pub('media', img), pub('media', media('fav0', 'favicon'))],
      media: [home, img, media('fav1', 'favicon')],
      sources: { favicon_source_media_id: null, home_icon_source_media_id: 'h0' },
    })
    await w.run()
    expect(ids(on(w, 'media', 'insert'))).toEqual(['fav0']) // the witness: the tab PNG was put back
    expect(sourceWrites(w)).toEqual([])
  })

  it('two icons lost their images, one published image left: whose it was cannot be known — both to the primary', async () => {
    const w = world({
      log: [pub('media', media('fav0', 'favicon')), pub('media', media('home0', 'home_icon')), pub('media', media('u0', 'icon_source'))],
      media: [media('fav1', 'favicon'), media('home1', 'home_icon'), media('u1', 'icon_source'), media('h1', 'icon_source')],
      sources: { favicon_source_media_id: 'u1', home_icon_source_media_id: 'h1' },
    })
    await w.run()
    expect(sourceWrites(w)).toEqual([{ favicon_source_media_id: null }, { home_icon_source_media_id: null }])
  })

  it('CRITICAL: a font edited since the publish gets its published columns back — only those', async () => {
    const was = font('f1', ['primary'])
    const w = world({ log: [pub('artist_font', was)], fonts: [{ ...was, label: 'Renamed' }], slots: [{ slot: 'primary', font_id: 'f1' }] })
    const res = await w.run()
    const [up] = on(w, 'artist_fonts', 'update')
    expect(up.payload).toEqual({ label: 'Font f1' })
    expect([filterValue(up, 'id'), filterValue(up, 'artist_id')]).toEqual(['f1', A])
    expect(res.changed).toBe(1)
  })

  it('CRITICAL: a font TOMBSTONED in the log is not "published" — it is not re-inserted', async () => {
    const kept = font('f1', ['primary'])
    const w = world({ log: [pub('artist_font', kept), tomb('artist_font', 'f9')], fonts: [kept], slots: [{ slot: 'primary', font_id: 'f1' }] })
    await w.run()
    expect(on(w, 'artist_fonts', 'insert')).toEqual([])
  })

  it('CRITICAL: the fonts half reads only FONT revisions — a logo in the log is never inserted as a font', async () => {
    const logo = media('p1', 'logo_primary')
    const f = font('f1', ['primary'])
    const w = world({ log: [pub('media', logo), pub('artist_font', f)], media: [logo], fonts: [f], slots: [{ slot: 'primary', font_id: 'f1' }] })
    expect((await w.run()).changed).toBe(0)
    expect(on(w, 'artist_fonts', 'insert')).toEqual([])
  })

  it('a slot is put back by (artist, slot) — the upsert\'s conflict target', async () => {
    const f = font('f2', ['secondary'])
    const w = world({ log: [pub('artist_font', f)], fonts: [f], slots: [] })
    await w.run()
    const [up] = on(w, 'artist_font_slots', 'upsert')
    expect(up.options).toEqual({ onConflict: 'artist_id,slot' })
  })

  it('CRITICAL: a write the database refused STOPS the revert and says so — never counted as done', async () => {
    const logo = media('p1', 'logo_primary')
    const f = fakeClient((c: Call) => {
      if (c.op === 'rpc') return { data: [pub('media', logo)] }
      if (c.op === 'select' && c.table === 'media') return { data: [media('p2', 'logo_primary')], count: 1 }
      if (c.op === 'select' && c.table === 'artists') return { data: { favicon_source_media_id: null, home_icon_source_media_id: null } }
      if (c.op === 'delete' && c.table === 'media') return { error: { message: 'permission denied for table media' } }
      return { data: [] }
    })
    await expect(restoreBrandToPublished(f.client, A)).rejects.toThrow('permission denied for table media')
    expect(f.calls.filter((c) => c.op === 'insert')).toEqual([])
  })

  it('a log that cannot be read is an error, not "nothing was ever published" — and it asks for THIS artist', async () => {
    const f = fakeClient((c: Call) => (c.op === 'rpc' ? { error: { message: 'timeout' } } : { data: [] }))
    await expect(restoreBrandToPublished(f.client, A)).rejects.toThrow('timeout')
    expect(f.calls[0].args).toEqual({ p_artist_id: A })
  })

  it('the icon sources are read before the revert touches anything; a failed read stops it', async () => {
    const logo = media('p1', 'logo_primary')
    const f = fakeClient((c: Call) => {
      if (c.op === 'rpc') return { data: [pub('media', logo)] }
      if (c.op === 'select' && c.table === 'media') return { data: [media('p2', 'logo_primary')], count: 1 }
      if (c.op === 'select' && c.table === 'artists') return { error: { message: 'sources unreadable' } }
      return { data: [] }
    })
    await expect(restoreBrandToPublished(f.client, A)).rejects.toThrow('sources unreadable')
    expect(f.writes().filter((c) => c.op !== 'rpc')).toEqual([])
  })
})

describe('the revert, scoped and counted', () => {
  it('CRITICAL: every row it deletes, updates or inserts is THIS artist\'s — each write names the artist', async () => {
    // One of everything: an added logo goes, an edited one is put back, a deleted one is
    // re-inserted; a font goes (its slot cascades with it), one is edited, one comes back
    // with its slot.
    const edited = media('l1', 'logo', { label: 'Tour' })
    const gone = media('l2', 'logo', { label: 'Gone' })
    const fKept = font('f1', ['primary'])
    const fGone = font('f2', ['secondary'])
    const w = world({
      log: [pub('media', edited), pub('media', gone), pub('artist_font', fKept), pub('artist_font', fGone)],
      media: [{ ...edited, label: 'Renamed' }, media('l3', 'logo', { label: 'New' })],
      fonts: [{ ...fKept, label: 'Renamed' }, font('f3', ['custom_1'])],
      slots: [{ slot: 'primary', font_id: 'f1' }, { slot: 'custom_1', font_id: 'f3' }],
    })
    const res = await w.run()
    const writes = w.writes().filter((c) => c.op !== 'rpc')
    expect(writes.length).toBe(7)
    for (const c of writes) {
      const scoped = c.op === 'insert' || c.op === 'upsert' ? (c.payload as { artist_id?: string }).artist_id : filterValue(c, 'artist_id')
      expect(scoped, `${c.op} ${c.table}`).toBe(A)
    }
    // …and each counted once: media 3, fonts 3, the slot put back 1.
    expect(res.changed).toBe(7)
    // The reads that decide it are this artist's too.
    const src = w.calls.find((c) => c.table === 'artists' && c.op === 'select')!
    expect([src.cols, filterValue(src, 'id')]).toEqual(['favicon_source_media_id, home_icon_source_media_id', A])
    const slotReads = w.calls.filter((c) => c.table === 'artist_font_slots' && c.op === 'select')
    expect(slotReads.map((c) => [c.cols, filterValue(c, 'artist_id')])).toEqual([
      ['slot, font_id, label, note, created_at', A],
      ['slot, font_id', A],
    ])
    const lastPublish = w.calls.find((c) => c.table === 'revisions' && c.cols === 'published_at')!
    expect([filterValue(lastPublish, 'artist_id'), filterValue(lastPublish, 'entity_type')]).toEqual([A, 'artist_font'])
  })

  it('a logo re-inserted from an OLD revision gets the defaults the log did not carry (kind: photo)', async () => {
    const was = media('p1', 'logo_primary')
    const old = pub('media', was)
    delete (old.data as Record<string, unknown>).kind
    const w = world({ log: [old], media: [] })
    await w.run()
    expect(on(w, 'media', 'insert')[0].payload).toMatchObject({ id: 'p1', kind: 'photo' })
  })

  it('a published font in no slot puts no slot back', async () => {
    const f = font('f1', [])
    const loose = { ...pub('artist_font', f) }
    ;(loose.data as Record<string, unknown>).slots = null
    const w = world({ log: [loose], fonts: [f], slots: [] })
    await w.run()
    expect(on(w, 'artist_font_slots', 'upsert')).toEqual([])
  })
})

/**
 * Review 2 (2026-09-24). A custom slot's title and note live on the SLOT ROW, never in the
 * log, so a revert decides who they belong to:
 *
 *  • LOW #3 — the row the manager holds now may not be the row the site had. Trash
 *    custom_1 (f1, published), add "Accent" (the next free slot is custom_1 again) with f2:
 *    Revert put f1 back into custom_1 titled "Accent". A slot row CREATED after the last
 *    font publish is a new row; the slot comes back without its words. The row the site
 *    had (created before) keeps its own — the "comes back WITH its title" pin above.
 *
 *  • LOW #4 — the words were held only in memory between reading them and writing them
 *    back, with the font deletes (which cascade the row away) in between. A failure there
 *    lost them for good, and "running it again finishes the job" was not true of them. Now
 *    the row is pointed at a font that survives BEFORE its font is deleted, so the database
 *    keeps the words, and a second run finds them.
 */
describe('slot words through a revert (review 2)', () => {
  it('CRITICAL: a NEW row that reused the freed custom_1 does not lend its title to the restored font', async () => {
    // Published: f1 in custom_1. Draft: that row trashed (slot row gone, f1 stays in the
    // library); a new row "Accent" added — nextFreeCustomSlot hands it custom_1 — with f2.
    const f1 = font('f1', ['custom_1'])
    const w = world({
      log: [pub('artist_font', f1)],
      fonts: [{ ...f1, slots: [] }, font('f2', ['custom_1'])],
      slots: [{ slot: 'custom_1', font_id: 'f2', label: 'Accent', note: 'for the merch', created_at: SINCE_PUBLISH }],
    })
    await w.run()
    const [up] = on(w, 'artist_font_slots', 'upsert')
    expect(up.payload, 'restored f1 carries the discarded row\'s words').toEqual({
      artist_id: A,
      slot: 'custom_1',
      font_id: 'f1',
      label: null,
      note: null,
    })
    expect(w.db.slots).toEqual([expect.objectContaining({ slot: 'custom_1', font_id: 'f1', label: null, note: null })])
  })

  it('a new row whose font SURVIVES the revert has its words cleared too — not left on the restored slot', async () => {
    // "Accent" reused custom_1 with f3, a font that was published elsewhere and stays.
    const f1 = font('f1', ['custom_1'])
    const f3 = font('f3', [])
    const w = world({
      log: [pub('artist_font', f1), pub('artist_font', f3)],
      fonts: [{ ...f1, slots: [] }, { ...f3, slots: ['custom_1'] }],
      slots: [{ slot: 'custom_1', font_id: 'f3', label: 'Accent', note: null, created_at: SINCE_PUBLISH }],
    })
    await w.run()
    expect(on(w, 'artist_font_slots', 'upsert').map((c) => c.payload)).toEqual([
      { artist_id: A, slot: 'custom_1', font_id: 'f1', label: null },
    ])
    expect(w.db.slots).toEqual([expect.objectContaining({ slot: 'custom_1', font_id: 'f1', label: null })])
  })

  it('CRITICAL: the words are written back BEFORE the font that would cascade them goes — a failure after loses nothing', async () => {
    // custom_1 (the published row, titled) now holds f3, uploaded since; f2 was published
    // and deleted since, and re-inserting it is refused. The old order (delete f3 → … →
    // insert f2 → slots) died at the insert with the words only in memory.
    const f1 = font('f1', ['custom_1'])
    const f2 = font('f2', ['secondary'])
    const w = world({
      log: [pub('artist_font', f1), pub('artist_font', f2)],
      fonts: [{ ...f1, slots: [] }, font('f3', ['custom_1'])],
      slots: [{ slot: 'custom_1', font_id: 'f3', label: 'Credits', note: 'back cover', created_at: BEFORE_PUBLISH }],
      refuseOnce: (c) => c.op === 'insert' && c.table === 'artist_fonts',
    })
    await expect(w.run()).rejects.toThrow('refused')
    expect(w.db.slots, 'the words did not survive the failed revert').toEqual([
      expect.objectContaining({ slot: 'custom_1', font_id: 'f1', label: 'Credits', note: 'back cover' }),
    ])
    const [up] = on(w, 'artist_font_slots', 'upsert')
    expect(w.calls.indexOf(up)).toBeLessThan(w.calls.indexOf(on(w, 'artist_fonts', 'delete')[0]))
    // …and running it again finishes the job.
    await w.run()
    expect(w.db.fonts.map((r) => r.id).sort()).toEqual(['f1', 'f2'])
    expect(w.db.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'custom_1', font_id: 'f1', label: 'Credits', note: 'back cover' }),
        expect.objectContaining({ slot: 'secondary', font_id: 'f2' }),
      ]),
    )
  })

  it('CRITICAL: …and when the published font itself must be re-inserted, the row is HELD on a surviving font meanwhile', async () => {
    // custom_1 (published with f2, titled) was moved to f3 (uploaded since), then f2 was
    // deleted from the library. The revert re-inserts f2 only after f3 goes, so custom_1
    // cannot be pointed at f2 first — it waits on f1 (a font the revert keeps), words and
    // all, and a failed insert leaves them in the database for the second run.
    const f1 = font('f1', ['primary'])
    const f2 = font('f2', ['custom_1'])
    const w = world({
      log: [pub('artist_font', f1), pub('artist_font', f2)],
      fonts: [f1, font('f3', ['custom_1'])],
      slots: [
        { slot: 'primary', font_id: 'f1' },
        { slot: 'custom_1', font_id: 'f3', label: 'Credits', note: 'back cover', created_at: BEFORE_PUBLISH },
      ],
      refuseOnce: (c) => c.op === 'insert' && c.table === 'artist_fonts',
    })
    await expect(w.run()).rejects.toThrow('refused')
    expect(w.db.slots.find((s) => s.slot === 'custom_1'), 'the cascade took the words').toMatchObject({ label: 'Credits', note: 'back cover' })
    await w.run()
    expect(w.db.slots.find((s) => s.slot === 'custom_1')).toMatchObject({ font_id: 'f2', label: 'Credits', note: 'back cover' })
    expect(w.db.slots.find((s) => s.slot === 'primary')).toMatchObject({ font_id: 'f1' })
  })

  it('a run that goes through counts the held slot ONCE (the hold is not a change of its own)', async () => {
    const f1 = font('f1', ['primary'])
    const f2 = font('f2', ['custom_1'])
    const w = world({
      log: [pub('artist_font', f1), pub('artist_font', f2)],
      fonts: [f1, font('f3', ['custom_1'])],
      slots: [
        { slot: 'primary', font_id: 'f1' },
        { slot: 'custom_1', font_id: 'f3', label: 'Credits', note: null, created_at: BEFORE_PUBLISH },
      ],
    })
    // f3 deleted, f2 inserted, custom_1 put back: 3.
    expect((await w.run()).changed).toBe(3)
    expect(w.db.slots.find((s) => s.slot === 'custom_1')).toMatchObject({ font_id: 'f2', label: 'Credits' })
  })
})
