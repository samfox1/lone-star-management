// Turning Shopify's live answer into prices, stock and variants for the site. Pure rules, no
//   network.
/**
 * The LIVE LANE (MERCH_PLAN step 2). Price, availability and variants are Shopify's,
 * resolved at render, never frozen into a published revision — a price that stays
 * stale until someone republishes is a wrong price shown to a buyer.
 *
 * These are the pure reduction rules. The route that serves them is thin on purpose.
 */
import { describe, expect, it } from 'vitest'
import { toLiveProducts } from '@/lib/merch/live'
import type { ShopifyMerch } from '@/lib/merch'

function product(over: Partial<ShopifyMerch> = {}): ShopifyMerch {
  return {
    shopify_product_id: 'gid://p1',
    handle: 'tee',
    title: 'Tee',
    description: null,
    image_url: null,
    images: [],
    price: '45.00',
    url: null,
    variants: [],
    shippingEstimate: null,
    preorderNote: null,
    recordLabel: null,
    shippingDays: null,
    ...over,
  }
}

const variant = (id: string, available: boolean, price = '45.00', currency: string | null = 'USD') => ({
  id,
  title: id,
  available,
  price,
  currency,
})

describe('toLiveProducts', () => {
  it('keeps only the volatile fields, dropping everything editorial', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-m', true)] }),
    ])
    // Title, images, description and handle are the manager's published record. Serving
    // them here would let Shopify silently overwrite the site's editorial layer.
    expect(Object.keys(live).sort()).toEqual(
      ['available', 'currency', 'price', 'shopify_product_id', 'variants'].sort(),
    )
  })

  it('is available when ANY variant is', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-s', false), variant('gid://v-m', true)] }),
    ])
    expect(live.available).toBe(true)
  })

  it('is unavailable when every variant is sold out', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-s', false), variant('gid://v-m', false)] }),
    ])
    expect(live.available).toBe(false)
  })

  it('CRITICAL: a product with no variants is NOT buyable', () => {
    // A cart line is built from a variant gid. With none there is nothing to buy, so
    // reporting it available would render a buy button that cannot work. The site
    // falls back to the Shopify url for these.
    const [live] = toLiveProducts([product({ variants: [] })])
    expect(live.available).toBe(false)
  })

  it('carries every variant through, sold-out ones included', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-s', true), variant('gid://v-xl', false)] }),
    ])
    // The picker greys "xl" out rather than pretending the size was never made.
    expect(live.variants.map((v) => v.id)).toEqual(['gid://v-s', 'gid://v-xl'])
  })

  it('takes currency from the first variant that states one', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-s', true, '45.00', null), variant('gid://v-m', true, '45.00', 'GBP')] }),
    ])
    expect(live.currency).toBe('GBP')
  })

  it('reports a null currency when no variant states one', () => {
    const [live] = toLiveProducts([
      product({ variants: [variant('gid://v-s', true, '45.00', null)] }),
    ])
    expect(live.currency).toBeNull()
  })

  it('keeps Shopify’s own product price rather than recomputing one', () => {
    // priceRange.minVariantPrice is what the store itself displays. Deriving a
    // different "from" price here would put the card out of step with checkout.
    const [live] = toLiveProducts([
      product({ price: '35.00', variants: [variant('gid://v-m', true, '45.00')] }),
    ])
    expect(live.price).toBe('35.00')
  })

  it('maps every product, preserving order', () => {
    const live = toLiveProducts([
      product({ shopify_product_id: 'gid://a' }),
      product({ shopify_product_id: 'gid://b' }),
    ])
    expect(live.map((p) => p.shopify_product_id)).toEqual(['gid://a', 'gid://b'])
  })
})
