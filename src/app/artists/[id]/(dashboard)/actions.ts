'use server'

import { MEDIA_KINDS } from '@samfox1/site-bridge/payload'
import { renameMedia } from '@/lib/media-rename'
import { artistFactUpdate } from '@/lib/artist-facts'

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
import { callerOwns } from './_owns'
import { gcVideoObjects, gcDeletedVideoObject, gcMediaObjects, gcDeletedMediaObject, gcDeletedAudioObject, gcFontObjects } from '@/lib/storage-gc'
import { reorderGallery } from '@/lib/site-editor/gallery'
import { placeInSlot } from '@/lib/site-editor/slots'
import {
  type CrudEntity,
  type GenericEntity,
  type LiveToggleKind,
  type LiveTogglePublishable,
  type PublishableEntity,
  type UnpublishedDiff,
  LIVE_TOGGLE,
  PUBLISHABLE,
  createContent,
  deleteContent,
  diffUnpublished,
  publishAll,
  publishContent,
  publishProfile,
  reconcileOnSite,
  restoreToPublished,
  listPublishMoments,
  type PublishMoment,
  type OnSiteEntity,
  setSupportUrl,
  updateContent,
} from '@/lib/content'
import { acceptsValue, fieldsFor, SEO_FIELDS, type SiteContentField } from '@/lib/site-content-schema'
import { saveCursorField, saveEditorField, saveEditorLink, saveEditorStyle, saveSeoField, setImageField, type ImageFieldTarget } from '@/lib/site-editor/save'
import { linkAddError } from '@/lib/site-editor/link-vocabulary'
import { isCustom } from '@/lib/custom-site'
import { embedInfo } from '@/lib/embed'
import { resolveVideo } from '@/lib/video'
import { fetchOpenGraph } from '@/lib/og'
import { createYouTubeClient } from '@/lib/youtube'
import { extractFields, extractUpdate } from '@/lib/content-form'
import { safeHref } from '@/lib/url'
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

export async function addContentAction(
  type: GenericEntity,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const input = extractFields(type, formData)
  if (Object.keys(input).length === 0) return { error: 'Fill in at least one field.' }
  const supabase = await createClient()

  // A LINK's label is the ADDRESS a connected site maps its mark by, so it must name a
  // platform we know and must not repeat. Checked HERE — the user-facing door both the
  // editor's picker and the /links page form come through — rather than in
  // `createContent`, which is also how fixtures and sync write rows (see
  // lib/site-editor/link-vocabulary.ts for why that distinction matters).
  if (type === 'link') {
    const { data: rows, error: readErr } = await supabase.from('links').select('label').eq('artist_id', artistId)
    if (readErr) return { error: readErr.message }
    const problem = linkAddError(
      (rows ?? []).map((r) => r.label as string),
      typeof input.label === 'string' ? input.label : '',
      typeof input.url === 'string' ? input.url : '',
    )
    if (problem) return { error: problem }
  }

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
  // Grab an uploaded object's path BEFORE the row is gone — the row is the only thing
  // that knows it, and after the delete the object would be unfindable forever.
  let videoPath: string | null = null
  if (type === 'video') {
    const { data } = await supabase.from('videos').select('storage_path').eq('id', id).single()
    videoPath = (data?.storage_path as string | null) ?? null
  }
  let audioPath: string | null = null
  if (type === 'track') {
    const { data } = await supabase.from('tracks').select('audio_path').eq('id', id).single()
    audioPath = (data?.audio_path as string | null) ?? null
  }
  try {
    await deleteContent(supabase, type, id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Delete failed.' }
  }
  // GC only AFTER a successful delete, and both collectors swallow their own failures:
  // a storage hiccup must never cost the row delete — a leaked object is recoverable,
  // a half-failed delete confuses the manager into deleting twice.
  if (type === 'video') await gcDeletedVideoObject(supabase, id, videoPath)
  if (type === 'track') await gcDeletedAudioObject(supabase, id, audioPath)
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
  await gcFontObjects(supabase, artistId) // …and fonts (safe: keeps anything a live revision names)
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
  // Through the SEO gate, key by key — the same rules the Site tab enforces (caps, https
  // social image, the about placement enum). This page bypassed them on day one.
  for (const field of SEO_FIELDS) {
    if (!formData.has(field.key)) continue
    await saveSeoField(supabase, artistId, field.key, String(formData.get(field.key) ?? ''))
  }
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
 *
 * A CUSTOM site is passed `template: null`, because its `template` column is vestigial:
 * `artists_template_check` allows only 'classic'/'cinematic', so a custom artist (skeen
 * is 'cinematic' + site_kind='custom') still resolves a built-in manifest — one that
 * describes a site nobody is looking at. Every save of one of the site's OWN fields then
 * came back 'Unknown field.'
 */
export async function saveEditorFieldAction(
  artistId: string,
  fieldKey: string,
  value: string,
  /** A custom site's declared target for this field. VALIDATED, never trusted: only
   *  the two artist text columns are honoured (the image columns have their own
   *  action). Absent → site_content by key, the historic path. */
  target?: { store: 'artist'; column: 'name' | 'bio' },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase
    .from('artists')
    .select('template, site_kind, custom_site_url')
    .eq('id', artistId)
    .single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  const template = isCustom(artist) ? null : (artist.template as string)
  const res = await saveEditorField(supabase, artistId, template, fieldKey, value, target)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/**
 * Save one site-wide cursor setting from the editor's Site panel (cursor image, click
 * image, trail style, trail color). Auth + owner-scoped like every editor save; the
 * value gate lives in saveCursorField (an https URL / known trail / hex, or blank to
 * clear). Site-kind-agnostic: the keys are plain site_content, inert on a template
 * that never reads them.
 */
export async function saveCursorFieldAction(
  artistId: string,
  key: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select('id').eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  const res = await saveCursorField(supabase, artistId, key, value)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/**
 * Replace (or clear) a single-occupancy image field from the editor's Images panel — the
 * hero image / profile photo. `storagePath` is a just-uploaded media object, or null to
 * clear. The upload happens client-side (useStorageUpload → the `media` bucket); this
 * persists it. Auth + owner gate, then setImageField routes by the field's manifest target.
 */
export async function setImageFieldAction(
  artistId: string,
  fieldKey: string,
  storagePath: string | null,
  /** Where to write, for a CUSTOM site whose fields no local manifest declares. Validated
   *  against a closed set inside setImageField — passed, not trusted. */
  declaredTarget?: ImageFieldTarget,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase
    .from('artists')
    .select('template, site_kind, custom_site_url')
    .eq('id', artistId)
    .single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  // The same discriminator saveEditorFieldAction uses: a custom artist keeps whatever
  // `template` column it had, so the column alone would resolve the WRONG manifest.
  const template = isCustom(artist) ? null : (artist.template as string)
  const res = await setImageField(supabase, artistId, template, fieldKey, storagePath, declaredTarget)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/**
 * Bind a manifest link region (USB / Merch button) to a URL — Phase 2. Mirrors
 * saveEditorStyleAction: auth + owner gate (the RLS-scoped .single() 404s a non-owner),
 * then persist by role and revalidate. A blank URL clears the link. `label` seeds a new
 * row's display label. The optimistic frame update (`apply-link`) is posted client-side.
 */
export async function saveEditorLinkAction(
  artistId: string,
  key: string,
  url: string,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select('id').eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  const res = await saveEditorLink(supabase, artistId, key, url, label)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/** Save one region's class-name override to the draft. Mirrors saveEditorFieldAction:
 *  auth + owner gate (the RLS-scoped .single() 404s a non-owner), then revalidate. */
export async function saveEditorStyleAction(
  artistId: string,
  regionKey: string,
  className: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select('id').eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  const res = await saveEditorStyle(supabase, artistId, regionKey, className)
  if (res.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return res
}

/**
 * "Undo changes": put the draft back to the last published version, for everything the
 * site editor owns (Sam, 2026-08-14).
 *
 * DESTRUCTIVE, and deliberately so — that is the whole feature. The UI confirms first.
 * The caller's own client is used, never the service role, so RLS scopes every statement
 * to an artist this user actually manages; the owner gate below is the same one every
 * editor action uses, and 404s a non-owner before anything is written.
 */
export async function listPublishMomentsAction(
  artistId: string,
): Promise<{ ok: boolean; moments?: PublishMoment[]; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  try {
    return { ok: true, moments: await listPublishMoments(supabase, artistId) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the history.' }
  }
}

export async function restorePublishedAction(
  artistId: string,
  /** Which published version to go back to. Omitted = the most recent one. */
  at?: string,
): Promise<{ ok: boolean; error?: string; changed?: number; hasPublished?: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { data: artist } = await supabase.from('artists').select('id').eq('id', artistId).single()
  if (!artist) return { ok: false, error: 'Artist not found.' }

  try {
    const { restored, removed, readded, hasPublished } = await restoreToPublished(supabase, artistId, at)
    revalidatePath(`/artists/${artistId}`, 'layout')
    return { ok: true, changed: restored + removed + readded, hasPublished }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not undo those changes.' }
  }
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
 * Place a gallery photo into a COLLECTION (the editor's Images panel): set its
 * `orientation`, tag which declared pool it fills, AND put it on the site in one write.
 * Photos are uploaded as plain assets (orientation null, off-site) elsewhere; the editor
 * is where the manager PICKS one into a grid, which is when both are decided. RLS scopes
 * the write to the caller's tenant.
 *
 * `collection` is validated HERE, not trusted: it is a manifest slot key sent by the
 * browser, and the column's CHECK (20260821120000) would otherwise reject the write with
 * a raw constraint error the manager cannot act on. Omitted keeps the old meaning — the
 * site's first declared collection — so a caller that has no collections still works.
 */
export async function placeGalleryPhotoAction(
  artistId: string,
  photoId: string,
  orientation: 'horizontal' | 'vertical',
  collection?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }
  if (collection !== undefined && !/^[a-z0-9_]{1,64}$/.test(collection)) {
    return { error: 'Unknown photo collection.' }
  }
  const { error } = await supabase
    .from('media')
    .update({ orientation, on_site: true, ...(collection === undefined ? {} : { collection }) })
    .eq('id', photoId)
    .eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Rename one photo — the TITLE a site shows under it (ftbk's desktop icons read
 * `media.label`, 20260820120000). The only editable thing about a piece on a site that
 * locks its look: the art is the artist's, the caption is the manager's (Sam,
 * 2026-08-21). Draft until republished, like any content edit. RLS scopes the write.
 */
/** ONE SEO / GEO setting (SEO_GEO_PLAN B6) — gate in lib/site-editor/save.ts. */
export async function saveSeoFieldAction(
  artistId: string,
  key: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  const r = await saveSeoField(supabase, artistId, key, value)
  if (r.ok) revalidatePath(`/artists/${artistId}`, 'layout')
  return r
}

/** Artist FACTS for the fact sheet (20260826160000): genre, location, schema type. An
 *  allowlist of columns, never a caller-named one. Draft until the profile is published. */
export async function saveArtistFactAction(
  artistId: string,
  column: 'genre' | 'location' | 'schema_type',
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  const upd = artistFactUpdate(column, value)
  if ('error' in upd) return { ok: false, error: upd.error }
  const { error } = await supabase.from('artists').update({ [upd.column]: upd.value }).eq('id', artistId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/** Rename one image's FILE to a descriptive slug (SEO_GEO_PLAN B6b). Copy + row update
 *  in lib/media-rename.ts; the new storage_path comes back so the panel can follow it. */
export async function renameMediaAction(
  artistId: string,
  mediaId: string,
  slug: string,
): Promise<{ error?: string; storage_path?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }
  const r = await renameMedia(supabase, artistId, mediaId, slug)
  if (!r.error) revalidatePath(`/artists/${artistId}`, 'layout')
  return r
}

/** Alt text for one image (SEO_GEO_PLAN B6b). Blank clears it: the site then derives
 *  one from the title or caption rather than shipping an empty description. Capped so a
 *  pasted paragraph cannot become an alt attribute. */
export async function setMediaAltAction(
  artistId: string,
  mediaId: string,
  alt: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const trimmed = alt.trim().slice(0, 300)
  const { error } = await supabase
    .from('media')
    .update({ alt: trimmed || null })
    .eq('id', mediaId)
    .eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** The image's JSON-LD kind (SEO_GEO_PLAN B4b). Checked against the registry here so
 *  the manager gets a message, not the column CHECK's raw constraint error. */
export async function setMediaKindAction(
  artistId: string,
  mediaId: string,
  kind: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(MEDIA_KINDS as readonly string[]).includes(kind)) return { error: 'Unknown image type.' }
  const { error } = await supabase
    .from('media')
    .update({ kind })
    .eq('id', mediaId)
    .eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function setMediaLabelAction(
  artistId: string,
  mediaId: string,
  label: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  // Blank CLEARS it (the site falls back to its own default name) rather than storing
  // an empty string that renders as a caption-shaped hole.
  const trimmed = label.trim()
  const { error } = await supabase
    .from('media')
    .update({ label: trimmed || null })
    .eq('id', mediaId)
    .eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Toggle whether one asset is ON THE SITE (presence) — writes the `on_site` flag, live
 * (ADR 0009; the registry and the rules are in `LIVE_TOGGLE`, lib/content.ts). An asset
 * is on the public site only when toggled on AND published: toggling a row that has
 * never been published does nothing, because the doors read the published snapshot and
 * gate it on this working row. RLS scopes the write to the caller's tenant.
 */
export async function setOnSiteAction(
  kind: LiveToggleKind,
  id: string,
  artistId: string,
  onSite: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const table = PUBLISHABLE[LIVE_TOGGLE[kind]].table
  const { error } = await supabase.from(table).update({ on_site: onSite }).eq('id', id).eq('artist_id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Set (or clear) the outbound link for ONE support act on a tour date — the editor's
 * Links panel ("Tour support" group). The act name comes from the date's `support`
 * list; this writes the parallel `support_urls` map so "+ Gudfella" can link out
 * without touching the name list. A blank/invalid URL clears the link. Draft until the
 * Tour section is republished, like any content edit. RLS scopes the write.
 */
export async function setSupportUrlAction(
  artistId: string,
  tourDateId: string,
  name: string,
  url: string,
): Promise<{ error?: string }> {
  const trimmed = String(url ?? '').trim()
  // Blank clears the link; a non-blank value must be a safe http(s)/relative URL, or the
  // save is rejected (never silently dropped) so the panel can't claim "Saved".
  let clean = ''
  if (trimmed !== '') {
    const safe = safeHref(trimmed)
    if (!safe) return { error: 'Enter a valid URL.' }
    clean = safe
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }
  try {
    await setSupportUrl(supabase, artistId, tourDateId, name, clean)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed.' }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Place (or clear) a video in a named background SLOT — the hero landscape/portrait
 * clips (site_role, 20260716200000). One video per slot: assigning a new one first
 * clears whoever holds the role. A placed video is set on_site so it reaches the door
 * (skeen's band skips uploaded videos, so it renders only as the hero); clearing takes
 * it off. Publishing videos still pushes it live, same as the band. RLS-scoped.
 */
/** A component slot name: `<component>_<n>_<slot>` (e.g. `polaroid_3_photo`). Mirrors the
 *  DB CHECK on media.site_role (20260724120000), which constrains SHAPE, not the set of
 *  names — the valid names are the site's manifest to define, not lone-star's. */
const SITE_ROLE_RE = /^[a-z0-9_]{1,64}$/

/**
 * Place a photo into a named component slot (a polaroid's photo or handwriting PNG), or
 * clear the slot when `mediaId` is null.
 *
 * Mirrors assignHeroSlotAction: VACATE first, then fill, so the partial unique index on
 * (artist_id, site_role) can never see two rows claiming one slot. Vacating drops the
 * old photo back to the library (site_role null, off-site) rather than deleting it — the
 * editor never destroys an asset, it only stops using it.
 */
/**
 * Put a set of songs on the site, or take them off — the editor's "project" toggle.
 *
 * Site visibility is a per-SONG boolean (`on_site`), NOT a property of a release
 * (Sam, 2026-07-21). A project is just its songs grouped by album art, so toggling it
 * sets `on_site` on exactly those song ids. `released` (public / unreleased) is a
 * separate library label and is never touched here. The editor already knows which song
 * ids belong to the project (it did the grouping), so the ids come in directly — no
 * release_id, which skeen's catalog does not populate anyway.
 */
export async function setSongsOnSiteAction(
  artistId: string,
  trackIds: string[],
  next: boolean,
): Promise<{ error?: string }> {
  if (trackIds.length === 0) return {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }

  const { error } = await supabase
    .from('tracks')
    .update({ on_site: next })
    .in('id', trackIds)
    .eq('artist_id', artistId)
  if (error) return { error: error.message }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function assignComponentSlotAction(
  artistId: string,
  role: string,
  mediaId: string | null,
): Promise<{ error?: string }> {
  if (!SITE_ROLE_RE.test(role)) return { error: 'That is not a valid slot.' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }

  const res = await placeInSlot(supabase, 'media', artistId, role, mediaId)
  if (res.error) return res
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function assignHeroSlotAction(
  artistId: string,
  role: 'hero_landscape' | 'hero_portrait' | 'bio_background',
  videoId: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const res = await placeInSlot(supabase, 'videos', artistId, role, videoId)
  if (res.error) return res
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
const REORDER_TABLE: Partial<Record<CrudEntity, string>> = {
  link: 'links',
  video: 'videos',
  track: 'tracks',
  // Only the UNDATED shows are draggable; dated ones still sort by date (20260723120000).
  tour_date: 'tour_dates',
  merch: 'merch',
}
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
  // Lock it so a later Spotify Sync (which re-derives type and has no EP/remix) can't revert
  // this deliberate choice.
  const { error } = await supabase
    .from('releases')
    .update({ release_type, release_type_locked: true })
    .eq('id', releaseId)
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
    // Option A: a song's on-site state follows its HOME release. Putting a release on the
    // site turns its tracks on; taking it off turns them off. This is how a freshly-synced
    // song (inserted off-site) becomes public. Orphan tracks (no release_id) are left alone —
    // they carry their own on_site (e.g. a SoundCloud single).
    const { data: allRels, error: relErr } = await supabase
      .from('releases')
      .select('id')
      .eq('artist_id', artistId)
    if (relErr) throw new Error(relErr.message)
    const onSet = new Set(onSiteIds)
    const offIds = (allRels ?? []).map((r) => r.id as string).filter((id) => !onSet.has(id))
    if (onSiteIds.length) {
      const { error } = await supabase
        .from('tracks')
        .update({ on_site: true })
        .eq('artist_id', artistId)
        .in('release_id', onSiteIds)
      if (error) throw new Error(error.message)
    }
    if (offIds.length) {
      const { error } = await supabase
        .from('tracks')
        .update({ on_site: false })
        .eq('artist_id', artistId)
        .in('release_id', offIds)
      if (error) throw new Error(error.message)
    }
    await publishContent(supabase, 'release', artistId, gate.userId)
    await publishContent(supabase, 'track', artistId, gate.userId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Publish failed.' }
  }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/**
 * Publish a PUBLISH-RECONCILED type (merch; releases have their own action) to the
 * public site — PASSWORD-GATED: verify the password, reconcile `on_site` to the
 * selection, snapshot the type's content. `onSiteIds` is the desired on-site set;
 * everything else is taken off the site.
 *
 * Only for types in ON_SITE_ENTITIES. A LIVE-TOGGLE type must use
 * publishEntityAction instead — reconciling one would revert its toggles (ADR 0009).
 */
export async function publishSelectionAction(
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

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { ok: true }
}

/**
 * Publish one content type to the public site — PASSWORD-GATED, snapshot only.
 *
 * No reconcile: for a LIVE-TOGGLE type (video / tour_date) presence is already written
 * directly and is already live, so publishing only pushes the CONTENT — the dates
 * themselves, the venues, the lineups. That split is the point of ADR 0009: the gate
 * guards content reaching the site, not the arrangement of what's already published.
 */
export async function publishEntityAction(
  type: LiveTogglePublishable,
  artistId: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const gate = await verifyPasswordGate(supabase, password)
  if ('error' in gate) return { ok: false, error: gate.error }

  try {
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

/**
 * Set a track's "also appears on" project (`parent_release_id`) — the bigger EP/album a
 * standalone single is also part of. Separate from `release_id` (the track's own home), so a
 * single can live on its own AND show in the album's tracklist. Empty clears it. RLS scopes
 * the write to the owner.
 */
/**
 * Flip a single track on/off the public site directly. This is for ORPHAN songs (no home
 * release) — a song imported from Apple/Deezer with no release has nothing to follow, so it
 * needs its own switch. A track that DOES have a release follows that release's on-site state
 * (reconciled on publish), so the UI only exposes this for orphans. Live, like the video/tour
 * toggles (ADR 0009): the public door reads the working `on_site`. RLS scopes the write.
 */
export async function setTrackOnSiteAction(
  trackId: string,
  artistId: string,
  onSite: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('tracks').update({ on_site: onSite }).eq('id', trackId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Set a SONG's type — single / EP / album / remix / live / featured.
 *
 * A release card has had type chips forever; a song only ever showed a read-only badge,
 * so the type picked at add time was the type for good (Sam, 2026-08-21: "Theres no way
 * to edit the details of the music"). That bit hardest on a STANDALONE song, which has no
 * release row to edit instead — which is how a live set sat filed as a remix.
 *
 * No lock column here, unlike `setReleaseTypeAction`. Sync's own track write is already
 * scoped `.eq('release_type', 'single')` — it only ever promotes songs still sitting at
 * the default — so a song tagged Live or Remix is out of its reach by construction. RLS
 * scopes the write.
 */
export async function setTrackTypeAction(
  trackId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const release_type = toReleaseType(String(formData.get('release_type') ?? ''))
  const supabase = await createClient()
  const { error } = await supabase
    .from('tracks')
    .update({ release_type })
    .eq('id', trackId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

export async function setTrackParentReleaseAction(
  trackId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  let parent_release_id = String(formData.get('parent_release_id') ?? '').trim() || null
  const supabase = await createClient()
  // A song can't "also appear on" its own home release — that would file it twice under one
  // release (double tracklist row + double-counted listens). Clear the parent in that case.
  if (parent_release_id) {
    const { data: t } = await supabase.from('tracks').select('release_id').eq('id', trackId).single()
    if ((t?.release_id ?? null) === parent_release_id) parent_release_id = null
  }
  const { error } = await supabase.from('tracks').update({ parent_release_id }).eq('id', trackId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Set (or clear) a release's DSP link for one platform `label`. This is the whole
 * link lifecycle in one call: an empty url REMOVES that platform's link, a non-empty
 * url REPLACES it (or adds it) — so the editor's per-platform slots just save what's
 * typed and drop what's cleared, with no separate add/remove buttons. RLS scopes to
 * the owner; the url is sanitized.
 */
export async function setReleaseLinkAction(
  releaseId: string,
  artistId: string,
  label: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const trimmedLabel = label.trim()
  if (!trimmedLabel) return { error: 'Missing platform.' }
  const raw = String(formData.get('url') ?? '').trim()
  let url = ''
  if (raw) {
    const safe = safeHref(raw)
    if (!safe) return { error: 'Enter a valid URL.' }
    url = safe
  }
  const supabase = await createClient()
  // Atomic filter-and-append in one UPDATE (the DB function reads the row's CURRENT links),
  // so two quick blurs on different slots can't clobber each other. An empty url clears it.
  const { error } = await supabase.rpc('set_release_link', {
    p_release_id: releaseId,
    p_label: trimmedLabel,
    p_url: url,
  })
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Edit a release's own details (title + date) from the editor modal. The slug stays
 * fixed on purpose — changing it would break the public release URL and every smart
 * link (same rule as the artist handle). RLS scopes the write to the owner.
 */
export async function updateReleaseDetailsAction(
  releaseId: string,
  artistId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'Give the release a title.' }
  const rawDate = String(formData.get('release_date') ?? '').trim()
  const supabase = await createClient()
  const { error } = await supabase
    .from('releases')
    .update({ title: title.slice(0, 200), release_date: rawDate || null })
    .eq('id', releaseId)
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

/**
 * The Music page's "Sync": pull from EVERY connected music service in one click, so a
 * catalog scattered across platforms lands in one place. Runs Spotify FIRST (it's the only
 * source that creates releases + links tracks), then Apple and Deezer, which MERGE their
 * links onto the union rows by title (see lib/sync.ts syncTracks). Only runs the services
 * the artist has actually linked; reports each service's error but doesn't abort the rest.
 */
export async function refreshMusicAction(artistId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: artist } = await supabase
    .from('artists')
    .select('spotify_artist_id, apple_artist_id, deezer_artist_id')
    .eq('id', artistId)
    .single()

  const jobs: { name: string; connected: boolean; run: () => Promise<{ ok: boolean; error?: string }> }[] = [
    { name: 'Spotify', connected: !!artist?.spotify_artist_id, run: () => pullSpotify(artistId) },
    { name: 'Apple Music', connected: !!artist?.apple_artist_id, run: () => syncAppleAction(artistId) },
    { name: 'Deezer', connected: !!artist?.deezer_artist_id, run: () => syncDeezerAction(artistId) },
  ]
  const connected = jobs.filter((j) => j.connected)
  if (connected.length === 0) return { ok: false, error: 'No music services connected yet. Add them in Integrations.' }

  const errors: string[] = []
  for (const j of connected) {
    const res = await j.run()
    if (!res.ok && res.error) errors.push(`${j.name}: ${res.error}`)
  }
  return errors.length ? { ok: false, error: errors.join(' · ') } : { ok: true }
}

/** Save (or clear) the artist's Deezer artist id used to pull their catalog. */
export async function saveDeezerIdAction(artistId: string, formData: FormData) {
  return saveArtistField(artistId, 'deezer_artist_id', formData)
}

/**
 * Save (or clear) the artist's SoundCloud PROFILE url. SoundCloud can't auto-sync (no usable
 * catalog API), so this is just captured/validated for the public social link and manual
 * reference — not a pull source. Empty clears it.
 */
export async function saveSoundcloudUrlAction(artistId: string, formData: FormData): Promise<{ error?: string }> {
  const raw = String(formData.get('soundcloud_url') ?? '').trim()
  let value: string | null = null
  if (raw) {
    const safe = safeHref(raw)
    if (!safe) return { error: 'Enter a valid SoundCloud URL.' }
    value = safe
  }
  const supabase = await createClient()
  const { error } = await supabase.from('artists').update({ soundcloud_url: value }).eq('id', artistId)
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
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
  // The write underneath is an RLS-scoped UPDATE, which matches zero rows for a
  // non-manager and returns NO error — so without this the action answers `{}` and a
  // rejected save is indistinguishable from a successful one. Same wording as
  // driveFolderFor, so every Drive action fails the same way. See _owns.ts.
  if (!(await callerOwns(await createClient(), artistId))) return { error: 'Artist not found.' }
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
