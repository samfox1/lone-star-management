/** Shopify: a service, by store domain + storefront token; feeds Merch. It is in neither
 *  registry (a Vault token, not an artist id column), so its whole def lives here.
 *  See README.md. */
import type { Service } from '../service'

export const SHOPIFY_KEY = 'shopify'

export const shopify: Service = {
  slug: 'shopify',
  service: { key: SHOPIFY_KEY, label: 'Shopify', kind: 'service', source: { key: SHOPIFY_KEY, section: 'merch', placeholder: 'store.myshopify.com' } },
}
