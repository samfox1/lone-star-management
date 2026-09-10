'use server'

/**
 * Shopify connect / pull / disconnect. These live with the Merch section rather than
 * in the dashboard's shared actions file so the whole merchandise pipeline — client,
 * sync, actions, connect panel — is findable from the domain (Sam, 2026-09-02). The
 * pipeline's other half is `@/lib/merch`.
 *
 * The storefront token is WRITE-ONLY from the browser's side: connect posts it straight
 * to Vault via `connect_shopify`, and only the owner-gated `shopify_credentials` RPC
 * reads it back, server-side, for a pull.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createShopifyClient, syncShopifyMerch } from '@/lib/merch'
import { probeShopify, type ShopifyProbe } from '@/lib/merch/probe'
import { autoPublish } from '@/lib/content'

/**
 * TEST CONNECTION — read one page from the store and show it back (MERCH_PLAN step 7).
 *
 * Connecting is the one step an artist's team does without us, and the four ways it fails
 * all look the same from here: no products. So this does not answer "connected?" with a
 * tick — it answers with THEIR OWN MERCH, or with the name of the door that is shut.
 *
 * IT READS THE STORED CREDENTIAL, NOT A TYPED ONE (Sam, 2026-09-10). The tempting design
 * is to probe before saving, so a broken token is never stored. But the question a manager
 * is really asking is "will the pull work", and the pull goes through Vault via
 * `shopify_credentials`. Probing the pasted values would exercise a different path than
 * the one that matters and could pass while every sync failed. A bad token stored is
 * cheap — the next attempt overwrites it, and Disconnect exists. A green test beside a
 * broken sync is not.
 *
 * IT WRITES NOTHING. No merch rows, no revalidate: "Pull merch" stays the deliberate act,
 * so this is safe to press as often as you like. And what it returns is rendered in a
 * browser, so the token stays here — `getFirstPage` hands back products, never credentials.
 */
export async function probeShopifyAction(
  artistId: string,
): Promise<ShopifyProbe & { storeDomain?: string }> {
  const supabase = await createClient()
  const { data: creds, error } = await supabase.rpc('shopify_credentials', {
    p_artist_id: artistId,
  })
  // Our own database failing is NOT the artist's Shopify setup being wrong. Calling it
  // 'bad-token' would send them to Shopify to fix a token that was never the problem.
  if (error) return { ok: false, reason: 'unknown', detail: error.message }
  if (!creds || creds.length === 0) {
    // Returned WITHOUT touching the network: a request carrying an empty token is a
    // pointless round trip that comes back as a 401 and reads as "your token is wrong".
    return { ok: false, reason: 'not-connected', detail: 'No Shopify store is connected.' }
  }

  const { store_domain, token } = creds[0] as { store_domain: string; token: string }
  const client = createShopifyClient({ domain: store_domain, token })
  const probe = await probeShopify(() => client.getFirstPage())
  // The domain rides along so the preview can NAME the store. Products alone prove some
  // store answered; products plus the domain prove it was the one they typed.
  return { ...probe, storeDomain: store_domain }
}

/** Connect (or rotate) the artist's Shopify store. Token is stored in Vault. */
export async function connectShopifyAction(
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const domain = String(formData.get('store_domain') ?? '').trim()
  const token = String(formData.get('storefront_token') ?? '').trim()
  if (!domain || !token) return { error: 'Enter a store domain and a storefront token.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('connect_shopify', {
    p_artist_id: artistId,
    p_domain: domain,
    p_token: token,
  })
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function disconnectShopifyAction(artistId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('disconnect_shopify', { p_artist_id: artistId })
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Pull the store's products into draft merch. The storefront token is fetched
 * server-side from Vault via the owner-gated RPC; it never reaches the browser.
 *
 * The `SyncResult` is REPORTED, not discarded. `syncExternal` writes row by row and
 * collects per-row failures into `errors[]` rather than aborting the pull, so a pull
 * can succeed as a whole and import nothing — and until 2026-09-03 the manager was
 * told "Merch pulled" either way (REVIEW_2026-09-03 M7). `merch_handle_uniq` made that
 * reachable: reconnect to a different Shopify store while the old rows still hold the
 * handles and every colliding insert lands in `errors[]`.
 */
export async function syncShopifyAction(
  artistId: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const supabase = await createClient()
  const { data: creds, error } = await supabase.rpc('shopify_credentials', {
    p_artist_id: artistId,
  })
  if (error) return { ok: false, error: error.message }
  if (!creds || creds.length === 0) return { ok: false, error: 'Connect a Shopify store first.' }

  const { store_domain, token } = creds[0] as { store_domain: string; token: string }
  let result
  try {
    const client = createShopifyClient({ domain: store_domain, token })
    const products = await client.getProducts()
    result = await syncShopifyMerch(supabase, artistId, products)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }

  // Before the failure check, not after: a partial pull DID write rows, and returning
  // an error over a stale list would tell the manager two contradictory things at once.
  revalidatePath(`/artists/${artistId}`, 'layout')
  // Merch goes straight to the site (AUTO_PUBLISH): the snapshot follows every pull so a
  // product toggled on later is already there for the door to serve. Synced products
  // still ARRIVE off-site (insertDefaults), so nothing appears until it is chosen.
  await autoPublish(supabase, 'merch', artistId)

  if (result.failed > 0) {
    // The first message is the diagnostic one — a unique-constraint name says "that
    // handle is already taken", which is the difference between "retry" and
    // "these rows belong to your old store".
    const reason = result.errors[0]?.message ?? 'unknown error'
    const landed = result.added + result.updated
    return {
      ok: false,
      error: `${result.failed} product${result.failed === 1 ? '' : 's'} failed to save (${landed} saved): ${reason}`,
    }
  }

  // Counts rather than a fixed "Merch pulled": a pull that touched nothing because
  // every row is manual looked identical to one that imported the whole catalogue.
  const parts = [`${result.added} added`, `${result.updated} updated`]
  if (result.skipped > 0) parts.push(`${result.skipped} left alone`)
  return { ok: true, message: `Merch pulled: ${parts.join(', ')}` }
}
