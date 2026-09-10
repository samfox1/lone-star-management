/**
 * Gallery reorder — the visual editor's photo-ordering path. `reorderList` is pure;
 * `reorderGallery` writes each media row's sort_order to its index, RLS-scoped to the
 * caller's tenant. The DB tests run against the live project as the seeded manager and
 * clean up every row they insert.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { orientationOf, reorderGallery, reorderList } from '@/lib/site-editor/gallery'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

describe('orientationOf (pure)', () => {
  it('classifies a wider-than-tall image as horizontal', () => {
    expect(orientationOf(1600, 900)).toBe('horizontal')
  })
  it('classifies a taller-than-wide image as vertical', () => {
    expect(orientationOf(900, 1600)).toBe('vertical')
  })
  it('counts a square as horizontal (fits a landscape slot without letterboxing)', () => {
    expect(orientationOf(1000, 1000)).toBe('horizontal')
  })
  it('returns null for a degenerate size', () => {
    expect(orientationOf(0, 500)).toBeNull()
    expect(orientationOf(500, 0)).toBeNull()
  })
})

describe('reorderList (pure)', () => {
  it('moves an item forward', () => {
    expect(reorderList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
  it('moves an item backward', () => {
    expect(reorderList(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op copy for equal or out-of-range indices', () => {
    const l = ['a', 'b', 'c']
    expect(reorderList(l, 1, 1)).toEqual(l)
    expect(reorderList(l, 0, 5)).toEqual(l)
    expect(reorderList(l, 1, 1)).not.toBe(l) // new array
  })
})

describe('reorderGallery (DB)', () => {
  const svc = serviceClient()
  let artistA: string
  let asA: SupabaseClient
  const ids: string[] = []

  beforeAll(async () => {
    artistA = await artistIdBySlug(SEED.artistASlug)
    asA = await signInAs(SEED.managerA)
    for (let i = 0; i < 3; i++) {
      const { data } = await asA
        .from('media')
        .insert({ artist_id: artistA, purpose: 'gallery_image', storage_path: `${artistA}/test/reorder-${i}.jpg`, sort_order: i })
        .select('id')
        .single<{ id: string }>()
      ids.push(data!.id)
    }
  })

  afterAll(async () => {
    if (ids.length) await svc.from('media').delete().in('id', ids)
  })

  it('writes each row sort_order to its new index', async () => {
    const desired = [ids[2], ids[0], ids[1]]
    expect((await reorderGallery(asA, artistA, desired)).ok).toBe(true)

    const { data } = await svc.from('media').select('id, sort_order').in('id', ids)
    const order = new Map((data ?? []).map((r) => [r.id as string, r.sort_order as number]))
    expect(order.get(ids[2])).toBe(0)
    expect(order.get(ids[0])).toBe(1)
    expect(order.get(ids[1])).toBe(2)
  })

  it("CRITICAL: RLS blocks reordering another tenant's media", async () => {
    const artistB = await artistIdBySlug(SEED.artistBSlug)
    // seed one B row via the service client (bypasses RLS), with a sentinel order
    const { data: bRow } = await svc
      .from('media')
      .insert({ artist_id: artistB, purpose: 'gallery_image', storage_path: `${artistB}/test/foreign.jpg`, sort_order: 99 })
      .select('id')
      .single<{ id: string }>()
    try {
      await reorderGallery(asA, artistB, [bRow!.id]) // manager A cannot touch B
      const { data: after } = await svc.from('media').select('sort_order').eq('id', bRow!.id).single<{ sort_order: number }>()
      expect(after!.sort_order).toBe(99) // untouched
    } finally {
      await svc.from('media').delete().eq('id', bRow!.id)
    }
  })
})
