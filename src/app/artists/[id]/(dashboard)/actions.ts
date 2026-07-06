'use server'

/**
 * Content server actions for one artist's dashboard. Generic over content type
 * (track / tour_date / merch / link). Each builds the request-bound Supabase
 * client (RLS scopes every write to the caller's tenant), extracts the type's
 * editable fields from FormData, and revalidates. type/id/artistId are bound as
 * leading args from the page.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  type CrudEntity,
  type GenericEntity,
  type PublishableEntity,
  CRUD,
  createContent,
  deleteContent,
  publishAll,
  publishContent,
  publishProfile,
  updateContent,
} from '@/lib/content'
import { acceptsValue, fieldsFor, SEO_FIELDS, type SiteContentField } from '@/lib/site-content-schema'
import { embedInfo } from '@/lib/embed'
import { createYouTubeClient } from '@/lib/youtube'
import { CATALOG_SOURCES, type CatalogSource, setCatalogSource } from '@/lib/catalog'
import { isUrlField, safeHref } from '@/lib/url'
import { toReleaseType } from '@/lib/releases'
import { createSpotifyClient } from '@/lib/spotify'
import { createDeezerClient } from '@/lib/deezer'
import { createAppleMusicClient } from '@/lib/apple'
import { createBandsintownClient } from '@/lib/bandsintown'
import { createTicketmasterClient } from '@/lib/ticketmaster'
import { createShopifyClient } from '@/lib/shopify'
import {
  syncAppleTracks,
  syncBandsintownTourDates,
  syncDeezerTracks,
  syncShopifyMerch,
  syncSpotifyTracks,
  syncTicketmasterTourDates,
  syncYouTubeVideos,
} from '@/lib/sync'

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
function extractFields(type: GenericEntity, formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of CRUD[type].fields) {
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
function extractUpdate(type: GenericEntity, formData: FormData): Record<string, unknown> {
  const required = new Set(CRUD[type].required)
  const out: Record<string, unknown> = {}
  for (const field of CRUD[type].fields) {
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
  type: GenericEntity,
  artistId: string,
  formData: FormData,
) {
  const input = extractFields(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await createContent(supabase, type, artistId, input)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

export async function updateContentAction(
  type: GenericEntity,
  id: string,
  artistId: string,
  formData: FormData,
) {
  const input = extractUpdate(type, formData)
  if (Object.keys(input).length === 0) return
  const supabase = await createClient()
  await updateContent(supabase, type, id, input)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

export async function deleteContentAction(
  type: CrudEntity,
  id: string,
  artistId: string,
) {
  const supabase = await createClient()
  await deleteContent(supabase, type, id)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

export async function publishAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishAll(supabase, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Publish ONE content/media section (per-section Publish button). */
export async function publishSectionAction(type: PublishableEntity, artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishContent(supabase, type, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Publish the Site section: media + site text + the artist profile together. */
export async function publishSiteAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishContent(supabase, 'media', artistId, user?.id)
  await publishContent(supabase, 'site_content', artistId, user?.id)
  // Profile LAST (the live-gate invariant — see publishAll).
  await publishProfile(supabase, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Save the artist's editable site text. Upserts one row per (artist_id, key) for
 * the keys the active template declares; a blank value deletes the override (the
 * template falls back to its default). Emails are validated before persisting.
 * Draft until the Site section is published.
 */
export async function saveSiteContentAction(artistId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('template')
    .eq('id', artistId)
    .single()
  await upsertSiteContentFields(supabase, artistId, fieldsFor(artist?.template ?? 'classic'), formData)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Save the artist's SEO overrides (custom title / description / OG image) — stored
 * as ordinary site_content keys, so they're draft until the Site section is
 * published and then reach the public <head> via siteMetadata. A blank value
 * clears the override → the page falls back to its artist-derived default.
 */
export async function saveSeoAction(artistId: string, formData: FormData) {
  const supabase = await createClient()
  await upsertSiteContentFields(supabase, artistId, SEO_FIELDS, formData)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Upsert a set of site_content fields from a form: a present-and-nonblank value
 * is validated then upserted; a blank value deletes the override (the render
 * falls back to the default). Shared by the Site-text and SEO editors.
 */
async function upsertSiteContentFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  artistId: string,
  fields: SiteContentField[],
  formData: FormData,
) {
  for (const field of fields) {
    if (!formData.has(field.key)) continue
    const raw = String(formData.get(field.key) ?? '').trim()
    if (raw === '') {
      await supabase.from('site_content').delete().eq('artist_id', artistId).eq('key', field.key)
      continue
    }
    if (!acceptsValue(field, raw)) continue
    await supabase
      .from('site_content')
      .upsert({ artist_id: artistId, key: field.key, value: raw }, { onConflict: 'artist_id,key' })
  }
}

/**
 * Remove a media asset from the working set (a DRAFT deletion). We delete only
 * the registry row, NOT the Storage object: the published site still references
 * it until the manager republishes (deleting is a draft change like any other).
 * Once the next publish tombstones the reference, the object is orphaned —
 * TODO: garbage-collect orphaned objects (e.g. during the publish tombstone
 * step) so they don't accumulate.
 */
export async function deleteMediaAction(mediaId: string, _storagePath: string, artistId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('media').delete().eq('id', mediaId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Add a video by URL: validate + normalize to a safe embed via embedInfo (only
 * YouTube/SoundCloud), derive the provider, then create the draft video. An
 * unrecognized URL is rejected.
 */
export async function addVideoAction(artistId: string, formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  const url = String(formData.get('embed_url') ?? '').trim()
  if (!title || !url) return
  const info = embedInfo(url)
  if (!info) return // not a YouTube/SoundCloud URL — reject

  const supabase = await createClient()
  await createContent(supabase, 'video', artistId, {
    title,
    provider: info.provider,
    embed_url: info.embedUrl,
  })
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Save (or clear) the artist's YouTube channel id used to import their uploads. */
export async function saveYoutubeChannelAction(artistId: string, formData: FormData) {
  const value = String(formData.get('youtube_channel_id') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ youtube_channel_id: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Pull the artist's YouTube uploads into draft videos. Requires YOUTUBE_API_KEY. */
export async function syncYouTubeAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('youtube_channel_id')
    .eq('id', artistId)
    .single()
  if (!artist?.youtube_channel_id) return

  const client = createYouTubeClient()
  const videos = await client.getChannelVideos(artist.youtube_channel_id)
  await syncYouTubeVideos(supabase, artistId, videos)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

type ReleaseLink = { label: string; url: string }

/** Create a release (draft). DSP links are added separately. */
export async function addReleaseAction(artistId: string, formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return
  const slug = slugify(title)
  if (!slug) return
  const release_date = String(formData.get('release_date') ?? '').trim() || null
  const coverRaw = String(formData.get('cover_url') ?? '').trim()
  const cover_url = coverRaw ? (safeHref(coverRaw) ?? null) : null

  const supabase = await createClient()
  // unique(artist_id, slug): on a title collision, suffix the slug rather than
  // surfacing a raw 23505 to the manager.
  const { data: existing } = await supabase
    .from('releases')
    .select('slug')
    .eq('artist_id', artistId)
    .like('slug', `${slug}%`)
  const taken = new Set((existing ?? []).map((r) => r.slug as string))
  let finalSlug = slug
  for (let n = 2; taken.has(finalSlug); n++) finalSlug = `${slug}-${n}`

  await createContent(supabase, 'release', artistId, {
    title,
    slug: finalSlug,
    release_date,
    cover_url,
    release_type: toReleaseType(String(formData.get('release_type') ?? '')),
    links: [],
  })
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Set a release's type (album/single/ep/featured). RLS scopes the update. */
export async function setReleaseTypeAction(releaseId: string, artistId: string, formData: FormData) {
  const release_type = toReleaseType(String(formData.get('release_type') ?? ''))
  const supabase = await createClient()
  await supabase.from('releases').update({ release_type }).eq('id', releaseId)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Assign a track to a release (empty = unassign). RLS scopes the update. */
export async function setTrackReleaseAction(trackId: string, artistId: string, formData: FormData) {
  const release_id = String(formData.get('release_id') ?? '').trim() || null
  const supabase = await createClient()
  await supabase.from('tracks').update({ release_id }).eq('id', trackId)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Append a DSP link to a release (url sanitized; RLS scopes to the owner). */
export async function addReleaseLinkAction(releaseId: string, artistId: string, formData: FormData) {
  const label = String(formData.get('label') ?? '').trim()
  const url = safeHref(String(formData.get('url') ?? '').trim())
  if (!label || !url) return
  const supabase = await createClient()
  const { data: rel } = await supabase.from('releases').select('links').eq('id', releaseId).single()
  const links = [...((rel?.links as ReleaseLink[]) ?? []), { label, url }]
  const { error } = await supabase.from('releases').update({ links }).eq('id', releaseId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Remove the DSP link at `index` from a release. */
export async function removeReleaseLinkAction(releaseId: string, index: number, artistId: string) {
  const supabase = await createClient()
  const { data: rel } = await supabase.from('releases').select('links').eq('id', releaseId).single()
  const links = ((rel?.links as ReleaseLink[]) ?? []).filter((_, i) => i !== index)
  const { error } = await supabase.from('releases').update({ links }).eq('id', releaseId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Choose which public-site template this artist's page renders. */
export async function saveTemplateAction(artistId: string, formData: FormData) {
  const template = String(formData.get('template') ?? 'classic')
  const supabase = await createClient()
  const { error } = await supabase.from('artists').update({ template }).eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Rename the artist (the one identity field not editable elsewhere). The handle
 * (slug) is intentionally not editable here — changing it would break the public
 * site URL and every release smart-link. Redirects back to the artist on success.
 */
export async function updateArtistAction(artistId: string, formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Artist name is required.')
  if (name.length > 200) throw new Error('Artist name is too long (max 200 characters).')
  const supabase = await createClient()
  const { error } = await supabase.from('artists').update({ name }).eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
  redirect(`/artists/${artistId}`)
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
  revalidatePath(`/artists/${artistId}`, 'layout')
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
    .select('spotify_artist_id, catalog_source')
    .eq('id', artistId)
    .single()
  // Only pull when Spotify is the active source — keeps one source per artist.
  if (artist?.catalog_source !== 'spotify' || !artist?.spotify_artist_id) return

  const client = createSpotifyClient()
  const tracks = await client.getDiscographyTracks(artist.spotify_artist_id)
  await syncSpotifyTracks(supabase, artistId, tracks)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Choose the artist's catalog source. Switching deletes the previous importer's
 * working tracks (manual preserved); config applies instantly.
 */
export async function setCatalogSourceAction(artistId: string, formData: FormData) {
  const next = String(formData.get('catalog_source') ?? 'manual') as CatalogSource
  if (!CATALOG_SOURCES.includes(next)) return
  const supabase = await createClient()
  await setCatalogSource(supabase, artistId, next)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Save (or clear) the artist's Deezer artist id used to pull their catalog. */
export async function saveDeezerIdAction(artistId: string, formData: FormData) {
  const value = String(formData.get('deezer_artist_id') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ deezer_artist_id: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Pull the artist's Deezer catalog into draft tracks (metadata + link-out). */
export async function syncDeezerAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('deezer_artist_id, catalog_source')
    .eq('id', artistId)
    .single()
  // Only pull when Deezer is the active source — keeps one source per artist.
  if (artist?.catalog_source !== 'deezer' || !artist?.deezer_artist_id) return

  const client = createDeezerClient()
  const tracks = await client.getArtistTracks(artist.deezer_artist_id)
  await syncDeezerTracks(supabase, artistId, tracks)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Save (or clear) the artist's Apple Music artist id used to pull their catalog. */
export async function saveAppleIdAction(artistId: string, formData: FormData) {
  const value = String(formData.get('apple_artist_id') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ apple_artist_id: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Pull the artist's Apple Music catalog into draft tracks (metadata + link-out). */
export async function syncAppleAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('apple_artist_id, catalog_source')
    .eq('id', artistId)
    .single()
  // Only pull when Apple is the active source — keeps one source per artist.
  if (artist?.catalog_source !== 'apple' || !artist?.apple_artist_id) return

  const client = createAppleMusicClient()
  const tracks = await client.getArtistTracks(artist.apple_artist_id)
  await syncAppleTracks(supabase, artistId, tracks)
  revalidatePath(`/artists/${artistId}`, 'layout')
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
  revalidatePath(`/artists/${artistId}`, 'layout')
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
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Save (or clear) the artist's Ticketmaster attraction id used to pull events. */
export async function saveTicketmasterIdAction(artistId: string, formData: FormData) {
  const value = String(formData.get('ticketmaster_attraction_id') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ ticketmaster_attraction_id: value || null })
    .eq('id', artistId)
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** Pull the artist's Ticketmaster events into draft tour dates (a second source
 *  alongside Bandsintown). Requires TICKETMASTER_API_KEY configured. */
export async function syncTicketmasterAction(artistId: string) {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('ticketmaster_attraction_id')
    .eq('id', artistId)
    .single()
  if (!artist?.ticketmaster_attraction_id) return

  const client = createTicketmasterClient()
  const events = await client.getArtistEvents(artist.ticketmaster_attraction_id)
  await syncTicketmasterTourDates(supabase, artistId, events)
  revalidatePath(`/artists/${artistId}`, 'layout')
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
  revalidatePath(`/artists/${artistId}`, 'layout')
}

export async function disconnectShopifyAction(artistId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('disconnect_shopify', { p_artist_id: artistId })
  if (error) throw new Error(error.message)
  revalidatePath(`/artists/${artistId}`, 'layout')
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
  revalidatePath(`/artists/${artistId}`, 'layout')
}
