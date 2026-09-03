/**
 * Merch: everything Shopify. The one door for the merchandise pipeline, so the
 * connection code is findable from the domain rather than from the provider's name
 * (Sam, 2026-09-02).
 *
 *   ./shopify  — the Storefront GraphQL client (auth, pagination, throttle, mapping)
 *   ./sync     — mapping those products onto `merch` rows
 *
 * The connect/pull/disconnect server actions and the connect panel live with the
 * dashboard's Merch section, in `app/artists/[id]/(dashboard)/merch/`.
 */
export { createShopifyClient, PAGE_SIZES } from './shopify'
export type { ShopifyClient, ShopifyMerch, ShopifyVariant } from './shopify'
export { syncShopifyMerch } from './sync'
