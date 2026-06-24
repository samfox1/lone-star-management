/**
 * MILESTONE 8 — Shopify merch sync (real DB). Same conflict policy, applied to
 * merch via the shopify_product_id dedup key.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncShopifyMerch } from '@/lib/sync'
import type { ShopifyMerch } from '@/lib/shopify'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('merch').delete().eq('artist_id', artistA)
  await svc.from('merch').delete().eq('artist_id', artistB)
})

function product(id: string, title: string): ShopifyMerch {
  return { shopify_product_id: id, title, image_url: null, price: '20.00', url: null }
}

describe('syncShopifyMerch', () => {
  it('inserts new, refreshes shopify-owned, never clobbers manual rows', async () => {
    await svc.from('merch').insert([
      { artist_id: artistA, title: 'My Manual Tee', shopify_product_id: 'shp-manual', source: 'manual' },
      { artist_id: artistA, title: 'Stale Auto Tee', shopify_product_id: 'shp-auto', source: 'shopify' },
    ])

    const result = await syncShopifyMerch(asA, artistA, [
      product('shp-manual', 'SHOULD NOT OVERWRITE'),
      product('shp-auto', 'Fresh Tee'),
      product('shp-new', 'New Tee'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('merch')
      .select('title, source, price, shopify_product_id')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.shopify_product_id, r]))
    expect(byId['shp-manual']).toMatchObject({ title: 'My Manual Tee', source: 'manual' })
    expect(byId['shp-auto']).toMatchObject({ title: 'Fresh Tee', source: 'shopify' })
    expect(byId['shp-new']).toMatchObject({ title: 'New Tee', source: 'shopify' })
    // Shopify price string round-tripped into numeric.
    expect(Number(byId['shp-new'].price)).toBe(20)
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    await expect(syncShopifyMerch(asA, artistB, [product('shp-x', 'x')])).rejects.toThrow()
    const { count } = await svc
      .from('merch')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })

  it('partial failure: a bad row is reported, the good rows still land', async () => {
    // 9999999999.00 is finite (survives coercion) but overflows numeric(10,2).
    const result = await syncShopifyMerch(asA, artistA, [
      product('shp-ok-1', 'Good Tee'),
      { ...product('shp-bad', 'Overflow Tee'), price: '9999999999.00' },
      product('shp-ok-2', 'Another Good Tee'),
    ])
    expect(result.added).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors[0]).toMatchObject({ externalId: 'shp-bad', op: 'insert' })

    const { data } = await svc.from('merch').select('shopify_product_id').eq('artist_id', artistA)
    const ids = (data ?? []).map((r) => r.shopify_product_id)
    expect(ids).toEqual(expect.arrayContaining(['shp-ok-1', 'shp-ok-2']))
    expect(ids).not.toContain('shp-bad') // failed row never half-written
  })

  it('dedupes a repeated product id (last-wins)', async () => {
    const result = await syncShopifyMerch(asA, artistA, [
      product('shp-dup', 'First'),
      product('shp-dup', 'Second'),
    ])
    expect(result.added).toBe(1)
    const { data } = await svc
      .from('merch')
      .select('title')
      .eq('artist_id', artistA)
      .eq('shopify_product_id', 'shp-dup')
      .single()
    expect(data?.title).toBe('Second')
  })
})
