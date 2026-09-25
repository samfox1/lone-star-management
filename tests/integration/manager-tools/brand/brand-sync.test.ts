// Brand ⇄ sites: colours keep a stable key, Google fonts are file-less rows, and the site
//   gets both from the PUBLISHED snapshot, the preview mirroring it exactly.
/**
 * 20260925120000_brand_sync.sql against the hosted project, plus the libs over it
 * (BRAND_SYNC_PLAN.md, the contract).
 *
 * AWAITING PUSH: every test here needs that migration. Until it is pushed they fail on the
 * missing column/function/entity type (42703 / PGRST202 / 23514 on revisions), the right
 * reason.
 *
 * What only the real database can hold:
 *   • the key TRIGGER: slot rows keyed by slot, added ones by a slug of the name, deduped
 *     per artist (under concurrency too), never a built-in's key, and IMMUTABLE;
 *   • the key and Google-font CHECKs, by CONSTRAINT NAME (a bare 23514 could be any check);
 *   • the slug helper's grants (not callable by anon or a manager: 42501 AND its name);
 *   • the door: `brand` from the PUBLISHED snapshot only, in palette order; a Google font's
 *     wire shape; a cleared browser bar is a tombstone; and the preview payload equal to it;
 *   • the door's OWN filters (key, hex, Google family, bar colour), on revisions planted
 *     straight into the log, since the table CHECKs stop the app from ever reaching them;
 *   • the Brand publish and Revert moving colours and the browser bar on the real log.
 *
 * Throwaway artists only (rule 6): made here, dropped here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { brandPending, publishBrand, restoreBrandToPublished, setThemeColor } from '@/lib/brand'
import { addBrandColor, deleteBrandColor, renameBrandColor, setBrandColorHex, setSlotColor } from '@/lib/manager-tools/brand/brand-colors'
import { addGoogleFont, setArtistFont, setFontSlot } from '@/lib/fonts'
import { publishProfile } from '@/lib/content'
import { getWorkingSitePayload } from '@/lib/site'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied } from '@tests/helpers/rls'

const svc = serviceClient()
let asA: SupabaseClient
let asB: SupabaseClient
let tenantA: ThrowawayArtist
let tenantB: ThrowawayArtist
let A: string
let B: string

type PgErr = { code?: string; message?: string } | null
/** A CHECK (or a trigger raising check_violation) refused it — by NAME. */
function expectCheck(error: PgErr, name: string) {
  expect(error, `expected ${name} to refuse, got no error`).not.toBeNull()
  expect(error?.code, `[${error?.code}] ${error?.message}`).toBe('23514')
  expect(error?.message ?? '').toContain(name)
}
function expectUnique(error: PgErr, name: string) {
  expect(error, `expected ${name} to refuse, got no error`).not.toBeNull()
  expect(error?.code, `[${error?.code}] ${error?.message}`).toBe('23505')
  expect(error?.message ?? '').toContain(name)
}

const fontPath = (artist: string) => `${artist}/fonts/${crypto.randomUUID()}.woff2`

/** name → key for this artist's ADDED colours (slot null), and slot → key for the built-ins. */
async function keysOf(artist: string): Promise<{ added: Record<string, string>; slots: Record<string, string> }> {
  const { data, error } = await svc.from('brand_colors').select('name, key, slot').eq('artist_id', artist)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { name: string; key: string; slot: string | null }[]
  return {
    added: Object.fromEntries(rows.filter((r) => !r.slot).map((r) => [r.name, r.key])),
    slots: Object.fromEntries(rows.filter((r) => r.slot).map((r) => [r.slot!, r.key])),
  }
}

type Door = {
  brand?: { colors: { key: string; name: string; hex: string }[]; theme_color: string | null }
  fonts?: Record<string, unknown>[]
  font_slots?: Record<string, string>
}
async function door(slug: string): Promise<Door> {
  const { data, error } = await anonClient().rpc('get_public_site', { p_slug: slug })
  if (error) throw new Error(error.message)
  expect(data, 'the door must answer (a profile is published), or every assertion below is vacuous').not.toBeNull()
  return data as Door
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  tenantA = await createThrowawayArtist(svc, 'Brand sync A', asA)
  tenantB = await createThrowawayArtist(svc, 'Brand sync B', asB)
  A = tenantA.id
  B = tenantB.id
})

afterAll(async () => {
  try {
    await deleteThrowawayArtist(svc, tenantA)
  } finally {
    await deleteThrowawayArtist(svc, tenantB)
  }
})

describe('brand_colors.key — assigned by the database', () => {
  it('CRITICAL: built-ins are keyed by slot; added colours by a slug of the name, deduped, never a built-in\'s key', async () => {
    const t = await createThrowawayArtist(svc, 'Brand keys', asA)
    try {
      expect((await setSlotColor(asA, t.id, 'primary', '#c63a2a')).ok).toBe(true)
      for (const [name, hex] of [
        ['Crème Brûlée', '#f4f1ea'],
        ['Cream', '#f4f1ea'],
        ['cream', '#eeeeee'], // same slug as "Cream"
        ['Primary', '#000000'], // an ADDED colour named like the built-in
        ['🔥', '#ff0000'],
      ] as const)
        expect((await addBrandColor(asA, t.id, { name, hex })).ok, name).toBe(true)
      expect(await keysOf(t.id)).toEqual({
        slots: { primary: 'primary' },
        added: {
          'Crème Brûlée': 'creme-brulee',
          Cream: 'cream',
          cream: 'cream-2',
          Primary: 'primary-2', // never the built-in's key, even before Secondary exists
          '🔥': 'color',
        },
      })
      // …and Secondary, picked AFTER an added colour could have taken its key, still gets it.
      expect((await setSlotColor(asA, t.id, 'secondary', '#8dbfd5')).ok).toBe(true)
      expect((await keysOf(t.id)).slots).toEqual({ primary: 'primary', secondary: 'secondary' })
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: the key never changes — a rename keeps it, and a direct write is refused even by the service role', async () => {
    const res = await addBrandColor(asA, A, { name: 'Charcoal', hex: '#17191c' })
    expect(res.ok, res.error).toBe(true)
    const id = res.color!.id
    expect((await renameBrandColor(asA, A, id, 'Graphite')).ok).toBe(true)
    const { data: after } = await svc.from('brand_colors').select('name, key').eq('id', id).single()
    expect(after).toEqual({ name: 'Graphite', key: 'charcoal' })
    const { error } = await svc.from('brand_colors').update({ key: 'graphite' }).eq('id', id)
    expectCheck(error, 'key cannot change')
    const { data: still } = await svc.from('brand_colors').select('key').eq('id', id).single()
    expect(still?.key).toBe('charcoal') // rule 3: the row's STATE, not the return value
    await deleteBrandColor(asA, A, id)
  })

  it('a supplied key must be CSS-safe and not a built-in\'s; a duplicate is refused by name', async () => {
    expectCheck((await svc.from('brand_colors').insert({ artist_id: A, name: 'Bad', hex: '#000000', key: 'Bad Key' })).error, 'brand_colors_key_format')
    expectCheck((await svc.from('brand_colors').insert({ artist_id: A, name: 'Sneaky', hex: '#000000', key: 'primary' })).error, 'brand_colors_key_slot')
    const first = await svc.from('brand_colors').insert({ artist_id: A, name: 'Ink', hex: '#111111', key: 'ink-x' }).select('id').single()
    expect(first.error).toBeNull()
    try {
      expectUnique((await svc.from('brand_colors').insert({ artist_id: A, name: 'Ink 2', hex: '#111111', key: 'ink-x' })).error, 'brand_colors_key_unique')
    } finally {
      await svc.from('brand_colors').delete().eq('id', first.data!.id)
    }
  })

  it('two managers adding "Cream" at the same moment get two keys, not a collision', async () => {
    const t = await createThrowawayArtist(svc, 'Brand keys race', asA)
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => addBrandColor(asA, t.id, { name: 'Cream', hex: '#f4f1ea' })))
      for (const r of results) expect(r.ok, r.error).toBe(true)
      const { data } = await svc.from('brand_colors').select('key').eq('artist_id', t.id)
      expect(((data ?? []) as { key: string }[]).map((r) => r.key).sort()).toEqual(['cream', 'cream-2', 'cream-3', 'cream-4'])
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('artist_fonts: Google rows', () => {
  it('CRITICAL: a Google row has a name and NO file; an upload has a file and no name — both ways, by constraint name', async () => {
    expectCheck(
      (await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-1', source: 'google', google_family: 'Inter', storage_path: fontPath(A), format: 'woff2' })).error,
      'artist_fonts_source_shape',
    )
    expectCheck((await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-2', source: 'google' })).error, 'artist_fonts_source_shape')
    expectCheck((await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-3' })).error, 'artist_fonts_source_shape')
    expectCheck(
      (await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-4', storage_path: fontPath(A), format: 'woff2', google_family: 'Inter' })).error,
      'artist_fonts_source_shape',
    )
    expectCheck((await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-5', source: 'cdn' })).error, 'artist_fonts_source_known')
    expectCheck(
      (await svc.from('artist_fonts').insert({ artist_id: A, label: 'X', family: 'x-6', source: 'google', google_family: "Evil'); }" })).error,
      'artist_fonts_google_family_clean',
    )
  })

  it('CRITICAL: one row per Google family per artist — the lib reuses it, the index refuses a second', async () => {
    const t = await createThrowawayArtist(svc, 'Brand google once', asA)
    try {
      const one = await addGoogleFont(asA, t.id, 'archivo')
      expect(one.ok, one.error).toBe(true)
      const { data: row } = await svc.from('artist_fonts').select('label, family, source, google_family, storage_path, format').eq('id', one.font!.id).single()
      expect(row).toEqual({ label: 'Archivo', family: 'archivo', source: 'google', google_family: 'Archivo', storage_path: null, format: null })
      const two = await addGoogleFont(asA, t.id, 'Archivo')
      expect(two).toMatchObject({ ok: true, reused: true, font: { id: one.font!.id } })
      expectUnique(
        (await svc.from('artist_fonts').insert({ artist_id: t.id, label: 'Archivo', family: 'archivo-2', source: 'google', google_family: 'Archivo' })).error,
        'artist_fonts_google_once',
      )
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('a stranger cannot add a Google font to another artist (RLS), and nothing lands', async () => {
    const res = await addGoogleFont(asB, A, 'Inter')
    expect(res.ok).toBe(false)
    const { data } = await svc.from('artist_fonts').select('id').eq('artist_id', A).eq('google_family', 'Inter')
    expect(data).toEqual([])
  })
})

describe('the slug helper is not a door', () => {
  it('anon cannot execute brand_color_slug', async () => {
    const { error } = await anonClient().rpc('brand_color_slug', { p_name: 'Cream' })
    expectExecuteDenied(error, 'brand_color_slug')
  })

  it('…nor can a signed-in manager (only the trigger and the migration call it)', async () => {
    const { error } = await asA.rpc('brand_color_slug', { p_name: 'Cream' })
    expectExecuteDenied(error, 'brand_color_slug')
  })
})

describe('the door: the PUBLISHED brand, and the preview equal to it', () => {
  it('CRITICAL: nothing published → brand is present and empty; a draft never shows', async () => {
    const t = await createThrowawayArtist(svc, 'Brand door empty', asA)
    try {
      await publishProfile(asA, t.id)
      await setSlotColor(asA, t.id, 'primary', '#c63a2a')
      await setThemeColor(asA, t.id, '#0a0a0a')
      expect((await door(t.slug)).brand).toEqual({ colors: [], theme_color: null })
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: Skeen\'s palette, published: palette order, stable keys, the bar colour — and the preview says the same', async () => {
    const t = await createThrowawayArtist(svc, 'Brand door', asA)
    try {
      // Added colours first on purpose: the door must still lead with Primary, Secondary.
      await addBrandColor(asA, t.id, { name: 'Cream', hex: '#f4f1ea', note: 'SECRET-NOTE' })
      await addBrandColor(asA, t.id, { name: 'Black', hex: '#0a0a0a' })
      await addBrandColor(asA, t.id, { name: 'Charcoal', hex: '#17191c' })
      await setSlotColor(asA, t.id, 'secondary', '#8dbfd5')
      await setSlotColor(asA, t.id, 'primary', '#c63a2a')
      await setThemeColor(asA, t.id, '#0a0a0a')
      await publishProfile(asA, t.id)
      await publishBrand(asA, t.id)

      const expected = {
        colors: [
          { key: 'primary', name: 'Primary', hex: '#c63a2a' },
          { key: 'secondary', name: 'Secondary', hex: '#8dbfd5' },
          { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
          { key: 'black', name: 'Black', hex: '#0a0a0a' },
          { key: 'charcoal', name: 'Charcoal', hex: '#17191c' },
        ],
        theme_color: '#0a0a0a',
      }
      const live = await door(t.slug)
      expect(live.brand).toEqual(expected)
      expect((await getWorkingSitePayload(asA, t.id))?.brand).toEqual(expected)
      expect(JSON.stringify(live)).not.toContain('SECRET-NOTE')
      const { data: revs } = await svc.from('revisions').select('data').eq('artist_id', t.id).eq('entity_type', 'brand_color')
      expect(revs?.length).toBe(5)
      expect(JSON.stringify(revs)).not.toContain('SECRET-NOTE')

      // A draft change: the preview moves, the door does not — until the Brand bar publishes.
      const cream = (await svc.from('brand_colors').select('id').eq('artist_id', t.id).eq('key', 'cream').single()).data!.id as string
      await setBrandColorHex(asA, t.id, cream, '#ffffff')
      await renameBrandColor(asA, t.id, cream, 'Off-white')
      expect((await door(t.slug)).brand?.colors[2]).toEqual({ key: 'cream', name: 'Cream', hex: '#f4f1ea' })
      expect((await getWorkingSitePayload(asA, t.id))?.brand?.colors[2]).toEqual({ key: 'cream', name: 'Off-white', hex: '#ffffff' })
      expect(await brandPending(asA, t.id)).toEqual({ dirty: true, message: 'Off-white changed', canRevert: true })
      await publishBrand(asA, t.id)
      expect((await door(t.slug)).brand?.colors[2]).toEqual({ key: 'cream', name: 'Off-white', hex: '#ffffff' })

      // Cleared and published: a tombstone, so the site has no bar colour again.
      await setThemeColor(asA, t.id, null)
      expect((await brandPending(asA, t.id)).message).toBe('Browser bar removed')
      await publishBrand(asA, t.id)
      expect((await door(t.slug)).brand?.theme_color).toBeNull()
      expect((await getWorkingSitePayload(asA, t.id))?.brand?.theme_color).toBeNull()
      expect(await brandPending(asA, t.id)).toEqual({ dirty: false, message: '', canRevert: false })
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })

  it('CRITICAL: a Google font reaches the door by name with no file, an upload keeps its shape plus source — preview identical', async () => {
    const t = await createThrowawayArtist(svc, 'Brand door fonts', asA)
    try {
      const archivo = await addGoogleFont(asA, t.id, 'Archivo')
      expect(archivo.ok, archivo.error).toBe(true)
      expect((await setFontSlot(asA, t.id, 'primary', archivo.font!.id)).ok).toBe(true)
      const sorg = await setArtistFont(asA, t.id, { label: 'Sorg', storagePath: fontPath(t.id), format: 'woff2' })
      expect((await setFontSlot(asA, t.id, 'custom_1', sorg.font!.id)).ok).toBe(true)
      await publishProfile(asA, t.id)
      await publishBrand(asA, t.id)

      const live = await door(t.slug)
      const google = live.fonts?.find((f) => f.family === 'archivo')
      expect(google).toEqual({ family: 'archivo', label: 'Archivo', path: null, format: null, source: 'google', google_family: 'Archivo' })
      const upload = live.fonts?.find((f) => f.family === 'sorg')
      expect(upload).toMatchObject({ family: 'sorg', source: 'upload', format: 'woff2' })
      expect(upload).not.toHaveProperty('google_family')
      expect(live.font_slots).toEqual({ primary: 'archivo', custom_1: 'sorg' })

      const working = await getWorkingSitePayload(asA, t.id)
      expect(working?.fonts).toEqual(live.fonts)
      expect(working?.font_slots).toEqual(live.font_slots)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe("the door's OWN filters — what no table CHECK lets reach the log, planted there directly", () => {
  // brand_colors' key/hex CHECKs and artist_fonts_google_family_clean refuse these shapes
  // long before a publish could snapshot them, so nothing through the app ever reached the
  // door's filter. But revisions are jsonb, written by scripts and restores too, and the
  // bridge interpolates key, hex and family into CSS: the door is the last line. So the
  // service key writes the log straight, a GOOD row beside every bad one (an empty answer
  // could otherwise mean nothing was read at all), and the witness below proves each bad
  // row IS the live revision for its entity — its absence is the filter's doing.
  // Seen red (2026-09-24) by making the bad rows well-formed ('#abcdef', 'Evil X'), i.e. what
  // the door would serve without its filter; the SQL itself was not broken (no migration).
  it('CRITICAL: a malformed colour key or hex, a quoted Google family and a malformed bar colour are dropped; the good ones are served', async () => {
    const t = await createThrowawayArtist(svc, 'Brand door filters', asA)
    try {
      await publishProfile(asA, t.id)
      // `published_at` on every row: a bulk insert sends the union of the rows' columns, so
      // one row that sets it would null it on the rest.
      const rev = (entity_type: string, data: Record<string, unknown>, entity_id: string = crypto.randomUUID(), published_at = new Date().toISOString()) => ({
        artist_id: t.id, entity_type, entity_id, data: { id: entity_id, ...data }, published_at,
      })
      const color = (key: string, name: string, hex: string, sort_order: number) =>
        rev('brand_color', { key, name, hex, slot: null, sort_order, created_at: '2026-09-25T00:00:00Z' })
      const google = (family: string, google_family: string, slots: string[]) =>
        rev('artist_font', { family, label: family, source: 'google', google_family, storage_path: null, format: null, slots })

      const { error } = await svc.from('revisions').insert([
        color('cream', 'Cream', '#f4f1ea', 1),
        color('BAD KEY', 'Spaced key', '#000000', 2),
        color('x'.repeat(41), 'Long key', '#000000', 3),
        color('upper', 'Uppercase hex', '#ABCDEF', 4),
        color('seven', 'Seven-digit hex', '#abcdef0', 5),
        rev('brand_color', { name: 'No key', hex: '#111111', slot: null, sort_order: 6 }),
        google('archivo', 'Archivo', ['primary']),
        google('evil', "Evil', x", ['secondary']),
        rev('theme_color', { theme_color: '#0a0a0a' }, t.id, '2026-01-01T00:00:00Z'),
      ])
      expect(error).toBeNull()
      // The bar colour's good half: served...
      expect((await door(t.slug)).brand?.theme_color).toBe('#0a0a0a')
      // ...until a NEWER malformed revision of the same entity is what `live` holds: then
      // null, not the bad value and not the older good one.
      expect((await svc.from('revisions').insert(rev('theme_color', { theme_color: '#ABCDEF' }, t.id))).error).toBeNull()

      // Witness: every bad row is live (latest for its entity, not deleted).
      const { data: liveRows } = await svc.rpc('published_revisions', { p_artist_id: t.id })
      const live = (liveRows ?? []) as { entity_type: string; data: Record<string, unknown> }[]
      expect(live.filter((r) => r.entity_type === 'brand_color').map((r) => r.data.name).sort()).toEqual(
        ['Cream', 'Long key', 'No key', 'Seven-digit hex', 'Spaced key', 'Uppercase hex'],
      )
      expect(live.filter((r) => r.entity_type === 'artist_font').map((r) => r.data.family).sort()).toEqual(['archivo', 'evil'])
      expect(live.filter((r) => r.entity_type === 'theme_color').map((r) => r.data.theme_color)).toEqual(['#ABCDEF'])

      const site = await door(t.slug)
      expect(site.brand).toEqual({ colors: [{ key: 'cream', name: 'Cream', hex: '#f4f1ea' }], theme_color: null })
      expect(site.fonts?.map((f) => f.family)).toEqual(['archivo'])
      expect(site.font_slots).toEqual({ primary: 'archivo' })
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('Revert puts the colours and the browser bar back, on the real log', () => {
  it('CRITICAL: a changed hex, an added colour, a deleted one (key and all) and the bar colour come back', async () => {
    const t = await createThrowawayArtist(svc, 'Brand sync revert', asA)
    try {
      await setSlotColor(asA, t.id, 'primary', '#c63a2a')
      const cream = await addBrandColor(asA, t.id, { name: 'Cream', hex: '#f4f1ea' })
      const black = await addBrandColor(asA, t.id, { name: 'Black', hex: '#0a0a0a', note: 'type colour' })
      await setThemeColor(asA, t.id, '#0a0a0a')
      await publishProfile(asA, t.id)
      await publishBrand(asA, t.id)
      const before = (await door(t.slug)).brand

      // Since: Primary moved, Black deleted, Teal added, the bar recoloured.
      await setSlotColor(asA, t.id, 'primary', '#000000')
      await deleteBrandColor(asA, t.id, black.color!.id)
      await addBrandColor(asA, t.id, { name: 'Teal', hex: '#00aaaa' })
      await setThemeColor(asA, t.id, '#123456')
      expect(await brandPending(asA, t.id)).toMatchObject({ dirty: true, message: '4 changes', canRevert: true })

      const res = await restoreBrandToPublished(asA, t.id)
      // No logos or fonts were ever published here, so those two are skipped; colours and
      // the bar were, and are not.
      expect(res.skipped).toEqual(['media', 'artist_font'])
      expect(await brandPending(asA, t.id)).toEqual({ dirty: false, message: '', canRevert: false })
      expect((await getWorkingSitePayload(asA, t.id))?.brand).toEqual(before)
      // Black is back under its OWN id and key — the site's --brand-black never moved.
      const { data: back } = await svc.from('brand_colors').select('id, key, name, hex').eq('artist_id', t.id).eq('key', 'black').single()
      expect(back).toEqual({ id: black.color!.id, key: 'black', name: 'Black', hex: '#0a0a0a' })
      const { data: teal } = await svc.from('brand_colors').select('id').eq('artist_id', t.id).eq('key', 'teal')
      expect(teal).toEqual([])
      expect(cream.ok).toBe(true)
    } finally {
      await deleteThrowawayArtist(svc, t)
    }
  })
})

describe('the brand_color and theme_color revision types are admitted, and only those two', () => {
  it('an unknown entity type is still refused (the CHECK was widened, not dropped)', async () => {
    const { error } = await svc.from('revisions').insert({ artist_id: B, entity_type: 'brand_font', entity_id: B, data: {} })
    expectCheck(error, 'revisions_entity_type_check')
  })
})
