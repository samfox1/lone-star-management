// Pulling Shopify products into merch rows, against the real database.
/**
 * MILESTONE 8 — Shopify merch sync (real DB). Same conflict policy, applied to
 * merch via the shopify_product_id dedup key.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncShopifyMerch } from '@/lib/merch'
import type { ShopifyMerch } from '@/lib/merch'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

/**
 * EXACTLY THE ROWS THIS FILE MADE (AGENTS.md rule 6).
 *
 * This used to be `delete().eq('artist_id', artistA)` — every merch row the seed artists
 * had, whoever wrote it. The rule exists because that destroys other suites' premises and
 * any real data a person put there, and it does it silently: a later denial test asserting
 * "B cannot read A's merch" passes VACUOUSLY once the table is empty.
 *
 * The blast radius happened to be zero while `merch` was empty, which is exactly how a
 * teardown like this survives review. It stops being zero the moment an artist connects a
 * real store and pulls, so it is fixed before that rather than after.
 *
 * Every row this file creates is prefixed `shp-`, and each id is REGISTERED as it is used
 * rather than matched by a `like` pattern — a pattern is a second description of what the
 * tests do, and it drifts the first time someone adds a row with a different shape.
 */
const created = new Set<string>()

/** Register an id as this file's, so the teardown will collect it. */
function mine<T extends string>(id: T): T {
  created.add(id)
  return id
}

afterEach(async () => {
  if (created.size === 0) return
  const ids = [...created]
  await svc.from('merch').delete().in('shopify_product_id', ids).eq('artist_id', artistA)
  await svc.from('merch').delete().in('shopify_product_id', ids).eq('artist_id', artistB)
  created.clear()
})

function product(id: string, title: string, over: Partial<ShopifyMerch> = {}): ShopifyMerch {
  return {
    shopify_product_id: mine(id),
    handle: null,
    title,
    description: null,
    image_url: null,
    images: [],
    price: '20.00',
    url: null,
    variants: [],
    shippingEstimate: null,
    preorderNote: null,
    recordLabel: null,
    shippingDays: null,
    ...over,
  }
}

describe('syncShopifyMerch', () => {
  it('inserts new, refreshes shopify-owned, never clobbers manual rows', async () => {
    await svc.from('merch').insert([
      { artist_id: artistA, title: 'My Manual Tee', shopify_product_id: mine('shp-manual'), source: 'manual' },
      { artist_id: artistA, title: 'Stale Auto Tee', shopify_product_id: mine('shp-auto'), source: 'shopify' },
    ])

    const result = await syncShopifyMerch(asA, artistA, [
      product('shp-manual', 'SHOULD NOT OVERWRITE'),
      product('shp-auto', 'Fresh Tee'),
      product('shp-new', 'New Tee'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('merch')
      .select('title, source, price, shopify_product_id, on_site')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.shopify_product_id, r]))
    expect(byId['shp-manual']).toMatchObject({ title: 'My Manual Tee', source: 'manual' })
    expect(byId['shp-auto']).toMatchObject({ title: 'Fresh Tee', source: 'shopify' })
    // on_site is `not null default true` and the public doors coalesce to true, so the
    // insertDefaults `on_site: false` is the only thing keeping an import off the site.
    expect(byId['shp-new']).toMatchObject({ title: 'New Tee', source: 'shopify', on_site: false })
    // Shopify price string round-tripped into numeric.
    expect(Number(byId['shp-new'].price)).toBe(20)
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // Assert Postgres refuses — a bare .toThrow() would pass on any incidental throw.
    await expect(syncShopifyMerch(asA, artistB, [product('shp-x', 'x')])).rejects.toThrow(/row-level security/i)
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

  it('carries handle, description, gallery and variants onto the row', async () => {
    const variants = [
      { id: 'gid://v-s', title: 's', available: true, price: '45.00', currency: 'USD' },
      { id: 'gid://v-xl', title: 'xl', available: false, price: '45.00', currency: 'USD' },
    ]
    await syncShopifyMerch(asA, artistA, [
      product('shp-tee', 'Ballerinas Tee', {
        handle: '50-ballerinas-t-shirt',
        description: 'premium tee with a cropped fit',
        images: ['https://img.example/front.jpg', 'https://img.example/back.jpg'],
        variants,
      }),
    ])

    const { data } = await svc
      .from('merch')
      .select('handle, description, images, variants')
      .eq('artist_id', artistA)
      .eq('shopify_product_id', 'shp-tee')
      .single()
    expect(data?.handle).toBe('50-ballerinas-t-shirt')
    expect(data?.description).toBe('premium tee with a cropped fit')
    expect(data?.images).toEqual(['https://img.example/front.jpg', 'https://img.example/back.jpg'])
    // The variant gids round-trip intact through jsonb — a cart line is built from
    // these, so a lossy write would break checkout rather than just the display.
    expect(data?.variants).toEqual(variants)
  })

  it('a REFRESH updates variants, so a size selling out in Shopify reaches the row', async () => {
    await syncShopifyMerch(asA, artistA, [
      product('shp-tee', 'Tee', { variants: [{ id: 'gid://v-m', title: 'm', available: true, price: '45.00', currency: 'USD' }] }),
    ])
    await syncShopifyMerch(asA, artistA, [
      product('shp-tee', 'Tee', { variants: [{ id: 'gid://v-m', title: 'm', available: false, price: '45.00', currency: 'USD' }] }),
    ])

    const { data } = await svc
      .from('merch')
      .select('variants')
      .eq('artist_id', artistA)
      .eq('shopify_product_id', 'shp-tee')
      .single()
    expect((data?.variants as { available: boolean }[])[0].available).toBe(false)
  })

  it("CRITICAL: a pull never overwrites a manager's in_stock override", async () => {
    // The row is shopify-owned AND stays shopify-owned through an edit (source never
    // flips — see the syncShopifyMerch docblock), so it is refreshed by every pull.
    // Planting in_stock:false proves the sync leaves it alone rather than deriving it
    // from `variants`, which would silently un-sell-out a deliberate toggle.
    await syncShopifyMerch(asA, artistA, [product('shp-tee', 'Tee')])
    await svc.from('merch').update({ in_stock: false }).eq('artist_id', artistA).eq('shopify_product_id', 'shp-tee')

    await syncShopifyMerch(asA, artistA, [
      product('shp-tee', 'Tee', { variants: [{ id: 'gid://v-m', title: 'm', available: true, price: '45.00', currency: 'USD' }] }),
    ])

    const { data } = await svc
      .from('merch')
      .select('in_stock')
      .eq('artist_id', artistA)
      .eq('shopify_product_id', 'shp-tee')
      .single()
    expect(data?.in_stock).toBe(false)
  })

  // ── the teardown's own witness ─────────────────────────────────────────────────────
  //
  // Two halves of one claim, split across tests ON PURPOSE: the thing being proved is what
  // survives an `afterEach`, and a single test cannot observe its own teardown. Files run
  // in order and `fileParallelism` is false, so this pair is stable.
  //
  // Without it, "the teardown is scoped" is an unverified comment — and the old unscoped
  // version would pass every other test in this file exactly as it does now.
  it('plants a row this file does NOT own', async () => {
    // NOT registered with mine(): it stands in for another suite's fixture, or a person's
    // real merch row.
    const { error } = await svc.from('merch').insert({
      artist_id: artistA,
      title: 'Bystander — another suite owns this',
      shopify_product_id: 'bystander-not-ours',
      source: 'manual',
    })
    expect(error).toBeNull()
    // Do some ordinary work, so the teardown has something of its own to collect.
    await syncShopifyMerch(asA, artistA, [product('shp-witness', 'Witness')])
  })

  it('CRITICAL: the teardown collected its own rows and left the bystander alone', async () => {
    const { data } = await svc
      .from('merch')
      .select('shopify_product_id')
      .eq('artist_id', artistA)
    const ids = (data ?? []).map((r) => r.shopify_product_id)
    expect(ids, 'the teardown deleted a row it did not create').toContain('bystander-not-ours')
    expect(ids, 'the teardown left its own row behind').not.toContain('shp-witness')

    // This file cleans up after itself, including the stand-in it planted.
    await svc.from('merch').delete().eq('artist_id', artistA).eq('shopify_product_id', 'bystander-not-ours')
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
