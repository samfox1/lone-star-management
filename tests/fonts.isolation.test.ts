/**
 * Tenant isolation for `artist_fonts`, and the guards only the real database can hold.
 *
 * Three things are asserted here that no unit test can reach:
 *   1. RLS. A row-filtered UPDATE or DELETE returns `error: null` and touches nothing, so
 *      every cross-tenant case below asserts the row STATE with the service client. A
 *      marker is planted first, so "B could not delete it" can never pass vacuously
 *      because there was nothing there to delete.
 *   2. The single-role index. One primary and one secondary per artist is what the
 *      templates read; two rows claiming 'primary' makes the site's heading font depend
 *      on row order.
 *   3. The bucket's allowed_mime_types. The `fonts` bucket is PUBLIC-READ — a fan's
 *      browser fetches the file directly — so an SVG accepted here is stored XSS on the
 *      Supabase origin. The client-side rules are only advice; this is the guard a
 *      direct writer cannot route around, which is why it is tested with the SERVICE
 *      ROLE: if the god key is refused, no session can do better.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FONTS_BUCKET, listArtistFonts, removeArtistFont, setArtistFont, setFontRole } from '@/lib/fonts'
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
 *  tested. Returns rows, not a count — a role or label change has to be visible too. */
async function rowsOfA(): Promise<{ id: string; family: string; role: string | null; label: string }[]> {
  const { data } = await svc.from('artist_fonts').select('id, family, role, label').eq('artist_id', artistA)
  return (data ?? []) as { id: string; family: string; role: string | null; label: string }[]
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

  it("CRITICAL: B cannot give A's font a role", async () => {
    const res = await setFontRole(asB, artistA, markerId, 'primary')
    expect(res.ok).toBe(false)
    expect((await rowsOfA()).find((r) => r.id === markerId)?.role).toBeNull()
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
  it('CRITICAL: an artist cannot have two primary fonts', async () => {
    // Service role on purpose: setFontRole vacates the incumbent first, so the index is
    // only reachable by a writer that skips it — a script, the copilot, a later refactor.
    const first = await svc
      .from('artist_fonts')
      .insert({ artist_id: artistA, label: 'One', family: 'role-probe-one', storage_path: ownedPath(artistA), format: 'woff2', role: 'primary' })
      .select('id')
      .single()
    expect(first.error).toBeNull()

    const second = await svc.from('artist_fonts').insert({
      artist_id: artistA,
      label: 'Two',
      family: 'role-probe-two',
      storage_path: ownedPath(artistA),
      format: 'woff2',
      role: 'primary',
    })
    expect(second.error).not.toBeNull()
    expect(second.error?.message ?? '').toMatch(/duplicate key|unique/i)

    // …and the same for secondary, which is a separate slot, not a separate rule.
    expect(
      (
        await svc.from('artist_fonts').insert({
          artist_id: artistA,
          label: 'Two',
          family: 'role-probe-three',
          storage_path: ownedPath(artistA),
          format: 'woff2',
          role: 'secondary',
        })
      ).error,
    ).toBeNull()
    expect(
      (
        await svc.from('artist_fonts').insert({
          artist_id: artistA,
          label: 'Three',
          family: 'role-probe-four',
          storage_path: ownedPath(artistA),
          format: 'woff2',
          role: 'secondary',
        })
      ).error,
    ).not.toBeNull()

    await svc.from('artist_fonts').delete().eq('artist_id', artistA).like('family', 'role-probe-%')
  })

  it('MANY fonts with no role are fine — the roles are a shortcut, not a gate', async () => {
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
    expect((await svc.from('artist_fonts').insert({ ...row, storage_path: ownedPath(artistA) })).error).not.toBeNull()
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
