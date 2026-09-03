/**
 * Shopify → `merch` rows. The DB half of the merch pull; the network half is
 * `./shopify`. Split from the catalog syncs in `@/lib/sync` (2026-09-02, Sam: "if I
 * wanted to view the shopify connection code, I knew it would be in merch") — the
 * shared insert/refresh/skip core still lives there as `syncExternal`, because the
 * conflict policy is one rule for every provider (ADR-0005).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncExternal, type SyncResult } from '@/lib/sync'
import type { ShopifyMerch } from './shopify'

/**
 * Shopify sends price as a raw string ('25.00'); merch.price is numeric(10,2).
 * Coerce like the manual path (Number + isFinite); drop a non-numeric price to
 * null rather than letting it abort the row. A numerically valid but too-large
 * value still errors at the DB and is reported in SyncResult.errors.
 */
function coercePrice(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * `in_stock` is DELIBERATELY not written here, though `variants` makes it derivable
 * (`variants.some(v => v.available)`).
 *
 * This module's header says a row's source flips to 'manual' the moment a human edits
 * it, which would make refreshing safe. It does not: `updateContent` writes only
 * `pickFields`, `source` is not in `CRUD.merch.fields`, and no trigger does it either
 * — so a merch row stays source='shopify' forever and every pull refreshes it. Writing
 * in_stock from here would therefore silently revert a manager's deliberate "sold out"
 * toggle on the next sync.
 *
 * It belongs in the live lane regardless (MERCH_PLAN): the site reads availability
 * from `variants` at render, so it is right without anyone pulling, and `merch.in_stock`
 * stays what it is today — the manual flag, authoritative for manually-added products
 * and a manager override for Shopify ones.
 */
export function syncShopifyMerch(
  supabase: SupabaseClient,
  artistId: string,
  products: ShopifyMerch[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'merch',
    externalIdCol: 'shopify_product_id',
    source: 'shopify',
    artistId,
    items: products.map((p) => ({
      externalId: p.shopify_product_id,
      values: {
        title: p.title,
        image_url: p.image_url,
        price: coercePrice(p.price),
        url: p.url,
        // Product-page fields (20260902120000). handle backs /merch/[handle];
        // variants carry the ProductVariant gids the cart is built from.
        handle: p.handle,
        description: p.description,
        images: p.images,
        variants: p.variants,
        // Metafields (20260903120000). preorder_note doubles as the pre-order flag.
        shipping_estimate: p.shippingEstimate,
        preorder_note: p.preorderNote,
        record_label: p.recordLabel,
        shipping_days: p.shippingDays,
      },
    })),
    insertDefaults: { on_site: false },
  })
}
