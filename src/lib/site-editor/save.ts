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
function isRegionKey(key: string): boolean {
  return key.length <= 200 && /^[A-Za-z0-9_]+(?::[A-Za-z0-9-]+)?$/.test(key)
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
