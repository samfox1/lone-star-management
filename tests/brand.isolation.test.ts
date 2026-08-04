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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_FRAMING, loadFraming, saveFraming, setBrandAsset } from '@/lib/brand'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  MINE = `${artistA}/brand/aaaaaaaa-0000-4000-8000-000000000000.png`
  THEIRS = `${artistA}/brand/bbbbbbbb-0000-4000-8000-000000000000.png`
})

afterAll(async () => {
  for (const p of ['logo_primary', 'logo_secondary', 'favicon']) {
    await svc.from('media').delete().eq('artist_id', artistA).eq('purpose', p)
  }
  await svc.from('artists').update({ favicon_zoom: null, favicon_offset_y: null }).eq('id', artistA)
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
