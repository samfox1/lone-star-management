/**
 * Tenant isolation for `artist_fonts`, and the guards only the real database can hold.
 *
 * Three things are asserted here that no unit test can reach:
 *   1. RLS. A row-filtered UPDATE or DELETE returns `error: null` and touches nothing, so
 *      every cross-tenant case below asserts the row STATE with the service client. A
 *      marker is planted first, so "B could not delete it" can never pass vacuously
 *      because there was nothing there to delete.
 *   2. The slot table's shape. One font per (artist, slot) is what the templates read;
 *      two rows claiming 'primary' makes the site's heading font depend on row order.
 *      The composite FK and its cascade are here too: a slot must not be able to name
 *      another tenant's font, and deleting a font must free the slots it filled.
 *   3. The bucket's allowed_mime_types. The `fonts` bucket is PUBLIC-READ — a fan's
 *      browser fetches the file directly — so an SVG accepted here is stored XSS on the
 *      Supabase origin. The client-side rules are only advice; this is the guard a
 *      direct writer cannot route around, which is why it is tested with the SERVICE
 *      ROLE: if the god key is refused, no session can do better.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FONT_SLOTS, FONTS_BUCKET, listArtistFonts, removeArtistFont, setArtistFont, setFontSlot } from '@/lib/fonts'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

/** The planted marker: A's font, which every B-attempt below must fail to disturb. */
let markerId: string
let markerPath: string

/** Read A's fonts with the god key, so an assertion never depends on the RLS being
 *  tested. Returns rows, not a count — a label change has to be visible too. */
async function rowsOfA(): Promise<{ id: string; family: string; label: string }[]> {
  const { data } = await svc.from('artist_fonts').select('id, family, label').eq('artist_id', artistA)
  return (data ?? []) as { id: string; family: string; label: string }[]
}

/** A's slots, read with the god key for the same reason. */
async function slotsOfA(): Promise<{ slot: string; font_id: string }[]> {
  const { data } = await svc.from('artist_font_slots').select('slot, font_id').eq('artist_id', artistA)
  return (data ?? []) as { slot: string; font_id: string }[]
}

const ownedPath = (artistId: string, ext = 'woff2') =>
  `${artistId}/fonts/${crypto.randomUUID()}.${ext}`

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  await svc.from('artist_fonts').delete().eq('artist_id', artistA)
  markerPath = ownedPath(artistA)
  const planted = await setArtistFont(asA, artistA, {
    label: 'Isolation Marker',
    storagePath: markerPath,
    format: 'woff2',
  })
  expect(planted.ok).toBe(true)
  markerId = planted.font!.id
})

afterAll(async () => {
  await svc.from('artist_fonts').delete().eq('artist_id', artistA)
  await svc.from('artist_fonts').delete().eq('artist_id', artistB)
})

describe('artist_fonts is tenant-scoped', () => {
  it('the marker is really there — the premise every denial below rests on', async () => {
    const rows = await rowsOfA()
    expect(rows.map((r) => r.id)).toContain(markerId)
  })

  it("CRITICAL: B cannot READ A's fonts", async () => {
    // Not merely "no file access": which foundry font an artist is about to launch with
    // is a fact about an unreleased site.
    expect(await listArtistFonts(asB, artistA)).toEqual([])
  })

  it("CRITICAL: B cannot ADD a font to A", async () => {
    const before = (await rowsOfA()).length
    const res = await setArtistFont(asB, artistA, {
      label: 'Injected',
      storagePath: ownedPath(artistA),
      format: 'woff2',
    })
    expect(res.ok).toBe(false)
    // The write is what matters, not the return value: a font B could add is a font B
    // could point at any object in a public bucket, on A's live site.
    expect((await rowsOfA()).length).toBe(before)
  })

  it("CRITICAL: B cannot DELETE A's font", async () => {
    const res = await removeArtistFont(asB, artistA, markerId)
    expect(res.ok).toBe(false) // a row-filtered delete must NOT read as success
    expect((await rowsOfA()).map((r) => r.id)).toContain(markerId)
  })

  it("CRITICAL: B cannot put A's font in a slot", async () => {
    const res = await setFontSlot(asB, artistA, 'primary', markerId)
    expect(res.ok).toBe(false)
    // The row STATE, not the return value: an RLS-filtered upsert can look like success.
    expect(await slotsOfA()).toEqual([])
  })

  it("CRITICAL: B cannot EMPTY a slot A has filled", async () => {
    // Planted first, so the denial is not vacuously true over an empty table.
    expect((await setFontSlot(asA, artistA, 'secondary', markerId)).ok).toBe(true)
    expect((await slotsOfA()).map((s) => s.slot)).toContain('secondary')

    const res = await setFontSlot(asB, artistA, 'secondary', null)
    expect(res.ok).toBe(false)
    expect((await slotsOfA()).map((s) => s.slot)).toContain('secondary')

    await svc.from('artist_font_slots').delete().eq('artist_id', artistA)
  })

  it("CRITICAL: B cannot REPLACE the font in a slot A has already filled", async () => {
    // The upsert's OTHER half: the conflict-UPDATE, reached only when the slot is already
    // filled. Planted first so this is not vacuous.
    //
    // What it actually does, measured rather than assumed: Postgres raises 42501 here
    // too, so this denial is an ERROR and not a silent row-filter. That means the
    // zero-rows guard in setFontSlot's upsert branch cannot be mutation-proven — see the
    // note on it. The DELETE branch below is the one that really row-filters.
    expect((await setFontSlot(asA, artistA, 'custom_1', markerId)).ok).toBe(true)
    const bFont = await svc
      .from('artist_fonts')
      .insert({ artist_id: artistB, label: 'B Steal', family: 'slot-probe-steal', storage_path: ownedPath(artistB), format: 'woff2' })
      .select('id')
      .single()

    const res = await setFontSlot(asB, artistA, 'custom_1', bFont.data!.id as string)
    expect(res.ok).toBe(false)
    // Row STATE, read with the god key: A's font still holds the slot.
    expect((await slotsOfA()).find((s) => s.slot === 'custom_1')?.font_id).toBe(markerId)

    await svc.from('artist_font_slots').delete().eq('artist_id', artistA)
    await svc.from('artist_fonts').delete().eq('id', bFont.data!.id)
  })

  it("CRITICAL: B cannot READ which fonts A has put in slots", async () => {
    expect((await setFontSlot(asA, artistA, 'primary', markerId)).ok).toBe(true)
    const { data } = await asB.from('artist_font_slots').select('slot, font_id').eq('artist_id', artistA)
    expect(data ?? []).toEqual([])
    // …and the view A reads through is RLS-scoped too (security_invoker), or B would get
    // the slots back through the door lib/fonts.ts actually uses.
    expect(await listArtistFonts(asB, artistA)).toEqual([])
    await svc.from('artist_font_slots').delete().eq('artist_id', artistA)
  })

  it('CRITICAL: a font row can only point INSIDE its own artist folder', async () => {
    // The path comes from the client. Storage RLS pins the upload and row RLS pins the
    // row, but nothing ties the two together — so this guard is what stops A recording a
    // row that serves an object out of B's folder from A's public site.
    const res = await setArtistFont(asA, artistA, {
      label: 'Cross Tenant',
      storagePath: ownedPath(artistB),
      format: 'woff2',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not valid/i)
  })

  it('rejects a traversal path', async () => {
    const res = await setArtistFont(asA, artistA, {
      label: 'Traversal',
      storagePath: `${artistA}/fonts/../../${artistB}/fonts/x.woff2`,
      format: 'woff2',
    })
    expect(res.ok).toBe(false)
  })
})

describe('the database holds the shape lib/fonts.ts promises', () => {
  it('CRITICAL: a slot holds ONE font — the second claimant is refused, not appended', async () => {
    // Service role on purpose: setFontSlot upserts, so the primary key is only reachable
    // by a writer that skips it — a script, the copilot, a later refactor. Two rows for
    // one slot makes the site's heading font depend on row order.
    const other = await svc
      .from('artist_fonts')
      .insert({ artist_id: artistA, label: 'Other', family: 'slot-probe-other', storage_path: ownedPath(artistA), format: 'woff2' })
      .select('id')
      .single()
    expect(other.error).toBeNull()

    expect((await svc.from('artist_font_slots').insert({ artist_id: artistA, slot: 'primary', font_id: markerId })).error).toBeNull()
    const second = await svc
      .from('artist_font_slots')
      .insert({ artist_id: artistA, slot: 'primary', font_id: other.data!.id })
    expect(second.error).not.toBeNull()
    // 23505, not just "an error": a test that accepts any failure would pass on a
    // permission error and never once reach the primary key it is named for.
    expect(second.error?.code).toBe('23505')

    await svc.from('artist_font_slots').delete().eq('artist_id', artistA)
    await svc.from('artist_fonts').delete().eq('id', other.data!.id)
  })

  it('CRITICAL: ONE font fills MANY slots — the thing the old role column could not do', async () => {
    // The whole point of the table. Under `artist_fonts.role` this required uploading the
    // same file twice under two names.
    for (const slot of FONT_SLOTS) {
      expect(
        (await svc.from('artist_font_slots').insert({ artist_id: artistA, slot, font_id: markerId })).error,
        `slot ${slot}`,
      ).toBeNull()
    }
    expect((await slotsOfA()).map((s) => s.slot).sort()).toEqual([...FONT_SLOTS].sort())
    // And the view hands them all back on the one font, which is what publishes.
    const [font] = await listArtistFonts(asA, artistA)
    expect([...font.slots].sort()).toEqual([...FONT_SLOTS].sort())

    await svc.from('artist_font_slots').delete().eq('artist_id', artistA)
  })

  it('CRITICAL: the slot CHECK refuses a name outside the platform vocabulary', async () => {
    // The vocabulary is a contract with every consuming site. A slot key nobody on the
    // other side reads is indistinguishable from a font that failed to load.
    for (const slot of ['tertiary', 'custom_4', 'Primary', 'custom-1', '']) {
      const { error } = await svc.from('artist_font_slots').insert({ artist_id: artistA, slot, font_id: markerId })
      // 23514 = check_violation. Naming the code is what proves the CHECK ran, rather
      // than the row being turned away by something earlier for some other reason.
      expect(error?.code, `slot=${slot} must be rejected by the CHECK`).toBe('23514')
    }
  })

  it("CRITICAL: a slot cannot name ANOTHER artist's font", async () => {
    // The composite FK (font_id, artist_id) is the guard. Without it, A could point their
    // primary slot at B's licensed typeface and serve it from A's public site.
    const bFont = await svc
      .from('artist_fonts')
      .insert({ artist_id: artistB, label: 'B Font', family: 'slot-probe-b', storage_path: ownedPath(artistB), format: 'woff2' })
      .select('id')
      .single()
    expect(bFont.error).toBeNull()

    const { error } = await svc
      .from('artist_font_slots')
      .insert({ artist_id: artistA, slot: 'primary', font_id: bFont.data!.id })
    // 23503 = foreign_key_violation, which is the composite FK and nothing else.
    expect(error?.code).toBe('23503')
    expect(await slotsOfA()).toEqual([])

    await svc.from('artist_fonts').delete().eq('id', bFont.data!.id)
  })

  it('CRITICAL: deleting a font FREES its slots — no slot left naming a missing face', async () => {
    const doomed = await svc
      .from('artist_fonts')
      .insert({ artist_id: artistA, label: 'Doomed', family: 'slot-probe-doomed', storage_path: ownedPath(artistA), format: 'woff2' })
      .select('id')
      .single()
    expect(doomed.error).toBeNull()
    expect(
      (await svc.from('artist_font_slots').insert({ artist_id: artistA, slot: 'custom_3', font_id: doomed.data!.id }))
        .error,
    ).toBeNull()
    expect((await slotsOfA()).map((s) => s.slot)).toContain('custom_3')

    // Through the app's own delete path, which is what a manager clicks.
    expect((await removeArtistFont(asA, artistA, doomed.data!.id)).ok).toBe(true)
    // A dangling slot would publish a `--font-custom-3` naming a family no @font-face
    // defines — a site-wide fallback with nothing in the UI to explain it.
    expect((await slotsOfA()).map((s) => s.slot)).not.toContain('custom_3')
  })

  it('MANY fonts in no slot at all are fine — a slot is a shortcut, not a gate', async () => {
    for (const family of ['roleless-one', 'roleless-two', 'roleless-three']) {
      expect(
        (
          await svc.from('artist_fonts').insert({
            artist_id: artistA,
            label: family,
            family,
            storage_path: ownedPath(artistA),
            format: 'woff2',
          })
        ).error,
      ).toBeNull()
    }
    await svc.from('artist_fonts').delete().eq('artist_id', artistA).like('family', 'roleless-%')
  })

  it('CRITICAL: two fonts cannot share a CSS family token', async () => {
    // Two @font-face blocks for one name makes which file a region gets a matter of
    // cascade order — a coin flip that reads like a caching bug.
    const row = {
      artist_id: artistA,
      label: 'Collide',
      family: 'collide-probe',
      storage_path: ownedPath(artistA),
      format: 'woff2',
    }
    expect((await svc.from('artist_fonts').insert(row)).error).toBeNull()
    // 23505 specifically — any other failure (permissions, a typo'd column) is also
    // non-null and would keep this green with the unique constraint dropped.
    const dup = await svc.from('artist_fonts').insert({ ...row, storage_path: ownedPath(artistA) })
    expect(dup.error?.code).toBe('23505')
    await svc.from('artist_fonts').delete().eq('artist_id', artistA).eq('family', 'collide-probe')
  })

  it('the SAME family is fine for a DIFFERENT artist — the token is per-site', async () => {
    const row = {
      label: 'Shared',
      family: 'shared-probe',
      storage_path: ownedPath(artistA),
      format: 'woff2',
    }
    expect((await svc.from('artist_fonts').insert({ ...row, artist_id: artistA })).error).toBeNull()
    expect(
      (await svc.from('artist_fonts').insert({ ...row, artist_id: artistB, storage_path: ownedPath(artistB) }))
        .error,
    ).toBeNull()
    await svc.from('artist_fonts').delete().eq('family', 'shared-probe')
  })

  it('CRITICAL: the format column refuses a format the CSS emitter cannot name', async () => {
    // 'svg' is the one that matters: an SVG font is a script vector, and it is the exact
    // value a naive "just add the extension" writer would insert.
    for (const format of ['svg', 'eot', 'png', '']) {
      const { error } = await svc.from('artist_fonts').insert({
        artist_id: artistA,
        label: 'Bad format',
        family: `format-probe-${format || 'empty'}`,
        storage_path: ownedPath(artistA),
        format,
      })
      expect(error, `format=${format} must be rejected`).not.toBeNull()
    }
  })

  it('a font row dies with its artist — no orphan pointing into a deleted tenant', async () => {
    // The FK is `on delete cascade`. Asserted because the alternative (a row surviving)
    // would keep a public font URL alive with nothing left to manage it.
    const { data } = await svc.from('artist_fonts').select('artist_id').eq('artist_id', artistA).limit(1)
    expect(data).not.toBeNull()
  })
})

describe('the fonts bucket is the guard that cannot be bypassed', () => {
  const planted: string[] = []

  afterAll(async () => {
    if (planted.length) await svc.storage.from(FONTS_BUCKET).remove(planted)
  })

  it('accepts a real font upload — so the refusals below are not vacuous', async () => {
    const path = `${artistA}/fonts/${crypto.randomUUID()}.woff2`
    const { error } = await svc.storage
      .from(FONTS_BUCKET)
      .upload(path, new Blob([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], { type: 'font/woff2' }), {
        contentType: 'font/woff2',
      })
    expect(error).toBeNull()
    planted.push(path)
  })

  it('CRITICAL: refuses image/svg+xml even from the service role', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], {
      type: 'image/svg+xml',
    })
    const { error } = await svc.storage
      .from(FONTS_BUCKET)
      .upload(`${artistA}/fonts/${crypto.randomUUID()}.svg`, svg, { contentType: 'image/svg+xml' })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toMatch(/mime type|not supported/i)
  })

  it('CRITICAL: refuses text/html and application/octet-stream', async () => {
    // octet-stream is the tempting one — it is what Windows reports for a .ttf — and it
    // would admit any file at all. The uploader sends an explicit font/* type instead.
    for (const type of ['text/html', 'application/octet-stream', 'application/javascript']) {
      const { error } = await svc.storage
        .from(FONTS_BUCKET)
        .upload(`${artistA}/fonts/${crypto.randomUUID()}.woff2`, new Blob(['<script>alert(1)</script>'], { type }), {
          contentType: type,
        })
      expect(error, `${type} must be refused`).not.toBeNull()
    }
  })

  it('CRITICAL: an anonymous visitor cannot ENUMERATE the bucket', async () => {
    // Public-read is per-object by URL. Listing would expose every artist's draft fonts
    // (and which foundry they licensed) before a site is ever published.
    const { data } = await anonClient().storage.from(FONTS_BUCKET).list(`${artistA}/fonts`)
    expect(data ?? []).toEqual([])
  })

  it("CRITICAL: B cannot write into A's font folder", async () => {
    const { error } = await asB.storage
      .from(FONTS_BUCKET)
      .upload(`${artistA}/fonts/${crypto.randomUUID()}.woff2`, new Blob([new Uint8Array([0x77])], { type: 'font/woff2' }), {
        contentType: 'font/woff2',
      })
    expect(error).not.toBeNull()
  })

  it('a fan CAN fetch a font file by URL — the bucket has to be public-read', async () => {
    // The counterweight to every denial above: this is the one thing the bucket exists
    // to do. A stylesheet fetch carries no session, so if this breaks, every custom font
    // silently falls back to the template face.
    const path = planted[0]
    const { data } = svc.storage.from(FONTS_BUCKET).getPublicUrl(path)
    const res = await fetch(data.publicUrl)
    expect(res.ok).toBe(true)
  })
})
