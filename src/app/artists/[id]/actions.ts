'use server'

/**
 * Content server actions for one artist's dashboard. Generic over content type
 * (track / tour_date / merch / link). Each builds the request-bound Supabase
 * client (RLS scopes every write to the caller's tenant), extracts the type's
 * editable fields from FormData, and revalidates. type/id/artistId are bound as
 * leading args from the page.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  type EntityType,
  ENTITIES,
  createContent,
  deleteContent,
  publishAll,
  updateContent,
} from '@/lib/content'
import { isUrlField, safeHref } from '@/lib/url'
import { createSpotifyClient } from '@/lib/spotify'
import { createBandsintownClient } from '@/lib/bandsintown'
import { createShopifyClient } from '@/lib/shopify'
import { syncBandsintownTourDates, syncShopifyMerch, syncSpotifyTracks } from '@/lib/sync'

const NUMERIC = new Set(['price', 'sort_order'])

/**
 * Pull a type's editable fields out of FormData. Numbers are coerced and
 * rejected if non-finite; URL fields with a dangerous scheme are dropped so
 * they never persist (render-time safeHref is still the primary guard).
 */
/** Coerce/validate one raw field value; undefined means "drop it". */
function coerce(field: string, raw: string): unknown {
  if (NUMERIC.has(field)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (isUrlField(field)) {
    return safeHref(raw) !== undefined ? raw : undefined
  }
  return raw
}

/** Create: only fields the user actually filled (empty → use the DB default). */
function extractFields(type: EntityType, formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of ENTITIES[type].fields) {
    const raw = String(formData.get(field) ?? '').trim()
    if (raw === '') continue
    const value = coerce(field, raw)
    if (value !== undefined) out[field] = value
  }
  return out
}

/**
 * Update: only fields present in the submitted form are touched (absent fields
 * are left alone). An empty optional field is set to null so a manager can clear
 * it; a required (NOT NULL) field is never nulled.
 */
function extractUpdate(type: EntityType, formData: FormData): Record<string, unknown> {
  const required = new Set(ENTITIES[type].required)
  const out: Record<string, unknown> = {}
  for (const field of ENTITIES[type].fields) {
    if (!formData.has(field)) continue
    const raw = String(formData.get(field) ?? '').trim()
    if (raw === '') {
      if (!required.has(field)) out[field] = null
      continue
    }
    const value = coerce(field, raw)
    if (value !== undefined) out[field] = value
  }
  return out
}

export async function addContentAction(
  type: EntityType,
  artistId: string,
  formData: FormData,
) {
  const input = extractFields(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await createContent(supabase, type, artistId, input)
  revalidatePath(`/artists/${artistId}`)
}

export async function updateContentAction(
  type: EntityType,
  id: string,
  artistId: string,
  formData: FormData,
) {
  const input = extractUpdate(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await updateContent(supabase, type, id, input)
  revalidatePath(`/artists/${artistId}`)
}

export async function deleteContentAction(
  type: EntityType,
  id: string,
  artistId: string,
) {
  const supabase = await createClient()
  await deleteContent(supabase, type, id)
  revalidatePath(`/artists/${artistId}`)
}

export async function publishAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishAll(supabase, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`)
}

/** Save (or clear) the artist's Spotify artist id used to pull the discography. */
export async function saveSpotifyIdAction(artistId: string, formData: FormData) {
  const value = String(formData.get('spotify_artist_id') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ spotify_artist_id: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`)
}

/**
 * Pull the artist's Spotify discography and sync it into draft tracks. Inserts
 * new tracks and refreshes spotify-owned ones; manual edits are left untouched
 * (see syncSpotifyTracks). Requires SPOTIFY_CLIENT_ID/SECRET configured.
 */
export async function syncSpotifyAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('spotify_artist_id')
    .eq('id', artistId)
    .single()
  if (!artist?.spotify_artist_id) return

  const client = createSpotifyClient()
  const tracks = await client.getDiscographyTracks(artist.spotify_artist_id)
  await syncSpotifyTracks(supabase, artistId, tracks)
  revalidatePath(`/artists/${artistId}`)
}

/** Save (or clear) the artist's Bandsintown name used to pull tour dates. */
export async function saveBandsintownNameAction(artistId: string, formData: FormData) {
  const value = String(formData.get('bandsintown_name') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ bandsintown_name: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`)
}

/**
 * Pull the artist's Bandsintown events and sync them into draft tour dates.
 * Same conflict policy as Spotify. Requires BANDSINTOWN_APP_ID configured.
 */
export async function syncBandsintownAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('bandsintown_name')
    .eq('id', artistId)
    .single()
  if (!artist?.bandsintown_name) return

  const client = createBandsintownClient()
  const events = await client.getArtistEvents(artist.bandsintown_name)
  await syncBandsintownTourDates(supabase, artistId, events)
  revalidatePath(`/artists/${artistId}`)
}

/** Connect (or rotate) the artist's Shopify store. Token is stored in Vault. */
export async function connectShopifyAction(artistId: string, formData: FormData) {
  const domain = String(formData.get('store_domain') ?? '').trim()
  const token = String(formData.get('storefront_token') ?? '').trim()
  if (!domain || !token) return
  const supabase = await createClient()
  const { error } = await supabase.rpc('connect_shopify', {
    p_artist_id: artistId,
    p_domain: domain,
    p_token: token,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`)
}

export async function disconnectShopifyAction(artistId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('disconnect_shopify', { p_artist_id: artistId })
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`)
}

/**
 * Pull the store's products into draft merch. The storefront token is fetched
 * server-side from Vault via the owner-gated RPC; it never reaches the browser.
 */
export async function syncShopifyAction(artistId: string) {
  const supabase = await createClient()
  const { data: creds, error } = await supabase.rpc('shopify_credentials', {
    p_artist_id: artistId,
  })
  if (error) throw new Error(error.message)
  if (!creds || creds.length === 0) return

  const { store_domain, token } = creds[0] as { store_domain: string; token: string }
  const client = createShopifyClient({ domain: store_domain, token })
  const products = await client.getProducts()
  await syncShopifyMerch(supabase, artistId, products)
  revalidatePath(`/artists/${artistId}`)
}
