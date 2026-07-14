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
import { createClient as createSbClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { gcVideoObjects, gcDeletedVideoObject, gcMediaObjects, gcDeletedMediaObject } from '@/lib/storage-gc'
import { reorderGallery } from '@/lib/site-editor/gallery'
import {
  type CrudEntity,
  type GenericEntity,
  type PublishableEntity,
  type UnpublishedDiff,
  CRUD,
  createContent,
  deleteContent,
  diffUnpublished,
  publishAll,
  publishContent,
  publishProfile,
  reconcileOnSite,
  type OnSiteEntity,
  updateContent,
} from '@/lib/content'
import { acceptsValue, fieldsFor, SEO_FIELDS, type SiteContentField } from '@/lib/site-content-schema'
import { saveEditorField } from '@/lib/site-editor/save'
import { embedInfo } from '@/lib/embed'
import { resolveVideo } from '@/lib/video'
import { fetchOpenGraph } from '@/lib/og'
import { createYouTubeClient } from '@/lib/youtube'
import { isUrlField, safeHref } from '@/lib/url'
import { toReleaseType } from '@/lib/releases'
import { slugify } from '@/lib/slug'
import { createSpotifyClient } from '@/lib/spotify'
import { createDeezerClient } from '@/lib/deezer'
import { createAppleMusicClient } from '@/lib/apple'
import { createBandsintownClient } from '@/lib/bandsintown'
import { createTicketmasterClient } from '@/lib/ticketmaster'
import { createShopifyClient } from '@/lib/shopify'
import { createDriveClient, parseDriveFolderId, type DriveFile, type DriveKind } from '@/lib/drive'
import { importDriveFile } from '@/lib/drive-import'
import { resolveStreamingSong, type ResolvedSong, type StreamingUrls } from '@/lib/song-links'
import {
  syncAppleTracks,
  syncBandsintownTourDates,
  syncDeezerTracks,
  syncShopifyMerch,
  syncSpotifyReleases,
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
): Promise<{ error?: string }> {
  const input = extractFields(type, formData)
  if (Object.keys(input).length === 0) return { error: 'Fill in at least one field.' }
  const supabase = await createClient()
  try {
    await createContent(supabase, type, artistId, input)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Add failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function updateContentAction(
  type: GenericEntity,
  id: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const input = extractUpdate(type, formData)
  if (Object.keys(input).length === 0) return {}
  const supabase = await createClient()
  try {
    await updateContent(supabase, type, id, input)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Rename a video (title only) — the 3-dots "Rename". Draft until republished, like any
 *  edit. Returns an error for the client to toast. */
export async function renameVideoAction(id: string, artistId: string, title: string): Promise<{ error?: string }> {
  const t = title.trim()
  if (!t) return { error: 'Give the video a title.' }
  const supabase = await createClient()
  const { error } = await supabase.from('videos').update({ title: t.slice(0, 120) }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function deleteContentAction(
  type: CrudEntity,
  id: string,
  artistId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  // Grab an uploaded video's object path before the row is gone, so we can clean it up.
  let videoPath: string | null = null
  if (type === 'video') {
    const { data } = await supabase.from('videos').select('storage_path').eq('id', id).single()
    videoPath = (data?.storage_path as string | null) ?? null
  }
  try {
    await deleteContent(supabase, type, id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Delete failed.' }
  }
  if (type === 'video') await gcDeletedVideoObject(supabase, id, videoPath)
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function publishAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishAll(supabase, artistId, user?.id)
  await gcVideoObjects(supabase, artistId) // publishAll includes videos → collect orphans
  await gcMediaObjects(supabase, artistId) // …and gallery media
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/** The visual editor's review window: what has changed since the last publish, per
 *  section (counts). RLS scopes the read to the caller's tenant. */
export async function getUnpublishedDiffAction(artistId: string): Promise<UnpublishedDiff> {
  const supabase = await createClient()
  return diffUnpublished(supabase, artistId)
}

/**
 * Publish EVERYTHING pending from the visual editor — PASSWORD-GATED. Verifies the
 * manager's password, then snapshots all content + the profile (`publishAll`, which
 * orders the profile last for the live-gate invariant) and GCs orphaned video
 * objects. Returns an error string instead of throwing so the client shows it inline.
 */
export async function publishAllGatedAction(
  artistId: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const gate = await verifyPasswordGate(supabase, password)
  if ('error' in gate) return { ok: false, error: gate.error }
  try {
    await publishAll(supabase, artistId, gate.userId)
    await gcVideoObjects(supabase, artistId)
    await gcMediaObjects(supabase, artistId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Publish failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Publish ONE content/media section (per-section Publish button). Returns an
 *  error string for the client to toast instead of throwing. */
export async function publishSectionAction(
  type: PublishableEntity,
  artistId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  try {
    await publishContent(supabase, type, artistId, user?.id)
    if (type === 'video') await gcVideoObjects(supabase, artistId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Publish failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
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
  await gcMediaObjects(supabase, artistId) // deleted-photo revisions are now tombstoned → sweep orphans
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
 * Save one editable field from the visual editor to the DRAFT. Resolves the field's
 * target from the artist's template manifest (see lib/site-editor) and writes it: a
 * `site_content` key (blank clears the override → template default), or an `artist`
 * column (name / bio / hero_image_url). Media (image/video) fields are handled by the
 * upload flow, not here yet. Signed-in + RLS-scoped; draft-only until the next publish.
 */
export async function saveEditorFieldAction(
  artistId: string,
  fieldKey: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select('template').eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  const res = await saveEditorField(supabase, artistId, artist.template as string, fieldKey, value)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/**
 * Remove a media asset from the working set (a DRAFT deletion). We delete only the
 * registry row; the Storage object is destroyed ONLY if the media was never published
 * (`gcDeletedMediaObject`). A published photo is served on the live site from its
 * revision SNAPSHOT until the next publish tombstones it, so its object must survive
 * until then — deleting it eagerly would 404 the live site and lose the file
 * irrecoverably. The next publish's `gcMediaObjects` sweeps the orphan.
 */
export async function deleteMediaAction(
  mediaId: string,
  storagePath: string,
  artistId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('media').delete().eq('id', mediaId)
  if (error) return { error: error.message }
  await gcDeletedMediaObject(supabase, mediaId, storagePath)
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Toggle whether one asset is ON THE SITE (presence) from the visual editor — writes the
 * `on_site` flag. An asset is on the public site only when selected AND published; being
 * in the library (Assets) never implies on-site. RLS scopes the write to the caller's
 * tenant. `kind` maps to the owning table.
 */
const ON_SITE_TABLE = { photo: 'media', track: 'tracks', video: 'videos', merch: 'merch', link: 'links' } as const
export async function setOnSiteAction(
  kind: keyof typeof ON_SITE_TABLE,
  id: string,
  artistId: string,
  onSite: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from(ON_SITE_TABLE[kind]).update({ on_site: onSite }).eq('id', id).eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Persist a new gallery order from the visual editor: `orderedIds` is the media ids
 * in their new order; each row's `sort_order` becomes its index. RLS-scoped.
 */
export async function reorderGalleryAction(
  artistId: string,
  orderedIds: string[],
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const res = await reorderGallery(supabase, artistId, orderedIds)
  if (!res.ok) return { error: res.error }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Persist a new order for a CRUD content type (links/videos/songs) from the visual
 * editor: each row's `sort_order` becomes its index, ATOMICALLY via the `reorder_rows`
 * RPC (one statement, all-or-nothing). RLS scopes every write to the caller's tenant.
 */
const REORDER_TABLE: Partial<Record<CrudEntity, string>> = { link: 'links', video: 'videos', track: 'tracks' }
export async function reorderContentAction(
  type: CrudEntity,
  artistId: string,
  orderedIds: string[],
): Promise<{ error?: string }> {
  const table = REORDER_TABLE[type]
  if (!table) return { error: `Cannot reorder ${type}.` }
  const supabase = await createClient()
  const { error } = await supabase.rpc('reorder_rows', { p_table: table, p_artist: artistId, p_ids: orderedIds })
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Add a video by URL: validate + normalize to a safe embed via embedInfo (only
 * YouTube/SoundCloud), derive the provider, then create the draft video. An
 * unrecognized URL is rejected.
 */
export async function addVideoAction(artistId: string, formData: FormData): Promise<{ error: string } | void> {
  const title = String(formData.get('title') ?? '').trim()
  const url = String(formData.get('embed_url') ?? '').trim()
  if (!title) return { error: 'Give the video a title.' }
  if (!url) return { error: 'Paste a YouTube link.' }
  const info = embedInfo(url)
  if (!info || info.provider !== 'youtube') return { error: "That's not a YouTube link. Videos added by URL must be from YouTube (or use Upload for a file)." }

  const supabase = await createClient()
  await createContent(supabase, 'video', artistId, {
    title,
    provider: info.provider,
    embed_url: info.embedUrl,
    is_short: info.isShort ?? false,
  })
  revalidatePath(`/artists/${artistId}`, 'layout')
}

/**
 * Auto-detect a video from a pasted URL (the modal's Automatic mode): safe embed URL
 * via embedInfo + title/thumbnail from the provider's public oEmbed. Signed-in only,
 * so it isn't an open fetch proxy. Returns data (or an error) for the client to show.
 */
export async function resolveVideoUrlAction(
  url: string,
): Promise<
  | { ok: true; title: string; provider: string; embed_url: string; thumbnail: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const meta = await resolveVideo(String(url ?? '').trim())
  if (!meta || meta.provider !== 'youtube') return { ok: false, error: 'Paste a YouTube link.' }
  return { ok: true, ...meta }
}

/**
 * Scrape a product URL's Open-Graph tags (the merch modal's Automatic mode) so the
 * fields prefill. Signed-in only; the fetch is SSRF-guarded in fetchOpenGraph (public
 * http(s) hosts only). Returns whatever it could read, or an error.
 */
export async function scrapeMerchUrlAction(
  url: string,
): Promise<
  | { ok: true; title: string | null; image_url: string | null; price: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const og = await fetchOpenGraph(String(url ?? '').trim())
  if (!og || (!og.title && !og.image)) return { ok: false, error: 'Could not read that link.' }
  return { ok: true, title: og.title, image_url: og.image, price: og.price }
}

/**
 * Save (or clear) one artist id/name column from a same-named form field — the
 * shared body of every integration "Save" (Spotify/YouTube/Deezer/Apple/
 * Bandsintown/Ticketmaster). A blank value clears the column. Returns an error
 * string for the client to toast instead of throwing.
 */
async function saveArtistField(
  artistId: string,
  column: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const value = String(formData.get(column) ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('artists')
    .update({ [column]: value || null })
    .eq('id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Save (or clear) the artist's YouTube channel id used to import their uploads. */
export async function saveYoutubeChannelAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'youtube_channel_id', formData)
}

/** Pull the artist's YouTube uploads into draft videos. Requires YOUTUBE_API_KEY. */
/** Shared pull: import the channel's uploads into draft videos (Shorts classified),
 *  returning status so callers can surface an error. Manual videos are preserved. */
async function pullYouTube(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('youtube_channel_id')
    .eq('id', artistId)
    .single()
  if (!artist?.youtube_channel_id) return { ok: false, error: 'No YouTube channel linked yet.' }

  try {
    const client = createYouTubeClient()
    const videos = await client.getChannelVideos(artist.youtube_channel_id)
    // Global YouTube view counts, cached on each row (ANALYTICS_STATS_PLAN.md).
    const vc = await client.viewCounts(videos.map((v) => v.youtube_id))
    for (const v of videos) v.views = vc.get(v.youtube_id) ?? null
    await syncYouTubeVideos(supabase, artistId, videos)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Integrations "Import uploads". Returns status so the panel can toast. */
export async function syncYouTubeAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  return pullYouTube(artistId)
}

/** Videos-page "Refresh" button: same import, but returns status so the button can
 *  show a spinner and surface any error inline. */
export async function refreshYouTubeAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  return pullYouTube(artistId)
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
export async function setReleaseTypeAction(
  releaseId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const release_type = toReleaseType(String(formData.get('release_type') ?? ''))
  const supabase = await createClient()
  const { error } = await supabase.from('releases').update({ release_type }).eq('id', releaseId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Verify the signed-in manager's password on a THROWAWAY client (no cookie
 * persistence), so a wrong password can't publish and the live session is
 * untouched. Returns the user id on success, or an error string. Shared by every
 * password-gated publish.
 */
async function verifyPasswordGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  password: string,
): Promise<{ userId: string } | { error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Not signed in.' }

  const verifier = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: pwErr } = await verifier.auth.signInWithPassword({ email: user.email, password })
  if (pwErr) return { error: 'Incorrect password.' }
  return { userId: user.id }
}

/**
 * Publish the artist's releases to their public site — PASSWORD-GATED. `onSiteIds`
 * is the full set of releases that should be live; every other release is taken
 * off the site. Flow: verify the password, reconcile each release's `on_site` flag
 * to the selection (RLS-scoped), then snapshot release + track content so
 * newly-live releases and their tracklists render on the site. (Tracks piggyback on
 * the release publish — they belong to a release — so this stays release-specific.)
 * Returns an error string instead of throwing, so the client shows it inline.
 */
export async function publishReleasesAction(
  artistId: string,
  onSiteIds: string[],
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const gate = await verifyPasswordGate(supabase, password)
  if ('error' in gate) return { ok: false, error: gate.error }

  try {
    await reconcileOnSite(supabase, 'release', artistId, onSiteIds)
    await publishContent(supabase, 'release', artistId, gate.userId)
    await publishContent(supabase, 'track', artistId, gate.userId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Publish failed.' }
  }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/**
 * Publish one on-site-gated content type (video / merch / tour_date) to the public
 * site — PASSWORD-GATED, same flow as publishReleasesAction: verify the password,
 * reconcile `on_site` to the selection, snapshot the type's content. `onSiteIds` is
 * the desired on-site set; everything else is taken off the site.
 */
export async function publishEntityAction(
  type: OnSiteEntity,
  artistId: string,
  onSiteIds: string[],
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const gate = await verifyPasswordGate(supabase, password)
  if ('error' in gate) return { ok: false, error: gate.error }

  try {
    await reconcileOnSite(supabase, type, artistId, onSiteIds)
    await publishContent(supabase, type, artistId, gate.userId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Publish failed.' }
  }

  // GC after publish (best-effort): the working rows are now the complete set of
  // still-needed uploaded objects, so drop any orphaned files (deleted/replaced videos).
  if (type === 'video') await gcVideoObjects(supabase, artistId)

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Assign a track to a release (empty = unassign). RLS scopes the update. */
export async function setTrackReleaseAction(
  trackId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const release_id = String(formData.get('release_id') ?? '').trim() || null
  const supabase = await createClient()
  const { error } = await supabase.from('tracks').update({ release_id }).eq('id', trackId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Append a DSP link to a release (url sanitized; RLS scopes to the owner). */
export async function addReleaseLinkAction(
  releaseId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const label = String(formData.get('label') ?? '').trim()
  const url = safeHref(String(formData.get('url') ?? '').trim())
  if (!label || !url) return { error: 'Add a platform name and a valid URL.' }
  const supabase = await createClient()
  const { data: rel } = await supabase.from('releases').select('links').eq('id', releaseId).single()
  const links = [...((rel?.links as ReleaseLink[]) ?? []), { label, url }]
  const { error } = await supabase.from('releases').update({ links }).eq('id', releaseId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Remove the DSP link at `index` from a release. */
export async function removeReleaseLinkAction(
  releaseId: string,
  index: number,
  artistId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: rel } = await supabase.from('releases').select('links').eq('id', releaseId).single()
  const links = ((rel?.links as ReleaseLink[]) ?? []).filter((_, i) => i !== index)
  const { error } = await supabase.from('releases').update({ links }).eq('id', releaseId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
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
  return saveArtistField(artistId, 'spotify_artist_id', formData)
}

/**
 * Pull the artist's Spotify discography — tracks AND releases (albums/EPs/
 * singles). New tracks are drafted and spotify-owned ones refreshed; releases
 * are imported HIDDEN for the manager to toggle on. Manual edits are left
 * untouched (see syncSpotify*). Also the "Refresh from Spotify" button. Requires
 * SPOTIFY_CLIENT_ID/SECRET configured.
 */
/** Shared pull: import the artist's Spotify catalog into draft releases + tracks. */
async function pullSpotify(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: artist } = await supabase
    .from('artists')
    .select('spotify_artist_id')
    .eq('id', artistId)
    .single()
  // Need a linked Spotify artist to pull from.
  if (!artist?.spotify_artist_id) return { ok: false, error: 'No Spotify artist linked yet.' }

  try {
    const client = createSpotifyClient()
    const { tracks, releases } = await client.getDiscography(artist.spotify_artist_id)
    // Tracks first — releases link them by Spotify id.
    await syncSpotifyTracks(supabase, artistId, tracks)
    await syncSpotifyReleases(supabase, artistId, releases)
    // Snapshot a release revision so each imported release has a smart-link ready;
    // `on_site` (false on import) still gates public exposure until a password publish.
    await publishContent(supabase, 'release', artistId, user?.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Refresh failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Integrations "Pull from Spotify". Returns status so the panel can toast. */
export async function syncSpotifyAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  return pullSpotify(artistId)
}

/** Music-page "Refresh" button: same pull, but returns status so the button can
 *  show a spinner and surface any error inline. */
export async function refreshSpotifyAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  return pullSpotify(artistId)
}

/** Save (or clear) the artist's Deezer artist id used to pull their catalog. */
export async function saveDeezerIdAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'deezer_artist_id', formData)
}

/** Pull the artist's Deezer catalog into draft tracks (metadata + link-out). Merges
 *  into the union track set alongside any other connected service. */
export async function syncDeezerAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('deezer_artist_id')
    .eq('id', artistId)
    .single()
  if (!artist?.deezer_artist_id) return { ok: false, error: 'No Deezer artist linked yet.' }

  try {
    const client = createDeezerClient()
    const tracks = await client.getArtistTracks(artist.deezer_artist_id)
    await syncDeezerTracks(supabase, artistId, tracks)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Save (or clear) the artist's Apple Music artist id used to pull their catalog. */
export async function saveAppleIdAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'apple_artist_id', formData)
}

/** Pull the artist's Apple Music catalog into draft tracks (metadata + link-out) via
 *  the free iTunes Search API. Merges into the union track set alongside any other
 *  connected service. */
export async function syncAppleAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('apple_artist_id')
    .eq('id', artistId)
    .single()
  if (!artist?.apple_artist_id) return { ok: false, error: 'No Apple Music artist linked yet.' }

  try {
    const client = createAppleMusicClient()
    const tracks = await client.getArtistTracks(artist.apple_artist_id)
    await syncAppleTracks(supabase, artistId, tracks)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Save (or clear) the artist's Bandsintown name used to pull tour dates. */
export async function saveBandsintownNameAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'bandsintown_name', formData)
}

/**
 * Pull the artist's Bandsintown events and sync them into draft tour dates.
 * Same conflict policy as Spotify. Requires BANDSINTOWN_APP_ID configured.
 */
export async function syncBandsintownAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('bandsintown_name')
    .eq('id', artistId)
    .single()
  if (!artist?.bandsintown_name) return { ok: false, error: 'No Bandsintown artist linked yet.' }

  try {
    const client = createBandsintownClient()
    const events = await client.getArtistEvents(artist.bandsintown_name)
    await syncBandsintownTourDates(supabase, artistId, events)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Save (or clear) the artist's Ticketmaster attraction id used to pull events. */
export async function saveTicketmasterIdAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'ticketmaster_attraction_id', formData)
}

/** Pull the artist's Ticketmaster events into draft tour dates (a second source
 *  alongside Bandsintown). Requires TICKETMASTER_API_KEY configured. */
export async function syncTicketmasterAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('ticketmaster_attraction_id')
    .eq('id', artistId)
    .single()
  if (!artist?.ticketmaster_attraction_id) return { ok: false, error: 'No Ticketmaster attraction linked yet.' }

  try {
    const client = createTicketmasterClient()
    const events = await client.getArtistEvents(artist.ticketmaster_attraction_id)
    await syncTicketmasterTourDates(supabase, artistId, events)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
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

/* ------------------------------------------------------------------------- *
 * Google Drive (public-folder-link model — see lib/drive.ts / lib/drive-import.ts)
 * ------------------------------------------------------------------------- */

/** The artist's connected folder id, or a friendly error. RLS is the authz gate:
 *  a non-manager sees no row at all. */
async function driveFolderFor(artistId: string): Promise<{ folderId: string } | { error: string }> {
  const supabase = await createClient()
  const { data } = await supabase.from('artists').select('drive_folder_id').eq('id', artistId).single()
  if (!data) return { error: 'Artist not found.' }
  if (!data.drive_folder_id)
    return { error: 'No Drive folder linked yet — connect one under Manager tools → Integrations.' }
  return { folderId: data.drive_folder_id as string }
}

/** Save (or clear) the artist's Drive folder — accepts a pasted share link or a bare id. */
export async function saveDriveFolderAction(artistId: string, formData: FormData): Promise<{ error?: string }> {
  const raw = String(formData.get('drive_folder_id') ?? '').trim()
  if (!raw) return saveArtistField(artistId, 'drive_folder_id', formData) // blank clears
  const folderId = parseDriveFolderId(raw)
  if (!folderId) return { error: "That doesn't look like a Google Drive folder link." }
  const fd = new FormData()
  fd.set('drive_folder_id', folderId)
  return saveArtistField(artistId, 'drive_folder_id', fd)
}

/** Verify the folder is reachable (link-shared) and report how much media it holds. */
export async function checkDriveFolderAction(
  artistId: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const folder = await driveFolderFor(artistId)
  if ('error' in folder) return { ok: false, error: folder.error }
  try {
    const drive = createDriveClient()
    await drive.getFolder(folder.folderId)
    const files = await drive.listAllMediaFiles(folder.folderId, 'all')
    return { ok: true, message: `Found ${files.length} media file${files.length === 1 ? '' : 's'}.` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Drive check failed.' }
  }
}

/** One page of the folder's files of a kind, plus which are already imported. */
export async function listDriveFilesAction(
  artistId: string,
  kind: DriveKind,
  pageToken?: string | null,
): Promise<
  | { ok: true; files: DriveFile[]; nextPageToken: string | null; imported: string[] }
  | { ok: false; error: string }
> {
  const folder = await driveFolderFor(artistId)
  if ('error' in folder) return { ok: false, error: folder.error }
  try {
    const drive = createDriveClient()
    await drive.getFolder(folder.folderId) // friendly not-shared error before a silent []
    const { files, nextPageToken } = await drive.listMediaFiles(folder.folderId, kind, pageToken)
    const table = kind === 'audio' ? 'tracks' : kind === 'video' ? 'videos' : 'media'
    const supabase = await createClient()
    const { data } = await supabase
      .from(table)
      .select('drive_file_id')
      .eq('artist_id', artistId)
      .not('drive_file_id', 'is', null)
    const imported = (data ?? []).map((r) => r.drive_file_id as string)
    return { ok: true, files, nextPageToken, imported }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Drive listing failed.' }
  }
}

/** Copy one Drive file into Lone Star (bytes → our bucket, row registered). */
export async function importDriveFileAction(
  artistId: string,
  kind: DriveKind,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  // The client-supplied fileId is interpolated into the Drive API URL before the
  // parents check runs (drive.ts getFileMeta), so pin it to the Drive id charset
  // — same guarantee parseDriveFolderId gives folder ids.
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) return { ok: false, error: 'Invalid Drive file id.' }
  const folder = await driveFolderFor(artistId)
  if ('error' in folder) return { ok: false, error: folder.error }
  const supabase = await createClient()
  try {
    const res = await importDriveFile(supabase as never, createDriveClient(), {
      artistId,
      kind,
      fileId,
      folderId: folder.folderId,
    })
    if ('error' in res) return { ok: false, error: res.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Resolve a song's metadata (title / cover / contributors) from pasted
 *  streaming links — the platform already knows them, so the manager never
 *  types them. Public metadata only; see lib/song-links.ts. */
export async function resolveStreamingSongAction(
  urls: StreamingUrls,
): Promise<{ ok: true; song: ResolvedSong } | { ok: false; error: string }> {
  // Signed-in only, so it isn't an open fetch proxy (mirrors resolveVideoUrlAction
  // / scrapeMerchUrlAction).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  try {
    return { ok: true, song: await resolveStreamingSong(urls) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read those links.' }
  }
}
