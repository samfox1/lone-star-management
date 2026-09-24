// The Brand page's Publish bar lights up only for brand changes, and names what changed.
/**
 * `brandPending` — the brand-scoped "not on the site yet" (BRAND_PAGE_PLAN.md, Publish bar).
 *
 * The bar sits on the Brand page, so it must answer for the Brand page ONLY: a gallery
 * photo ticked on the Images page is a real unpublished change, and the Brand bar saying
 * so would send the manager hunting for a logo change that does not exist. Equally, the
 * Brand publish DOES publish logos and fonts, so every one of those must show.
 *
 * It is built on `diffEntities`, the comparison `diffUnpublished` uses, so the witness in
 * each "does not count" case below is the same change counted by that comparison without
 * the brand filter — proof the change is real and it is the filter that hides it.
 *
 * Fake client, no database: `latest_revisions` returns the planted published snapshots,
 * and the media / font reads return the planted working rows.
 */
import { describe, expect, it, vi } from 'vitest'
import { brandPending, brandPendingMessage, brandSubjects, restoreBrandToPublished } from '@/lib/brand'
import { diffEntities, publicSnapshot, type ContentRow } from '@/lib/content'
import { fakeClient, type Call } from '@tests/unit/manager-tools/brand/_fake-client'

/** loadBrandPending's request client (only the last describe reaches it). */
let serverClient: unknown = null
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => serverClient }))

const A = 'a1'

const media = (id: string, purpose: string, extra: Record<string, unknown> = {}): ContentRow => ({
  id,
  artist_id: A,
  purpose,
  storage_path: `${A}/brand/${id}.png`,
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

const font = (id: string, slots: string[]): ContentRow => ({
  id,
  artist_id: A,
  label: 'Mori',
  family: 'mori',
  storage_path: `${A}/fonts/${id}.woff2`,
  format: 'woff2',
  slots,
})

/** A published snapshot of a working row, exactly as publishContent would write it. */
const published = (type: 'media' | 'artist_font', row: ContentRow) => ({
  entity_type: type,
  entity_id: row.id,
  data: publicSnapshot(type, row),
})

function world(opts: {
  live: { media?: ContentRow[]; fonts?: ContentRow[] }
  log: { entity_type: string; entity_id: string; data: Record<string, unknown> }[]
  sources?: { favicon_source_media_id?: string | null; home_icon_source_media_id?: string | null }
}) {
  return fakeClient((c: Call) => {
    if (c.op === 'rpc' && c.table === 'latest_revisions') return { data: opts.log }
    if (c.table === 'media') return { data: opts.live.media ?? [], count: (opts.live.media ?? []).length }
    if (c.table === 'artist_fonts_with_slots') return { data: opts.live.fonts ?? [], count: (opts.live.fonts ?? []).length }
    if (c.table === 'artists') return { data: opts.sources ?? {} }
    // The slot table, derived from the live fonts' `slots` (the view is built from it), so
    // a revert run on the same world sees the same slots the bar did.
    if (c.table === 'artist_font_slots')
      return { data: (opts.live.fonts ?? []).flatMap((f) => ((f.slots as string[]) ?? []).map((slot) => ({ slot, font_id: f.id }))) }
    return { data: [] }
  })
}

const pending = (w: ReturnType<typeof world>) => brandPending(w.client, A)

describe('clean', () => {
  it('everything published as it is → no bar', async () => {
    const logo = media('p1', 'logo_primary')
    const f = font('f1', ['primary'])
    expect(await pending(world({ live: { media: [logo], fonts: [f] }, log: [published('media', logo), published('artist_font', f)] }))).toEqual({
      dirty: false,
      message: '',
      canRevert: false,
    })
  })

  it('CRITICAL: a gallery change does NOT light the Brand bar', async () => {
    const logo = media('p1', 'logo_primary')
    const photo = media('g1', 'gallery_image') // added on the Images page, never published
    const w = world({ live: { media: [logo, photo] }, log: [published('media', logo)] })
    expect((await pending(w)).dirty).toBe(false)
    // The witness: the same comparison, unfiltered, DOES see it.
    const latest = new Map([[`media:p1`, publicSnapshot('media', logo)]])
    expect(diffEntities('media', [logo, photo], latest)).toEqual([expect.objectContaining({ id: 'g1', change: 'added' })])
  })

  it('CRITICAL: a deleted gallery photo does not either (the filter reads the PUBLISHED purpose)', async () => {
    const photo = media('g1', 'gallery_image')
    const w = world({ live: { media: [] }, log: [published('media', photo)] })
    expect((await pending(w)).dirty).toBe(false)
  })

  it('dashboard-only columns are not "not on the site yet": a note, a cut-out original', async () => {
    const logo = media('l1', 'logo', { label: 'Tour' })
    const edited = { ...logo, note: 'for the merch table', source_path: `${A}/brand/orig.png` }
    expect((await pending(world({ live: { media: [edited] }, log: [published('media', logo)] }))).dirty).toBe(false)
  })
})

describe('what the bar says', () => {
  it('CRITICAL: replacing the primary logo (delete + insert) is ONE change', async () => {
    const before = media('p1', 'logo_primary')
    const after = media('p2', 'logo_primary')
    expect(await pending(world({ live: { media: [after] }, log: [published('media', before)] }))).toEqual({
      dirty: true,
      message: 'Primary logo changed',
      canRevert: true,
    })
  })

  it('a first secondary logo is "added"; removing it is "removed"', async () => {
    const s = media('s1', 'logo_secondary')
    expect((await pending(world({ live: { media: [s] }, log: [] }))).message).toBe('Secondary logo added')
    expect((await pending(world({ live: { media: [] }, log: [published('media', s)] }))).message).toBe('Secondary logo removed')
  })

  it('an added logo is named by its title', async () => {
    const l = media('l1', 'logo', { label: 'Tour mark' })
    expect((await pending(world({ live: { media: [l] }, log: [] }))).message).toBe('Tour mark added')
    const renamed = { ...l, label: 'Monogram' }
    expect((await pending(world({ live: { media: [renamed] }, log: [published('media', l)] }))).message).toBe('Monogram changed')
  })

  it('every brand purpose counts (derived from BRAND_MEDIA_PURPOSES, not a hand list)', async () => {
    const { BRAND_MEDIA_PURPOSES } = await import('@/lib/brand')
    for (const purpose of BRAND_MEDIA_PURPOSES) {
      const row = media(`x-${purpose}`, purpose, purpose === 'logo' ? { label: 'X' } : {})
      expect((await pending(world({ live: { media: [row] }, log: [] }))).dirty, purpose).toBe(true)
    }
  })

  it('a font slot change is "Fonts changed"', async () => {
    const f = font('f1', ['primary'])
    const moved = font('f1', ['primary', 'secondary'])
    expect((await pending(world({ live: { fonts: [moved] }, log: [published('artist_font', f)] }))).message).toBe('Fonts changed')
  })

  it('an uploaded icon image rides with the icon it feeds: one change, "Tab icon changed"', async () => {
    const icon = media('fav1', 'favicon')
    const regenerated = media('fav2', 'favicon')
    const source = media('src1', 'icon_source', { on_site: false })
    const w = world({
      live: { media: [regenerated, source] },
      log: [published('media', icon)],
      sources: { favicon_source_media_id: 'src1', home_icon_source_media_id: null },
    })
    expect((await pending(w)).message).toBe('Tab icon changed')
  })

  it('two different things → "2 changes"', async () => {
    const p = media('p1', 'logo_primary')
    const f = font('f1', ['primary'])
    expect((await pending(world({ live: { media: [p], fonts: [f] }, log: [] }))).message).toBe('2 changes')
  })
})

describe('brandPendingMessage (pure)', () => {
  it('no subjects → empty', () => {
    expect(brandPendingMessage([])).toBe('')
  })

  it('an icon image alone never claims the icon was "added"', () => {
    const [s] = brandSubjects([{ id: 'src1', change: 'added', snapshot: { purpose: 'icon_source' } }], [], {
      favicon: null,
      homeIcon: 'src1',
    })
    expect(brandPendingMessage([s])).toBe('Home-screen icon changed')
  })
})

describe('loadBrandPending (the layout’s wrapper)', () => {
  it('reads through the request client, and a failed read FAILS CLOSED — no bar, never a throw', async () => {
    const { loadBrandPending } = await import('@/lib/manager-tools/brand/brand-pending')
    // The witness: the same wrapper DOES light the bar when the reads succeed.
    serverClient = world({ live: { media: [media('s1', 'logo_secondary')] }, log: [] }).client
    expect(await loadBrandPending(A)).toEqual({ dirty: true, message: 'Secondary logo added', canRevert: false })
    // latest_revisions refused: brandPending throws, the layout gets a hidden bar.
    serverClient = fakeClient((c) => (c.op === 'rpc' ? { error: { message: 'permission denied' } } : { data: [] })).client
    expect(await loadBrandPending(A)).toEqual({ dirty: false, message: '', canRevert: false })
  })
})

/**
 * `canRevert`: the bar shows Revert only when Revert can DO something (fix round,
 * 2026-09-23). Revert skips a kind that was never published rather than wipe it, so a bar
 * whose only changes are never-published kinds offered a button that could only answer
 * "nothing to go back to". Each case is checked against `restoreBrandToPublished` itself on
 * the same world — the bar's answer and the revert's must be the same answer.
 */
describe('can Revert do anything?', () => {
  const revertChanges = async (w: ReturnType<typeof world>) => (await restoreBrandToPublished(w.client, A)).changed

  it('CRITICAL: never published at all → a change to show, but nothing to go back to', async () => {
    const w = world({ live: { media: [media('p1', 'logo_primary')] }, log: [] })
    expect(await pending(w)).toEqual({ dirty: true, message: 'Primary logo added', canRevert: false })
    expect(await revertChanges(w)).toBe(0)
  })

  it('CRITICAL: only a never-published KIND changed (fonts, with logos published) → no Revert', async () => {
    const logo = media('p1', 'logo_primary')
    const w = world({ live: { media: [logo], fonts: [font('f1', ['primary'])] }, log: [published('media', logo)] })
    expect(await pending(w)).toEqual({ dirty: true, message: 'Fonts added', canRevert: false })
    expect(await revertChanges(w)).toBe(0)
  })

  it('a change to a kind that HAS been published → Revert can put it back', async () => {
    const logo = media('p1', 'logo_primary')
    const w = world({ live: { media: [media('p2', 'logo_primary')] }, log: [published('media', logo)] })
    expect((await pending(w)).canRevert).toBe(true)
    expect(await revertChanges(w)).toBeGreaterThan(0)
  })

  it('fonts published, logos never: a font change is revertable, a new logo is not', async () => {
    const f = font('f1', ['primary'])
    const fontsOnly = world({ live: { fonts: [font('f1', ['secondary'])] }, log: [published('artist_font', f)] })
    expect((await pending(fontsOnly)).canRevert).toBe(true)
    expect(await revertChanges(fontsOnly)).toBeGreaterThan(0)
    const logoOnly = world({ live: { media: [media('p1', 'logo_primary')], fonts: [f] }, log: [published('artist_font', f)] })
    expect(await pending(logoOnly)).toMatchObject({ dirty: true, canRevert: false })
    expect(await revertChanges(logoOnly)).toBe(0)
  })

  it('a revertable change beside a never-published one → Revert shows', async () => {
    const logo = media('p1', 'logo_primary')
    const w = world({ live: { media: [media('p2', 'logo_primary')], fonts: [font('f1', ['primary'])] }, log: [published('media', logo)] })
    expect(await pending(w)).toEqual({ dirty: true, message: '2 changes', canRevert: true })
  })

  it('a gallery change on a published site is not the Brand bar\'s to revert', async () => {
    const logo = media('p1', 'logo_primary')
    const w = world({ live: { media: [logo, media('g1', 'gallery_image')] }, log: [published('media', logo)] })
    expect(await pending(w)).toEqual({ dirty: false, message: '', canRevert: false })
  })
})
