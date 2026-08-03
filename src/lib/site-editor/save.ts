/**
 * Write one visual-editor field to the DRAFT. Pure over an injected Supabase
 * client (RLS scopes every write to the caller's tenant), so it's unit-testable
 * without the server-action cookie context — the `saveEditorFieldAction` wrapper
 * adds auth + revalidation. Resolves the field's target from the template manifest
 * (see ./manifest): a `site_content` key (blank clears the override → template
 * default), or an `artist` column (name / bio / hero_image_url). Media fields go
 * through the upload flow, not here yet.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { acceptsValue, fieldsFor, SEO_FIELDS } from '@/lib/site-content-schema'
import { fieldByKey, manifestFor } from '@/lib/site-editor/manifest'
import { mediaUrl } from '@/lib/storage-url'
import { safeHref } from '@/lib/url'

export async function saveEditorField(
  supabase: SupabaseClient,
  artistId: string,
  template: string,
  fieldKey: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const manifest = manifestFor(template)
  const field = manifest ? fieldByKey(manifest, fieldKey) : undefined
  if (!field) return { ok: false, error: 'Unknown field.' }

  const trimmed = value.trim().slice(0, 2000)

  if (field.target.store === 'site_content') {
    const key = field.target.key
    if (trimmed === '') {
      const { error } = await supabase.from('site_content').delete().eq('artist_id', artistId).eq('key', key)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }
    // Reuse the schema's per-field validation (email fields reject junk).
    const scField = fieldsFor(template).find((f) => f.key === key) ?? SEO_FIELDS.find((f) => f.key === key)
    if (scField && !acceptsValue(scField, trimmed)) return { ok: false, error: 'That value looks invalid.' }
    const { error } = await supabase
      .from('site_content')
      .upsert({ artist_id: artistId, key, value: trimmed }, { onConflict: 'artist_id,key' })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  if (field.target.store === 'artist') {
    const { error } = await supabase
      .from('artists')
      .update({ [field.target.column]: trimmed || null })
      .eq('id', artistId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  return { ok: false, error: 'Image editing is coming soon.' }
}

/**
 * Replace (or clear) a single-occupancy IMAGE field from the visual editor — the hero
 * image or the profile photo. `storagePath` is a freshly-uploaded media object, or null
 * to clear the slot. Resolves the field's manifest target:
 *
 *  • artist column (hero_image_url) — store the object's public URL. The hero object is
 *    uploaded OUTSIDE MEDIA_FOLDERS (the `hero` folder), so publish GC can never sweep the
 *    live hero out from under the URL (storage-gc.ts sweeps only referenced-by-row folders).
 *  • media purpose (profile_photo) — single occupancy: drop any existing row of that
 *    purpose, then insert the new one. A media row references the object, so GC keeps it;
 *    the replaced object drops out of `referenced` and the next publish sweeps it.
 *
 * RLS scopes every write to the caller's tenant; the action wrapper adds auth + revalidate.
 */
export async function setImageField(
  supabase: SupabaseClient,
  artistId: string,
  template: string,
  fieldKey: string,
  storagePath: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const manifest = manifestFor(template)
  const field = manifest ? fieldByKey(manifest, fieldKey) : undefined
  if (!field || field.type !== 'image') return { ok: false, error: 'Unknown image field.' }

  if (field.target.store === 'artist') {
    const { error } = await supabase
      .from('artists')
      .update({ [field.target.column]: storagePath ? mediaUrl(storagePath) : null })
      .eq('id', artistId)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  if (field.target.store === 'media') {
    const purpose = field.target.purpose
    // Vacate the purpose first (single occupancy), so a clear is just this delete and a
    // replace can't leave two rows claiming the same slot.
    const del = await supabase.from('media').delete().eq('artist_id', artistId).eq('purpose', purpose)
    if (del.error) return { ok: false, error: del.error.message }
    if (!storagePath) return { ok: true }
    const { error } = await supabase.from('media').insert({
      artist_id: artistId,
      purpose,
      storage_path: storagePath,
      on_site: true,
      sort_order: Math.floor(Date.now() / 1000),
    })
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  return { ok: false, error: 'That field is not an image.' }
}

/**
 * Clean the class-name TEXT a manager typed for a region. Returns the cleaned
 * string, or null if it holds characters that don't belong in a class attribute
 * (reject — don't silently mangle). '' (empty/whitespace) is valid: it clears the
 * override so the region falls back to its base classes.
 */
export function cleanClassText(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (trimmed.length > 500) return null
  // Tailwind-safe: letters/digits/space + the punctuation utilities use, including
  // arbitrary values `text-[clamp(3rem,12vw,11rem)]` and variants `hover:` `sm:` `!`.
  if (!/^[A-Za-z0-9 _:/.,%#!\[\]()@-]+$/.test(trimmed)) return null
  return trimmed
}

/** A region key is a manifest style-region key ('hero_wordmark') or a per-item key
 *  '<slot>:<id>' (D-E) — item ids are UUIDs, so hyphens are allowed after the colon. */
// A region key is a bare identifier (`hero_wordmark`) or a prefixed per-item key
// (`image:<uuid>`, `slot:polaroid_1_photo`, `videos:abc-123`). The segment after the colon
// allows underscores too — component slot roles (`polaroid_1_photo`) carry them, and
// rejecting those made the per-item editor report "save failed" on every slot.
function isRegionKey(key: string): boolean {
  return key.length <= 200 && /^[A-Za-z0-9_]+(?::[A-Za-z0-9_-]+)?$/.test(key)
}

/**
 * Write one region's class override to the DRAFT. Pure over an injected Supabase
 * client (RLS scopes the write); the `saveEditorStyleAction` wrapper adds auth +
 * revalidation. Blank clears the row → the region falls back to its base classes.
 *
 * Deliberately does NOT check manifest membership: a custom site's edit-list is
 * posted at runtime (D-D), so we validate the KEY SHAPE and clean the class text
 * instead of resolving against a local manifest.
 */
export async function saveEditorStyle(
  supabase: SupabaseClient,
  artistId: string,
  regionKey: string,
  className: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isRegionKey(regionKey)) return { ok: false, error: 'Unknown region.' }
  const clean = cleanClassText(className)
  if (clean === null) return { ok: false, error: 'That has characters that are not allowed in a class name.' }
  if (clean === '') {
    const { error } = await supabase
      .from('site_styles')
      .delete()
      .eq('artist_id', artistId)
      .eq('region_key', regionKey)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }
  const { error } = await supabase
    .from('site_styles')
    .upsert({ artist_id: artistId, region_key: regionKey, class_names: clean }, { onConflict: 'artist_id,region_key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** A manifest link-region key is a plain identifier ('usb', 'merch'). */
function isLinkKey(key: string): boolean {
  return key.length > 0 && key.length <= 200 && /^[A-Za-z0-9_-]+$/.test(key)
}

/**
 * Bind a manifest link region to a URL (Phase 2): write the artist's `links` row whose
 * `role` equals this key. Pure over an injected Supabase client (RLS-scoped); the
 * `saveEditorLinkAction` wrapper adds auth + revalidation. A blank URL DELETES the row
 * (the button falls back to inert). `label` seeds a NEW row's display label (the manifest
 * label).
 *
 * Read-modify-write rather than upsert on purpose: the (artist_id, role) uniqueness is a
 * PARTIAL index (`WHERE role IS NOT NULL`), which PostgREST's `on_conflict` can't target.
 * Single manager, one row per role, so the RMW race is a non-issue.
 */
export async function saveEditorLink(
  supabase: SupabaseClient,
  artistId: string,
  key: string,
  url: string,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isLinkKey(key)) return { ok: false, error: 'Unknown link.' }
  const trimmed = url.trim()

  if (trimmed === '') {
    const { error } = await supabase.from('links').delete().eq('artist_id', artistId).eq('role', key)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const clean = safeHref(trimmed)
  if (!clean) return { ok: false, error: 'That URL looks invalid.' }

  const { data: existing, error: readErr } = await supabase
    .from('links')
    .select('id')
    .eq('artist_id', artistId)
    .eq('role', key)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }

  if (existing) {
    const { error } = await supabase.from('links').update({ url: clean }).eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const { error } = await supabase
    .from('links')
    .insert({ artist_id: artistId, role: key, url: clean, label: (label || key).slice(0, 200), on_site: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
