// The Brand page's schema on the live database: its rules hold, strangers are refused, and
//   nothing dashboard-only reaches the public site.
/**
 * 20260924120000_brand_page.sql against the hosted project, plus the lib functions over it.
 *
 * AWAITING PUSH: every test here needs that migration. Until it is pushed they fail on the
 * missing columns/table (42703 / 42P01), which is the right reason to be red.
 *
 * What only the real database can hold, and so is pinned here rather than in the fake-client
 * suites (tests/unit/brand/):
 *   • The CHECKs and the cap trigger — written as the SERVICE ROLE, so RLS is not what says
 *     no. Each refusal is matched on the CONSTRAINT NAME: a 23514 alone could be any check.
 *   • The cap under concurrency: the trigger takes a per-artist lock before counting, or two
 *     writers at 23 both see room.
 *   • RLS and grants on brand_colors. Every denial first plants the row it is denied
 *     (AGENTS.md rule 2) and asserts row STATE with the service client afterwards (rule 3).
 *   • The icon-source FK: another artist's media is unrepresentable, deleting the source
 *     falls back to the primary logo, and deleting the ARTIST still cascades.
 *   • The public payload: notes, originals, slot titles, weights, icon sources, framing and
 *     the browser-bar colour never reach get_public_site or a revision; a logo's title does.
 *   • Storage GC keeps a cut-out's original in the real bucket.
 *
 * Both tenants are throwaways (rule 6): created here, dropped here, so "empty" means empty
 * and nothing a human owns is in reach. B is a real signed-in manager of B's own artist, so
 * each denial is about A's ownership, not about B being a stranger to everything.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addIconSource,
  addLogo,
  brandPending,
  deleteLogo,
  loadBrandLogos,
  loadIconSettings,
  loadFraming,
  publishBrand,
  renameLogo,
  restoreBrandToPublished,
  saveFraming,
  setBrandAsset,
  setIconSource,
  setLogoFile,
  setLogoNote,
  setThemeColor,
} from '@/lib/brand'
import { addBrandColor, deleteBrandColor, listBrandColors, renameBrandColor, setBrandColorHex } from '@/lib/brand-colors'
import { clearCustomSlot, loadBrandFonts, setArtistFont, setFontSlot, setFontSlotMeta } from '@/lib/fonts'
import { publishContent, publishProfile } from '@/lib/content'
import { gcMediaObjects } from '@/lib/storage-gc'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'

const svc = serviceClient()
let asA: SupabaseClient
let asB: SupabaseClient
let tenantA: ThrowawayArtist
let tenantB: ThrowawayArtist
let A: string
let B: string

/** A path in exactly the shape the uploader writes, so the lib's path guard accepts it. */
const brandPath = (artist: string) => `${artist}/brand/${crypto.randomUUID()}.png`
const fontPath = (artist: string) => `${artist}/fonts/${crypto.randomUUID()}.woff2`

type PgErr = { code?: string; message?: string } | null
/** A CHECK (or the cap trigger) refused it — by NAME, not merely "some 23514". */
function expectCheck(error: PgErr, name: string) {
  expect(error, `expected ${name} to refuse, got no error`).not.toBeNull()
  expect(error?.code, `[${error?.code}] ${error?.message}`).toBe('23514')
  expect(error?.message ?? '').toContain(name)
}

async function plantMedia(artist: string, purpose: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('media')
    .insert({ artist_id: artist, purpose, storage_path: brandPath(artist), on_site: true, ...extra })
    .select('id')
    .single()
  if (error || !data) throw new Error(`plantMedia(${purpose}): ${error?.message}`)
  return data.id as string
}

async function colorRow(id: string) {
  const { data } = await svc.from('brand_colors').select('id, name, hex, note').eq('id', id).maybeSingle()
  return data as { id: string; name: string; hex: string; note: string | null } | null
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  tenantA = await createThrowawayArtist(svc, 'Brand page A', asA)
  tenantB = await createThrowawayArtist(svc, 'Brand page B', asB)
  A = tenantA.id
  B = tenantB.id
})

afterAll(async () => {
  // Cascades every media row, colour, font, slot and revision this file wrote.
  try {
    await deleteThrowawayArtist(svc, tenantA)
  } finally {
    await deleteThrowawayArtist(svc, tenantB)
  }
})

describe('the migration’s rules, written as the service role (RLS is not what refuses)', () => {
  it('CRITICAL: the three new media purposes are accepted', async () => {
    for (const purpose of ['home_icon', 'icon_source'])
      expect((await svc.from('media').insert({ artist_id: A, purpose, storage_path: brandPath(A) })).error, purpose).toBeNull()
    const { error } = await svc.from('media').insert({ artist_id: A, purpose: 'logo', label: 'Tour', storage_path: brandPath(A) })
    expect(error).toBeNull()
  })

  it('an unknown purpose is still refused (the check was widened, not dropped)', async () => {
    const { error } = await svc.from('media').insert({ artist_id: A, purpose: 'logo_tertiary', storage_path: brandPath(A) })
    expectCheck(error, 'media_purpose_check')
  })

  it('CRITICAL: an added logo must have a title — missing, blank, too long, or two lines', async () => {
    for (const label of [null, '   ', 'x'.repeat(41), 'Tour\nlogo']) {
      const { error } = await svc.from('media').insert({ artist_id: A, purpose: 'logo', label, storage_path: brandPath(A) })
      expectCheck(error, 'media_logo_title')
    }
    // Scoped to `logo`: a gallery photo still needs no label.
    expect((await svc.from('media').insert({ artist_id: A, purpose: 'gallery_image', storage_path: `${A}/gallery/${crypto.randomUUID()}.png` })).error).toBeNull()
  })

  it('a note is one line of at most 500 characters', async () => {
    const id = await plantMedia(A, 'logo', { label: 'Note test' })
    expectCheck((await svc.from('media').update({ note: 'a\nb' }).eq('id', id)).error, 'media_note_clean')
    expectCheck((await svc.from('media').update({ note: 'x'.repeat(501) }).eq('id', id)).error, 'media_note_clean')
    expect((await svc.from('media').update({ note: 'x'.repeat(500) }).eq('id', id)).error).toBeNull()
  })

  it('theme_color is lowercase #rrggbb or null', async () => {
    for (const bad of ['#ABCDEF', '#abc', 'red', '#aabbccdd'])
      expectCheck((await svc.from('artists').update({ theme_color: bad }).eq('id', A)).error, 'artists_theme_color_hex')
    expect((await svc.from('artists').update({ theme_color: '#1a2b3c' }).eq('id', A)).error).toBeNull()
    expect((await svc.from('artists').update({ theme_color: null }).eq('id', A)).error).toBeNull()
  })

  it('home-screen framing has the favicon’s bounds', async () => {
    expectCheck((await svc.from('artists').update({ home_icon_zoom: 7 }).eq('id', A)).error, 'artists_home_icon_zoom_range')
    expectCheck((await svc.from('artists').update({ home_icon_offset_y: 1.5 }).eq('id', A)).error, 'artists_home_icon_offset_range')
    expect((await svc.from('artists').update({ home_icon_zoom: 6, home_icon_offset_y: -1 }).eq('id', A)).error).toBeNull()
  })

  it('a font weight is 100–900', async () => {
    const row = { artist_id: A, label: 'W', family: `w-${Date.now()}`, storage_path: fontPath(A), format: 'woff2' }
    expectCheck((await svc.from('artist_fonts').insert({ ...row, weight: 950 })).error, 'artist_fonts_weight_range')
    expect((await svc.from('artist_fonts').insert({ ...row, weight: 700 })).error).toBeNull()
  })

  it('CRITICAL: only an added (custom) font slot takes a title or a note', async () => {
    const { data: f } = await svc
      .from('artist_fonts')
      .insert({ artist_id: A, label: 'Slot', family: `slot-${Date.now()}`, storage_path: fontPath(A), format: 'woff2' })
      .select('id')
      .single()
    const font_id = f!.id as string
    expectCheck(
      (await svc.from('artist_font_slots').upsert({ artist_id: A, slot: 'primary', font_id, label: 'Heads' })).error,
      'artist_font_slots_label_custom',
    )
    expectCheck(
      (await svc.from('artist_font_slots').upsert({ artist_id: A, slot: 'secondary', font_id, note: 'body' })).error,
      'artist_font_slots_note_custom',
    )
    expect(
      (await svc.from('artist_font_slots').upsert({ artist_id: A, slot: 'custom_3', font_id, label: 'Mono', note: 'credits' })).error,
    ).toBeNull()
  })

  it('brand_colors: the hex, the name and the note', async () => {
    for (const hex of ['#ABCDEF', '#abc', 'abcdef', '#aabbccdd'])
      expectCheck((await svc.from('brand_colors').insert({ artist_id: A, name: 'x', hex })).error, 'brand_colors_hex')
    for (const name of ['', '  ', 'x'.repeat(41), 'a\rb'])
      expectCheck((await svc.from('brand_colors').insert({ artist_id: A, name, hex: '#000000' })).error, 'brand_colors_name')
    expectCheck((await svc.from('brand_colors').insert({ artist_id: A, name: 'n', hex: '#000000', note: 'a\nb' })).error, 'brand_colors_note')
  })
})

describe('the 24-colour cap lives in the database', () => {
  it('CRITICAL: the 25th colour is refused, even from the service role', async () => {
    const t = await createThrowawayArtist(svc, 'Brand cap')
    try {
      const rows = Array.from({ length: 24 }, (_, i) => ({ artist_id: t.id, name: `Color ${i + 1}`, hex: '#000000', sort_order: i }))
      expect((await svc.from('brand_colors').insert(rows)).error).toBeNull()
      expectCheck((await svc.from('brand_colors').insert({ artist_id: t.id, name: 'Color 25', hex: '#000000' })).error, 'brand color cap reached')
      // A rename at the cap is not an insert: it must still work.
      const { data } = await svc.from('brand_colors').update({ name: 'Ink' }).eq('artist_id', t.id).eq('name', 'Color 1').select('id')
      expect(data).toHaveLength(1)
      const { count } = await svc.from('brand_colors').select('id', { count: 'exact', head: true }).eq('artist_id', t.id)
      expect(count).toBe(24)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: two adds at 23 — exactly one lands (the trigger locks before it counts)', async () => {
    const t = await createThrowawayArtist(svc, 'Brand cap race')
    try {
      for (let round = 0; round < 3; round++) {
        await svc.from('brand_colors').delete().eq('artist_id', t.id)
        const rows = Array.from({ length: 23 }, (_, i) => ({ artist_id: t.id, name: `C${i}`, hex: '#000000' }))
        expect((await svc.from('brand_colors').insert(rows)).error).toBeNull()
        const results = await Promise.all(
          ['x', 'y', 'z'].map((n) => serviceClient().from('brand_colors').insert({ artist_id: t.id, name: n, hex: '#111111' })),
        )
        const { count } = await svc.from('brand_colors').select('id', { count: 'exact', head: true }).eq('artist_id', t.id)
        expect(count, `round ${round}`).toBe(24)
        expect(results.filter((r) => r.error === null)).toHaveLength(1)
      }
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('brand_colors: strangers are refused (planted witness, row state checked)', () => {
  let witness: string
  beforeAll(async () => {
    const { data, error } = await svc.from('brand_colors').insert({ artist_id: A, name: 'Witness', hex: '#123456' }).select('id').single()
    if (error || !data) throw new Error(`plant witness: ${error?.message}`)
    witness = data.id as string
  })

  it('the witness exists (so every denial below is about access, not absence)', async () => {
    expect(await colorRow(witness)).toMatchObject({ name: 'Witness', hex: '#123456' })
  })

  it('CRITICAL: anon cannot read the table at all (grant revoked by ROLE)', async () => {
    const { error } = await anonClient().from('brand_colors').select('id').eq('id', witness)
    expectRlsDenied(error, 'anon select brand_colors')
    expect(error?.message ?? '').toContain('permission denied for table brand_colors')
  })

  it('CRITICAL: anon cannot insert', async () => {
    const { error } = await anonClient().from('brand_colors').insert({ artist_id: A, name: 'x', hex: '#000000' })
    expectRlsDenied(error, 'anon insert brand_colors')
  })

  it("CRITICAL: B cannot read A's colours", async () => {
    const { data, error } = await asB.from('brand_colors').select('id').eq('artist_id', A)
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await listBrandColors(asB, A)).toEqual([])
  })

  it("CRITICAL: B cannot add a colour to A's palette", async () => {
    const { error } = await asB.from('brand_colors').insert({ artist_id: A, name: 'Intruder', hex: '#000000' })
    expectRlsDenied(error, 'B insert into A')
    const res = await addBrandColor(asB, A, { name: 'Intruder', hex: '#000000' })
    expect(res.ok).toBe(false)
    const { data } = await svc.from('brand_colors').select('id').eq('artist_id', A).eq('name', 'Intruder')
    expect(data).toEqual([])
  })

  it("CRITICAL: B cannot rename, recolour or delete A's colour — and the lib says so", async () => {
    expect((await renameBrandColor(asB, A, witness, 'Hijacked')).ok).toBe(false)
    expect((await setBrandColorHex(asB, A, witness, '#ffffff')).ok).toBe(false)
    expect((await deleteBrandColor(asB, A, witness)).ok).toBe(false)
    expect(await colorRow(witness)).toMatchObject({ name: 'Witness', hex: '#123456' })
  })

  it('A can do all of it, in order', async () => {
    const c1 = await addBrandColor(asA, A, { name: 'Ink', hex: 'ABC' })
    const c2 = await addBrandColor(asA, A, { name: 'Paper', hex: '#fafafa' })
    expect(c1.ok && c2.ok).toBe(true)
    expect(c1.color?.hex).toBe('#aabbcc')
    const names = (await listBrandColors(asA, A)).map((c) => c.name)
    expect(names.indexOf('Ink')).toBeLessThan(names.indexOf('Paper'))
    expect((await renameBrandColor(asA, A, c1.color!.id, 'Night')).ok).toBe(true)
    expect((await deleteBrandColor(asA, A, c2.color!.id)).ok).toBe(true)
    expect(await colorRow(c2.color!.id)).toBeNull()
  })
})

describe('logos, icons and the browser bar: A can, B cannot', () => {
  it("CRITICAL: B cannot rename, annotate, re-file or delete A's added logo", async () => {
    const id = await plantMedia(A, 'logo', { label: 'Planted' })
    expect((await renameLogo(asB, A, id, 'Hijacked')).ok).toBe(false)
    expect((await setLogoNote(asB, A, id, 'hijacked')).ok).toBe(false)
    expect((await setLogoFile(asB, A, id, brandPath(A), { keepOriginal: true })).ok).toBe(false)
    expect((await deleteLogo(asB, A, id)).ok).toBe(false)
    const { data } = await svc.from('media').select('label, note, source_path').eq('id', id).single()
    expect(data).toEqual({ label: 'Planted', note: null, source_path: null })
  })

  it("CRITICAL: B cannot change A's icons or browser-bar colour", async () => {
    const logo = await plantMedia(A, 'logo', { label: 'Icon witness' })
    await svc.from('artists').update({ theme_color: '#010203', favicon_source_media_id: null }).eq('id', A)
    expect((await setThemeColor(asB, A, '#ffffff')).ok).toBe(false)
    expect((await setIconSource(asB, A, 'favicon', logo)).ok).toBe(false)
    const { data } = await svc.from('artists').select('theme_color, favicon_source_media_id').eq('id', A).single()
    expect(data).toEqual({ theme_color: '#010203', favicon_source_media_id: null })
  })

  it("CRITICAL: A's icon cannot name B's media — the lib refuses AND the FK refuses", async () => {
    const theirs = await plantMedia(B, 'logo', { label: 'Theirs' })
    const { data: exists } = await svc.from('media').select('id').eq('id', theirs)
    expect(exists).toHaveLength(1) // the witness
    expect((await setIconSource(asA, A, 'favicon', theirs)).ok).toBe(false)
    const { error } = await svc.from('artists').update({ favicon_source_media_id: theirs }).eq('id', A)
    expect(error?.code, error?.message).toBe('23503')
  })

  it('deleting an icon’s source falls back to the primary logo (null), leaving the artist intact', async () => {
    const src = await plantMedia(A, 'logo', { label: 'Doomed' })
    expect((await setIconSource(asA, A, 'home_icon', src)).ok).toBe(true)
    expect((await loadIconSettings(asA, A)).homeIcon.sourceMediaId).toBe(src)
    await svc.from('media').delete().eq('id', src)
    const s = await loadIconSettings(asA, A)
    expect(s.homeIcon.sourceMediaId).toBeNull()
  })

  it('CRITICAL: deleting an ARTIST whose icons name its own media still cascades', async () => {
    // The FK runs artists → media while media → artists cascades: a cycle. If it jammed,
    // every throwaway teardown in this suite (and the real "delete artist") would fail.
    const t = await createThrowawayArtist(svc, 'Brand cascade')
    let deleted = false
    try {
      const src = await plantMedia(t.id, 'logo_primary')
      const icon = await plantMedia(t.id, 'icon_source')
      await svc.from('artists').update({ favicon_source_media_id: src, home_icon_source_media_id: icon }).eq('id', t.id)
      const { data } = await svc.from('artists').select('favicon_source_media_id').eq('id', t.id).single()
      expect(data?.favicon_source_media_id).toBe(src)
      await deleteThrowawayArtist(svc, t) // throws on a refused delete
      deleted = true
      const { data: gone } = await svc.from('media').select('id').eq('artist_id', t.id)
      expect(gone).toEqual([])
    } finally {
      if (!deleted) await deleteThrowawayArtist(svc, t)
    }
  })

  it('an uploaded icon image becomes the source, and is removed once nothing uses it', async () => {
    const res = await addIconSource(asA, A, 'favicon', brandPath(A))
    expect(res.ok, res.error).toBe(true)
    expect((await loadIconSettings(asA, A)).favicon.sourceMediaId).toBe(res.mediaId)
    expect((await setIconSource(asA, A, 'favicon', null)).ok).toBe(true)
    const { data } = await svc.from('media').select('id').eq('id', res.mediaId!)
    expect(data).toEqual([])
  })

  it('home-screen framing round-trips on its own columns, apart from the tab icon’s', async () => {
    await saveFraming(asA, A, { zoom: 2, offsetY: 0.25 }, 'favicon')
    await saveFraming(asA, A, { zoom: 3, offsetY: -0.5 }, 'home_icon')
    expect(await loadFraming(asA, A, 'home_icon')).toEqual({ zoom: 3, offsetY: -0.5 })
    expect(await loadFraming(asA, A)).toEqual({ zoom: 2, offsetY: 0.25 })
  })

  it('an added logo: add, rename, note, cut-out keeps the original, delete', async () => {
    const add = await addLogo(asA, A, { title: 'Tour', note: 'merch table', storagePath: brandPath(A) })
    expect(add.ok, add.error).toBe(true)
    const id = add.logo!.id
    expect((await renameLogo(asA, A, id, 'Tour mark')).ok).toBe(true)
    const cut = brandPath(A)
    expect((await setLogoFile(asA, A, id, cut, { keepOriginal: true })).ok).toBe(true)
    const listed = (await loadBrandLogos(asA, A)).added.find((l) => l.id === id)!
    expect(listed).toMatchObject({ label: 'Tour mark', note: 'merch table', storagePath: cut, sourcePath: add.logo!.storagePath })
    const del = await deleteLogo(asA, A, id)
    expect(del).toMatchObject({ ok: true, storagePath: cut, sourcePath: add.logo!.storagePath })
  })

  it('the lib turns a refused title into a sentence', async () => {
    const res = await addLogo(asA, A, { title: '   ', storagePath: brandPath(A) })
    expect(res).toEqual({ ok: false, error: 'Give the logo a name, up to 40 characters.' })
  })
})

describe('fonts: weight, slot titles and notes', () => {
  it('a font keeps its weight; an added slot keeps its title and note; built-ins refuse them', async () => {
    const f = await setArtistFont(asA, A, { label: `Weighted ${Date.now()}`, storagePath: fontPath(A), format: 'woff2', weight: 700 })
    expect(f.ok, f.error).toBe(true)
    expect((await setFontSlot(asA, A, 'custom_1', f.font!.id, { label: 'Credits', note: 'liner notes' })).ok).toBe(true)
    expect((await setFontSlotMeta(asA, A, 'custom_1', { note: 'back cover' })).ok).toBe(true)
    const fonts = await loadBrandFonts(asA, A)
    const row = fonts.custom.find((s) => s.slot === 'custom_1')!
    expect(row).toMatchObject({ label: 'Credits', note: 'back cover' })
    expect(row.font?.weight).toBe(700)
    // Changing the font keeps the title: the upsert names only the columns it was given.
    expect((await setFontSlot(asA, A, 'custom_1', f.font!.id)).ok).toBe(true)
    expect((await loadBrandFonts(asA, A)).custom.find((s) => s.slot === 'custom_1')?.label).toBe('Credits')

    expect((await clearCustomSlot(asA, A, 'custom_1')).ok).toBe(true)
    expect((await loadBrandFonts(asA, A)).custom.find((s) => s.slot === 'custom_1')).toBeUndefined()
    expect((await clearCustomSlot(asA, A, 'custom_1')).ok).toBe(false) // zero rows is an error
  })

  it("CRITICAL: B cannot retitle or remove A's added font row", async () => {
    const f = await setArtistFont(asA, A, { label: `Guarded ${Date.now()}`, storagePath: fontPath(A), format: 'woff2' })
    await setFontSlot(asA, A, 'custom_2', f.font!.id, { label: 'Mine' })
    expect((await setFontSlotMeta(asB, A, 'custom_2', { label: 'Theirs' })).ok).toBe(false)
    expect((await clearCustomSlot(asB, A, 'custom_2')).ok).toBe(false)
    const { data } = await svc.from('artist_font_slots').select('label').eq('artist_id', A).eq('slot', 'custom_2').single()
    expect(data?.label).toBe('Mine')
  })
})

describe('CRITICAL: nothing dashboard-only reaches the public site', () => {
  it('notes, originals, slot titles, weights, icon sources, framing and theme stay home; a logo title goes', async () => {
    const t = await createThrowawayArtist(svc, 'Brand payload', asA)
    try {
      const primary = brandPath(t.id)
      await setBrandAsset(asA, t.id, 'logo_primary', primary)
      await setBrandAsset(asA, t.id, 'home_icon', brandPath(t.id))
      const added = await addLogo(asA, t.id, { title: 'Tour mark', note: 'SECRET-NOTE', storagePath: brandPath(t.id) })
      await setLogoFile(asA, t.id, added.logo!.id, brandPath(t.id), { keepOriginal: true })
      const icon = await addIconSource(asA, t.id, 'favicon', brandPath(t.id))
      expect(icon.ok, icon.error).toBe(true)
      await saveFraming(asA, t.id, { zoom: 2, offsetY: 0.1 }, 'home_icon')
      await setThemeColor(asA, t.id, '#0a0b0c')
      const f = await setArtistFont(asA, t.id, { label: 'Payload Face', storagePath: fontPath(t.id), format: 'woff2', weight: 700 })
      await setFontSlot(asA, t.id, 'custom_1', f.font!.id, { label: 'SECRET-SLOT', note: 'SECRET-SLOT-NOTE' })

      await publishContent(asA, 'media', t.id)
      await publishContent(asA, 'artist_font', t.id)
      await publishProfile(asA, t.id)

      const { data: site } = await anonClient().rpc('get_public_site', { p_slug: t.slug })
      expect(site, 'the door must answer, or every "absent" below is vacuous').not.toBeNull()
      const payload = site as { artist: Record<string, unknown>; media: Record<string, unknown>[]; fonts: Record<string, unknown>[]; font_slots: Record<string, string> }

      // The new purposes publish, and a logo's title rides with it.
      const purposes = payload.media.map((m) => m.purpose)
      for (const p of ['logo_primary', 'logo', 'home_icon', 'icon_source']) expect(purposes, p).toContain(p)
      expect(payload.media.find((m) => m.purpose === 'logo')?.label).toBe('Tour mark')
      expect(payload.font_slots.custom_1).toBeTruthy()

      const text = JSON.stringify(site)
      for (const leak of ['SECRET-NOTE', 'SECRET-SLOT', 'SECRET-SLOT-NOTE', '#0a0b0c'])
        expect(text, `${leak} reached the public payload`).not.toContain(leak)
      for (const key of ['note', 'source_path']) for (const m of payload.media) expect(Object.keys(m)).not.toContain(key)
      for (const f of payload.fonts) expect(Object.keys(f)).not.toContain('weight')
      for (const key of ['theme_color', 'favicon_source_media_id', 'home_icon_source_media_id', 'home_icon_zoom', 'home_icon_offset_y'])
        expect(Object.keys(payload.artist)).not.toContain(key)

      // …and not in the log either, where a later door change could pick them up.
      const { data: revs } = await svc.from('revisions').select('entity_type, data').eq('artist_id', t.id)
      const logged = JSON.stringify(revs)
      expect(revs?.length).toBeGreaterThan(0)
      for (const leak of ['SECRET-NOTE', 'SECRET-SLOT', '"source_path"', '"note"', '"weight"', 'theme_color', 'home_icon_zoom'])
        expect(logged, `${leak} was written to a revision`).not.toContain(leak)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('the brand-scoped bar and Revert, end to end', () => {
  it('CRITICAL: clean after publish; a gallery photo does not light it; a logo edit does; Revert undoes it', async () => {
    const t = await createThrowawayArtist(svc, 'Brand revert', asA)
    try {
      const primary = brandPath(t.id)
      await setBrandAsset(asA, t.id, 'logo_primary', primary)
      const tour = await addLogo(asA, t.id, { title: 'Tour', storagePath: brandPath(t.id) })
      await publishContent(asA, 'media', t.id)
      await publishProfile(asA, t.id)
      expect(await brandPending(asA, t.id)).toEqual({ dirty: false, message: '', canRevert: false })

      // A gallery photo is a real unpublished change — just not the Brand page's.
      const photo = await plantMedia(t.id, 'gallery_image', { storage_path: `${t.id}/gallery/${crypto.randomUUID()}.png` })
      expect((await brandPending(asA, t.id)).dirty).toBe(false)

      await renameLogo(asA, t.id, tour.logo!.id, 'Tour mark')
      expect(await brandPending(asA, t.id)).toEqual({ dirty: true, message: 'Tour mark changed', canRevert: true })
      await setBrandAsset(asA, t.id, 'logo_primary', brandPath(t.id))
      const extra = await addLogo(asA, t.id, { title: 'Extra', storagePath: brandPath(t.id) })
      expect((await brandPending(asA, t.id)).message).toBe('3 changes')

      const res = await restoreBrandToPublished(asA, t.id)
      expect(res.hasPublished).toBe(true)
      expect(await brandPending(asA, t.id)).toEqual({ dirty: false, message: '', canRevert: false })
      const logos = await loadBrandLogos(asA, t.id)
      expect(logos.primary?.storagePath).toBe(primary)
      expect(logos.added.map((l) => l.label)).toEqual(['Tour'])
      expect(logos.added.find((l) => l.id === extra.logo!.id)).toBeUndefined()
      // The gallery was never the Brand page's to revert.
      const { data: still } = await svc.from('media').select('id').eq('id', photo)
      expect(still).toHaveLength(1)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

/**
 * Fix round, 2026-09-23: what a Revert must NOT take with it. The fake-client suite
 * (tests/unit/brand/brand-revert.test.ts) simulates the slot cascade; only the real schema
 * proves it — the font FK's ON DELETE CASCADE and the icon-source FK's ON DELETE SET NULL
 * are what used to lose these.
 */
describe('Revert keeps what only the dashboard holds', () => {
  it('CRITICAL: a custom slot whose font was uploaded since the publish comes back WITH its title and note — and everything else dashboard-only is kept', async () => {
    const t = await createThrowawayArtist(svc, 'Brand revert keeps', asA)
    try {
      // On the site: a primary logo, an added logo, and font f1 in custom_1 ("Credits").
      await setBrandAsset(asA, t.id, 'logo_primary', brandPath(t.id))
      const tour = await addLogo(asA, t.id, { title: 'Tour', storagePath: brandPath(t.id) })
      const f1 = await setArtistFont(asA, t.id, { label: 'Keep Face', storagePath: fontPath(t.id), format: 'woff2', weight: 700 })
      expect((await setFontSlot(asA, t.id, 'custom_1', f1.font!.id, { label: 'Credits', note: 'back cover' })).ok).toBe(true)
      await publishContent(asA, 'media', t.id)
      await publishContent(asA, 'artist_font', t.id)
      await publishProfile(asA, t.id)

      // Dashboard-only edits since (never published, so never "not on the site yet") …
      await setLogoNote(asA, t.id, tour.logo!.id, 'merch table')
      const color = await addBrandColor(asA, t.id, { name: 'Ink', hex: '#111111' })
      await setThemeColor(asA, t.id, '#0a0b0c')
      await saveFraming(asA, t.id, { zoom: 2, offsetY: 0.25 }, 'favicon')
      // … and real changes: a new font INTO custom_1 (the slot keeps its title), a new logo.
      const f3 = await setArtistFont(asA, t.id, { label: 'New Face', storagePath: fontPath(t.id), format: 'woff2' })
      expect((await setFontSlot(asA, t.id, 'custom_1', f3.font!.id)).ok).toBe(true)
      const extra = await addLogo(asA, t.id, { title: 'Extra', note: 'draft only', storagePath: brandPath(t.id) })
      // The witnesses: the slot names f3 and still has its title; Revert has work to do.
      const before = (await loadBrandFonts(asA, t.id)).custom.find((s) => s.slot === 'custom_1')
      expect(before).toMatchObject({ label: 'Credits', note: 'back cover' })
      expect(before?.font?.id).toBe(f3.font!.id)
      expect((await brandPending(asA, t.id)).canRevert).toBe(true)

      const res = await restoreBrandToPublished(asA, t.id)
      expect(res.changed).toBeGreaterThan(0)
      expect(await brandPending(asA, t.id)).toEqual({ dirty: false, message: '', canRevert: false })

      // custom_1 is back on f1 WITH its title and note — pointed back at f1 before f3 went,
      // so deleting f3 had no slot row to cascade away (review 2).
      const slot = (await loadBrandFonts(asA, t.id)).custom.find((s) => s.slot === 'custom_1')
      expect(slot?.font?.id).toBe(f1.font!.id)
      expect(slot).toMatchObject({ label: 'Credits', note: 'back cover' })

      // KEPT: a surviving logo's note, a surviving font's weight, the palette, the
      // browser-bar colour and the icon framing — none of it is in the log, and Revert
      // does not touch what it cannot restore.
      const logos = await loadBrandLogos(asA, t.id)
      expect(logos.added.find((l) => l.id === tour.logo!.id)?.note).toBe('merch table')
      expect(slot?.font?.weight).toBe(700)
      expect((await listBrandColors(asA, t.id)).map((c) => c.id)).toContain(color.color!.id)
      const settings = await loadIconSettings(asA, t.id)
      expect(settings.themeColor).toBe('#0a0b0c')
      expect(settings.favicon.framing.zoom).toBeCloseTo(2)
      expect(settings.favicon.framing.offsetY).toBeCloseTo(0.25)
      // GOES: the logo added since the publish, note and all — it was never on the site,
      // and that is what Revert undoes (the confirm says it cannot be undone).
      expect(logos.added.find((l) => l.id === extra.logo!.id)).toBeUndefined()
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: a NEW row that reused a trashed slot does not lend its title to the font the revert puts back (review 2)', async () => {
    // The fake-client pin (brand-revert.test.ts) plants the timestamps; this proves the real
    // ones: a re-added slot row is born after the last font publish, the published one before.
    const t = await createThrowawayArtist(svc, 'Brand revert new row', asA)
    try {
      const f1 = await setArtistFont(asA, t.id, { label: 'Head Face', storagePath: fontPath(t.id), format: 'woff2' })
      expect((await setFontSlot(asA, t.id, 'custom_1', f1.font!.id, { label: 'Headline', note: null })).ok).toBe(true)
      await publishContent(asA, 'artist_font', t.id)

      // Trash the row (f1 stays in the library), then a new row "Accent" lands on custom_1 again.
      expect((await clearCustomSlot(asA, t.id, 'custom_1')).ok).toBe(true)
      const f2 = await setArtistFont(asA, t.id, { label: 'Accent Face', storagePath: fontPath(t.id), format: 'woff2' })
      expect((await setFontSlot(asA, t.id, 'custom_1', f2.font!.id, { label: 'Accent', note: 'for the merch' })).ok).toBe(true)
      const before = (await loadBrandFonts(asA, t.id)).custom.find((s) => s.slot === 'custom_1')
      expect(before).toMatchObject({ label: 'Accent', note: 'for the merch' }) // the witness

      await restoreBrandToPublished(asA, t.id)

      const slot = (await loadBrandFonts(asA, t.id)).custom.find((s) => s.slot === 'custom_1')
      expect(slot?.font?.id).toBe(f1.font!.id)
      expect(slot, 'the discarded row\'s words rode along').toMatchObject({ label: null, note: null })
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: an icon image uploaded since the publish goes, and the tab icon points again at the image its restored PNG was cut from', async () => {
    const t = await createThrowawayArtist(svc, 'Brand revert icons', asA)
    try {
      await setBrandAsset(asA, t.id, 'logo_primary', brandPath(t.id))
      const u0 = await addIconSource(asA, t.id, 'favicon', brandPath(t.id))
      expect(u0.ok, u0.error).toBe(true)
      const png0 = brandPath(t.id)
      await setBrandAsset(asA, t.id, 'favicon', png0)
      await publishContent(asA, 'media', t.id)
      await publishProfile(asA, t.id)

      // Since: a new image for the tab icon (u0 is pruned — no icon uses it) and its PNG.
      const u1 = await addIconSource(asA, t.id, 'favicon', brandPath(t.id))
      expect(u1.ok, u1.error).toBe(true)
      await setBrandAsset(asA, t.id, 'favicon', brandPath(t.id))
      const { data: pruned } = await svc.from('media').select('id').eq('id', u0.mediaId!)
      expect(pruned, 'the published image really left the draft').toHaveLength(0)
      expect((await loadIconSettings(asA, t.id)).favicon.sourceMediaId).toBe(u1.mediaId)

      await restoreBrandToPublished(asA, t.id)

      const { data: png } = await svc.from('media').select('storage_path').eq('artist_id', t.id).eq('purpose', 'favicon')
      expect((png ?? []).map((r) => r.storage_path)).toEqual([png0])
      const { data: u1Row } = await svc.from('media').select('id').eq('id', u1.mediaId!)
      expect(u1Row).toHaveLength(0)
      // The FK alone left this null — the primary logo — while the PNG was cut from u0.
      expect((await loadIconSettings(asA, t.id)).favicon.sourceMediaId).toBe(u0.mediaId)
      expect((await brandPending(asA, t.id)).dirty).toBe(false)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('the Brand publish is brand-scoped on the real log', () => {
  it('CRITICAL: a logo draft goes live; a gallery draft and a deleted gallery photo stay as they are', async () => {
    const t = await createThrowawayArtist(svc, 'Brand publish slice', asA)
    try {
      const live = await plantMedia(t.id, 'gallery_image', { storage_path: `${t.id}/gallery/${crypto.randomUUID()}.png` })
      await publishContent(asA, 'media', t.id)
      await publishProfile(asA, t.id)
      await svc.from('media').delete().eq('id', live) // deleted in draft: still live until the GALLERY publishes
      const draft = await plantMedia(t.id, 'gallery_image', { storage_path: `${t.id}/gallery/${crypto.randomUUID()}.png` })
      const logo = await addLogo(asA, t.id, { title: 'Sliced', storagePath: brandPath(t.id) })

      await publishBrand(asA, t.id)

      const { data: site } = await anonClient().rpc('get_public_site', { p_slug: t.slug })
      const ids = ((site as { media?: { id: string }[] } | null)?.media ?? []).map((m) => m.id)
      expect(ids).toContain(logo.logo!.id)
      expect(ids).toContain(live) // no tombstone was written for it
      expect(ids).not.toContain(draft)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('storage GC keeps a cut-out’s original in the real bucket', () => {
  it('CRITICAL: the original survives a sweep; a stray beside it does not', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const t = await createThrowawayArtist(svc, 'Brand gc')
    const cut = brandPath(t.id)
    const original = brandPath(t.id)
    const stray = brandPath(t.id)
    try {
      for (const p of [cut, original, stray]) {
        const up = await svc.storage.from('media').upload(p, png, { contentType: 'image/png' })
        expect(up.error, p).toBeNull()
      }
      await svc.from('media').insert({ artist_id: t.id, purpose: 'logo', label: 'Cut', storage_path: cut, source_path: original })
      await gcMediaObjects(svc, t.id, 0) // no age gate: everything just uploaded is eligible
      const { data: left } = await svc.storage.from('media').list(`${t.id}/brand`)
      const names = (left ?? []).map((o) => `${t.id}/brand/${o.name}`).sort()
      expect(names).toEqual([cut, original].sort())
    } finally {
      await svc.storage.from('media').remove([cut, original, stray]) // objects do not cascade
      await deleteThrowawayArtist(svc, t)
    }
  })
})
