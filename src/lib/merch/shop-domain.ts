/**
 * A Shopify STORE ADDRESS, and the link that starts connecting one. Client-safe on purpose
 * (no node:crypto, no fetch): the Connect window checks the address before it leaves for
 * Shopify, and the server checks it again with this same rule.
 *
 * A store's API host is always `{store}.myshopify.com` — a custom public domain fronts only
 * the online store, never the API — so that is the only shape accepted. A bad address that
 * got through would send a token (the Storefront client) or an OAuth code (the app) to
 * somebody else's server. `connect_shopify` checks the same pattern again, authoritatively,
 * in SQL.
 */
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

/** A bare `{store}.myshopify.com` host, exactly: no scheme, no path, no spaces, lowercase. */
export function isShopDomain(value: unknown): value is string {
  return typeof value === 'string' && SHOP_DOMAIN_RE.test(value)
}

/**
 * What a manager pastes, tidied toward a store address: case, spaces, `https://`, a path,
 * and Shopify's own admin link (`admin.shopify.com/store/{store}/…`), which is the address
 * most people actually have open. The result is NOT trusted: callers still check it with
 * `isShopDomain`, so tidying can never turn something else into a store.
 */
export function normalizeShopDomain(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '')
  const admin = /^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)(?:[/?#]|$)/.exec(s)
  if (admin) return `${admin[1]}.myshopify.com`
  return s.split(/[/?#]/)[0].replace(/\.$/, '')
}

/** Where "Connect with Shopify" goes: our install route, which checks the manager and the
 *  store, then sends the browser to Shopify. */
export function shopifyInstallPath(artistId: string, shop: string): string {
  return `/api/shopify/install?${new URLSearchParams({ artist: artistId, shop })}`
}
