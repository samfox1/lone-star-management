import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isShopDomain } from '@/lib/merch/shop-domain'
import { shopifyAppConfig, verifyWebhookHmac } from '@/lib/merch/shopify-oauth'

/**
 * SHOPIFY → US: the app's webhooks, one address for all of them (the topic is in
 * `X-Shopify-Topic`). Nothing is read or changed until the body's signature checks out
 * against the app secret; an unsigned or wrongly signed body is a 401, which is also what
 * Shopify's own checks expect.
 *
 * `app/uninstalled` — the store removed the app, and with it every token the app made, so the
 * connection is dead: it is removed the way Remove removes it, minus one thing. Remove runs
 * `disconnect_shopify`, which deletes the Vault secret and then the row, but that function
 * checks the CALLER manages the artist, and a webhook has no caller. Without a new database
 * door (not added: no migrations from here), this deletes the `integrations` row with the
 * service role and leaves the Vault secret behind — holding a token Shopify has already
 * revoked. Synced merch rows stay, exactly as they do after Remove.
 *
 * The store is read from the SIGNED body's `myshopify_domain`, never from the
 * `X-Shopify-Shop-Domain` header or the topic header, neither of which is signed. The privacy
 * webhooks' bodies carry `shop_domain` instead, so a signed privacy body relabelled
 * `app/uninstalled` finds no store and removes nothing.
 *
 * The three privacy (compliance) webhooks are acknowledged and change nothing, because there
 * is nothing to hand over or erase: the app's only scope reads published products, and no
 * Shopify customer, order or checkout ever reaches this system (checkout is a Shopify cart
 * permalink on the artist's site). See each case below.
 */
export async function POST(request: Request) {
  const config = shopifyAppConfig()
  if (!config) return new Response(null, { status: 401 })
  const body = new Uint8Array(await request.arrayBuffer())
  if (!verifyWebhookHmac(body, request.headers.get('x-shopify-hmac-sha256'), config.apiSecret)) return new Response(null, { status: 401 })

  switch (request.headers.get('x-shopify-topic')) {
    case 'app/uninstalled':
      return uninstalled(body)
    case 'customers/data_request':
      // Would send the store owner what we hold about one of their customers. We hold
      // nothing about Shopify customers, so there is nothing to send.
      return ok()
    case 'customers/redact':
      // Would erase one customer's data. None is held.
      return ok()
    case 'shop/redact':
      // Sent 48 hours after an uninstall: erase the store's data. The credential went at
      // `app/uninstalled`. The synced merch rows (product titles, images, prices) are kept
      // on purpose: they are the artist's published catalogue, and deleting them would break
      // pages already live. A decision for Sam if a store ever asks for them to go.
      return ok()
    default:
      return ok()
  }
}

async function uninstalled(body: Uint8Array) {
  let shop: unknown
  try {
    shop = (JSON.parse(new TextDecoder().decode(body)) as { myshopify_domain?: unknown } | null)?.myshopify_domain
  } catch {
    return ok()
  }
  if (!isShopDomain(shop)) return ok()

  const { data, error } = await createAdminClient()
    .from('integrations')
    .delete()
    .eq('provider', 'shopify')
    .eq('metadata->>store_domain', shop)
    .select('artist_id')
  // A 500 makes Shopify send it again later, which is what a failed delete wants.
  if (error) return new Response(null, { status: 500 })
  for (const row of (data ?? []) as { artist_id: string }[]) revalidatePath(`/artists/${row.artist_id}`, 'layout')
  return ok()
}

function ok() {
  return new Response(null, { status: 200 })
}
