// Brand writes are tenant-scoped, and the database bounds the framing even if the client is
//   bypassed.
/**
 * Tenant isolation for the brand writes, and the action's purpose allowlist.
 *
 * Both Brand actions take an `artistId` straight from the client and do no ownership
 * check of their own — RLS is the gate, by the same convention every other write in this
 * dashboard follows. That convention is only worth anything if something actually tests
 * it, and nothing did: every assertion in brand-media.test.ts uses managerA on artistA.
 *
 * The DELETE in `setBrandAsset` is the sharp edge. It vacates the slot BEFORE inserting,
 * so if RLS ever stopped scoping it, one manager could wipe another artist's logo and
 * repoint their favicon. A row-filtered DELETE returns no error, so these assert the row
 * STATE with the service client rather than trusting a return value.
 *
 * WHY THE TENANT IS A THROWAWAY (AGENTS.md rule 6). This file used to run on the shared
 * seed artist `lone-pine` and tear down by deleting EVERY logo_primary / logo_secondary /
 * favicon row it owned and nulling `favicon_zoom` / `favicon_offset_y`. None of that was
 * created here: on the live hosted project that is the artist's real brand set and the
 * real favicon framing a human had adjusted by hand, destroyed on every run. Worse, the
 * tests overwrite `logo_primary` on their way past, so the row the teardown deleted was
 * whatever had replaced the real one. The artist below is created by this file and dropped
 * by it, so "delete everything for this tenant" is literally "delete what I created" — and
 * it happens by cascade, in one statement that cannot miss a column someone adds later.
 *
 * B stays a real manager (of the seed artist `gulf-static`) on purpose: the denials have
 * to be about A's ownership, not about B being a stranger with no artist at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_FRAMING, loadFraming, saveFraming, setBrandAsset } from '@/lib/brand'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

// Owned, uuid-shaped paths: setBrandAsset rejects anything else (the path comes from
// the client, so it is validated against the caller's own tenant folder).
let MINE: string
let THEIRS: string

async function logoPath(): Promise<string | undefined> {
  const { data } = await svc
    .from('media')
    .select('storage_path')
    .eq('artist_id', artistA)
    .eq('purpose', 'logo_primary')
  return (data ?? [])[0]?.storage_path as string | undefined
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  tenantA = await createThrowawayArtist(svc, 'Brand isolation A', asA)
  artistA = tenantA.id
  MINE = `${artistA}/brand/aaaaaaaa-0000-4000-8000-000000000000.png`
  THEIRS = `${artistA}/brand/bbbbbbbb-0000-4000-8000-000000000000.png`
})

afterAll(async () => {
  // One statement, and it cascades to every media row and every framing value this file
  // ever wrote — because it owns the artist they hang off.
  await deleteThrowawayArtist(svc, tenantA)
})

describe('brand writes are tenant-scoped', () => {
  it("CRITICAL: B cannot REPLACE A's primary logo", async () => {
    await setBrandAsset(asA, artistA, 'logo_primary', MINE)
    await setBrandAsset(asB, artistA, 'logo_primary', THEIRS)
    // Neither half may have landed — not the insert, and not the vacate before it.
    expect(await logoPath()).toBe(MINE)
  })

  it("CRITICAL: B cannot CLEAR A's primary logo (the vacate-only path)", async () => {
    await setBrandAsset(asA, artistA, 'logo_primary', MINE)
    await setBrandAsset(asB, artistA, 'logo_primary', null)
    expect(await logoPath()).toBe(MINE)
  })

  it("CRITICAL: B cannot rewrite A's favicon framing", async () => {
    await saveFraming(asA, artistA, { zoom: 2, offsetY: 0.1 })
    await saveFraming(asB, artistA, { zoom: 6, offsetY: -1 })
    expect(await loadFraming(asA, artistA)).toEqual({ zoom: 2, offsetY: 0.1 })
  })

  it("CRITICAL: B cannot READ A's framing", async () => {
    await saveFraming(asA, artistA, { zoom: 3, offsetY: 0.2 })
    // RLS hides the row entirely, and loadFraming's no-row guard turns that into the
    // default rather than an exception — so B learns nothing about A's settings.
    expect(await loadFraming(asB, artistA)).toEqual(DEFAULT_FRAMING)
  })
})

/**
 * Brand colours and the browser-bar colour (20260925120000 made both publishable, so a
 * cross-tenant write now reaches another artist's live site). `brand_colors_rw` and the
 * artists policies are the only gate. Every denial is judged against a row PLANTED here by
 * the service client and re-read by it afterwards: a denied UPDATE/DELETE is row-filtered
 * (no error, zero rows — AGENTS.md rule 3), and an INSERT denial is 42501 exactly, so a
 * CHECK or unique violation cannot stand in for it.
 */
describe("brand colours and the browser-bar colour are A's alone", () => {
  let primaryId: string
  let creamId: string
  const THEME = '#123456'

  const colorsOfA = async () => {
    const { data, error } = await svc
      .from('brand_colors')
      .select('id, key, slot, name, hex')
      .eq('artist_id', artistA)
      .order('key')
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const themeOfA = async () =>
    ((await svc.from('artists').select('theme_color').eq('id', artistA).single()).data as { theme_color: string | null }).theme_color

  beforeAll(async () => {
    const { data, error } = await svc
      .from('brand_colors')
      .insert([
        { artist_id: artistA, slot: 'primary', name: 'Primary', hex: '#c63a2a', sort_order: 0 },
        { artist_id: artistA, name: 'Cream', hex: '#f4f1ea', sort_order: 1 },
      ])
      .select('id, key')
    if (error || !data) throw new Error(`plant colours: ${error?.message}`)
    primaryId = data.find((r) => r.key === 'primary')!.id as string
    creamId = data.find((r) => r.key === 'cream')!.id as string
    const { error: e2 } = await svc.from('artists').update({ theme_color: THEME }).eq('id', artistA)
    if (e2) throw new Error(`plant theme colour: ${e2.message}`)
  })

  const PLANTED = [
    { key: 'cream', slot: null, name: 'Cream', hex: '#f4f1ea' },
    { key: 'primary', slot: 'primary', name: 'Primary', hex: '#c63a2a' },
  ]
  const planted = async () => (await colorsOfA()).map(({ key, slot, name, hex }) => ({ key, slot, name, hex }))

  it("CRITICAL: B cannot READ A's colours", async () => {
    expect(await planted()).toEqual(PLANTED)
    const byArtist = await asB.from('brand_colors').select('id').eq('artist_id', artistA)
    expect(byArtist.error).toBeNull()
    expect(byArtist.data).toEqual([])
    const byId = await asB.from('brand_colors').select('id').in('id', [primaryId, creamId])
    expect(byId.data).toEqual([])
  })

  it("CRITICAL: B cannot UPDATE A's colours (rename, re-hex)", async () => {
    // Only writes A's own manager could make: a built-in's name is fixed by a CHECK, so
    // renaming Primary would be refused by the CHECK with the door wide open (it was, the
    // first time this ran). `error: null` proves each write reached RLS, not a constraint.
    const rename = await asB.from('brand_colors').update({ name: 'Hacked', hex: '#000000' }).eq('id', creamId).select('id')
    const rehex = await asB.from('brand_colors').update({ hex: '#000000' }).eq('id', primaryId).select('id')
    for (const res of [rename, rehex]) {
      // Row-filtered: no error, no rows. The state below is the proof.
      expect(res.error).toBeNull()
      expect(res.data).toEqual([])
    }
    expect(await planted()).toEqual(PLANTED)
  })

  it("CRITICAL: B cannot DELETE A's colours", async () => {
    const byId = await asB.from('brand_colors').delete().in('id', [primaryId, creamId])
    const byArtist = await asB.from('brand_colors').delete().eq('artist_id', artistA)
    expect(byId.error).toBeNull()
    expect(byArtist.error).toBeNull()
    expect(await planted()).toEqual(PLANTED)
  })

  it('CRITICAL: B cannot INSERT a colour into A — by name, with an explicit key, or by upserting A\'s Primary', async () => {
    const byName = await asB.from('brand_colors').insert({ artist_id: artistA, name: 'Intruder', hex: '#ff00aa' })
    expectRlsDenied(byName.error, 'insert into A by name')
    // A key no row of A's holds: were RLS open, nothing else would refuse this (the
    // unique and slot CHECKs pass), so 42501 is RLS's answer and not a constraint's.
    const withKey = await asB.from('brand_colors').insert({ artist_id: artistA, key: 'b-was-here', name: 'B', hex: '#ff00aa' })
    expectRlsDenied(withKey.error, 'insert into A with an explicit key')
    // setSlotColor's own shape: INSERT … ON CONFLICT (artist_id, slot) DO UPDATE.
    const upsert = await asB
      .from('brand_colors')
      .upsert({ artist_id: artistA, slot: 'primary', name: 'Primary', hex: '#000000' }, { onConflict: 'artist_id,slot' })
    expectRlsDenied(upsert.error, "upsert of A's Primary")
    expect(await planted()).toEqual(PLANTED)
  })

  it("CRITICAL: B cannot change A's browser-bar colour", async () => {
    expect(await themeOfA()).toBe(THEME)
    const res = await asB.from('artists').update({ theme_color: '#000000' }).eq('id', artistA).select('id')
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(await themeOfA()).toBe(THEME)
  })
})

describe('loadFraming — the no-row guard', () => {
  it('returns the default rather than throwing when the artist row is not visible', async () => {
    // Reachable in production: a deleted artist, or an id RLS makes invisible. The tab
    // icon has no error state, so this must always produce something drawable.
    await expect(loadFraming(asA, '00000000-0000-0000-0000-000000000000')).resolves.toEqual(
      DEFAULT_FRAMING,
    )
  })
})

describe('the database bounds the framing even when lib/brand.ts is bypassed', () => {
  it('rejects an out-of-range zoom or offset from the service role', async () => {
    // saveFraming clamps in JS, so the CHECK constraints are only reachable by a writer
    // that skips it — a script, the copilot, or a future direct write.
    expect((await svc.from('artists').update({ favicon_zoom: 99 }).eq('id', artistA)).error).not.toBeNull()
    expect(
      (await svc.from('artists').update({ favicon_offset_y: 42 }).eq('id', artistA)).error,
    ).not.toBeNull()
  })

  it('still accepts NULL — the documented "never adjusted" state', async () => {
    expect(
      (await svc.from('artists').update({ favicon_zoom: null, favicon_offset_y: null }).eq('id', artistA))
        .error,
    ).toBeNull()
  })
})

describe('the media bucket refuses SVG even when every client guard is bypassed', () => {
  it('CRITICAL: an image/svg+xml upload is rejected by the bucket itself', async () => {
    // SVG is a stored-XSS vector on a PUBLIC bucket: it executes script when opened
    // directly. The picker filter and IMAGE_UPLOAD_RULES both exclude it, but browser
    // uploads go straight to Storage — so the bucket's own allowed_mime_types is the
    // only guard a direct writer cannot route around. Service role on purpose: if even
    // the god key is refused, no session can do better.
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], {
      type: 'image/svg+xml',
    })
    const { error } = await svc.storage
      .from('media')
      .upload(`${artistA}/brand/svg-guard-${crypto.randomUUID()}.svg`, svg, {
        contentType: 'image/svg+xml',
      })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toMatch(/mime type|not supported/i)
  })
})
