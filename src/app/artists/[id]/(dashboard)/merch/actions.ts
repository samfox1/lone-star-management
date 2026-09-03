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
 */
export async function syncShopifyAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: creds, error } = await supabase.rpc('shopify_credentials', {
    p_artist_id: artistId,
  })
  if (error) return { ok: false, error: error.message }
  if (!creds || creds.length === 0) return { ok: false, error: 'Connect a Shopify store first.' }

  const { store_domain, token } = creds[0] as { store_domain: string; token: string }
  try {
    const client = createShopifyClient({ domain: store_domain, token })
    const products = await client.getProducts()
    await syncShopifyMerch(supabase, artistId, products)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}
