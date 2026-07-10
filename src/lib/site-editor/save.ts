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
