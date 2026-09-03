/**
 * The LIVE LANE (MERCH_PLAN, "two lanes").
 *
 * A published revision is the EDITORIAL record: which products are on the site, their
 * order, title, images, description. Those are a manager's decisions and a publish
 * commits them. Price, availability and the variant list are Shopify's, and freezing
 * them into a revision means an artist who changes a price in Shopify keeps showing the
 * old one until somebody remembers to pull AND republish — a wrong price shown to a
 * buyer, which is the one kind of staleness that costs money.
 *
 * So this lane never touches the snapshot. It is resolved at render, keyed by
 * `shopify_product_id`, and the published values remain the fallback for first paint,
 * for crawlers, and for any moment Shopify or this route is unreachable.
 */
import type { ShopifyMerch, ShopifyVariant } from './shopify'

/**
 * The shape `slugify` produces and the shape `media.slug`'s CHECK constraint enforces
 * (20260826140000): lowercase alphanumerics in hyphen-joined runs, no leading, trailing
 * or doubled hyphen, capped at `slugify`'s own 60-character slice.
 */
const PUBLIC_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 60

/**
 * Is this a slug the app could ever have minted?
 *
 * It lives beside the live lane's rules because the lane is where it MATTERS: the
 * route hands the slug to `unstable_cache` as a cache key and to the service-role
 * `shopify_store_for_slug` RPC, so an unchecked one is a guaranteed cache miss — one
 * Supabase round trip per distinct string, and one Next data-cache entry per distinct
 * string, from anyone who can type a URL. Rejecting the shapes the app cannot produce
 * bounds both to slugs that could plausibly name an artist.
 *
 * Not a security boundary: the RPC is parameterised and the door is service-role-only.
 * This is a budget boundary, which is the thing that was missing.
 */
export function isPublicSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && PUBLIC_SLUG_RE.test(slug)
}

export type LiveVariant = ShopifyVariant

export type LiveProduct = {
  /** The join key back to a published row. Chosen over `handle` because a handle
   *  changes when an artist renames a product, which would silently break the join
   *  until the next publish; a product gid never changes. */
  shopify_product_id: string
  price: string | null
  currency: string | null
  available: boolean
  variants: LiveVariant[]
}

/**
 * Reduce full Shopify products to the volatile fields only.
 *
 * The omissions are the point: title, images, description and handle are the manager's
 * published record, and serving them here would let a Shopify edit silently overwrite
 * the site's editorial layer through a path that never goes near a publish.
 */
export function toLiveProducts(products: ShopifyMerch[]): LiveProduct[] {
  return products.map((p) => ({
    shopify_product_id: p.shopify_product_id,
    // Shopify's own priceRange.minVariantPrice, unmodified. Deriving a different
    // "from" price (say, the cheapest IN-STOCK variant) would put the card out of
    // step with what the store itself displays and with checkout.
    price: p.price,
    // Shopify models currency per variant; a store sells in one, so the first variant
    // that states one speaks for the product. Null when none do.
    currency: p.variants.find((v) => v.currency)?.currency ?? null,
    // Empty variants => NOT buyable. A cart line is built from a variant gid, so with
    // none there is nothing to buy and a buy button could not work; the site falls
    // back to the product's Shopify url.
    available: p.variants.some((v) => v.available),
    // Sold-out variants are kept: the picker greys a size out rather than pretending
    // it was never made.
    variants: p.variants,
  }))
}
