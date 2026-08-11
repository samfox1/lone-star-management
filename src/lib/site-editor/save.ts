/**
 * Write one visual-editor field to the DRAFT. Pure over an injected Supabase
 * client (RLS scopes every write to the caller's tenant), so it's unit-testable
 * without the server-action cookie context — the `saveEditorFieldAction` wrapper
 * adds auth + revalidation. Resolves the field's target from the template manifest
 * (see ./manifest): a `site_content` key (blank clears the override → template
 * default), or an `artist` column (name / bio / hero_image_url). Media fields go
 * through the upload flow, not here yet.
 *
 * A CUSTOM site has no local manifest (its edit-list is posted over the bridge at
 * runtime), so its fields take the `saveCustomField` path below instead. Callers say so
 * by passing `template: null` — NOT by passing an unknown template string. A custom-site
 * artist still carries a built-in `template` value (`artists_template_check` allows only
 * 'classic'/'cinematic', and skeen is 'cinematic' + site_kind='custom'), so
 * `manifestFor(row.template)` resolves a manifest that has nothing to do with the site
 * being edited. Deciding custom-ness by "no manifest found" would therefore never fire.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { acceptsValue, CURSOR_KEYS, cursorValueError, fieldsFor, SEO_FIELDS, TEMPLATE_FIELDS } from '@/lib/site-content-schema'
import { fieldByKey, manifestFor } from '@/lib/site-editor/manifest'
import { mediaUrl } from '@/lib/storage-url'
import { isOwnedStoragePath } from '@/lib/upload'
import { safeHref } from '@/lib/url'

/**
 * The `site_content` keys a CUSTOM site's field key may NOT claim.
 *
 * A custom field key is client-supplied text that becomes a site_content key, and a few
 * of those keys are read by features OTHER than the site's own render path — regardless
 * of the artist's template. Left open, a manifest field named `booking_email` would let
 * the Text panel silently re-route the artist's enquiries to any address.
 *
 *  • booking_email — rung 3 of `resolve_booking_recipient` (20260722130000) and the EPK
 *    contact fallback (lib/epk.ts) read it for ANY artist. It takes effect without a
 *    publish, so a bad write is live immediately.
 *  • the SEO keys — lib/seo.ts reads them for every artist's <head>.
 *
 * Every OTHER template key is left available. Those are read only through
 * `fieldValue(content, template, key)` while RENDERING a built-in template, and a custom
 * artist's public route redirects to their own site instead — so a collision is inert.
 * Should they ever revert to a built-in template, a colliding key resurfaces as ordinary
 * editable site text (a heading), which is cosmetic and visible; that is a different
 * class from silently redirecting mail or rewriting <head>.
 *
 * DERIVED, never hand-listed (AGENTS.md rule 4): an email-typed site-text field IS a
 * routing address, so a new one is reserved the day it is added to the schema.
 */
const RESERVED_CONTENT_KEYS = new Set<string>([
  ...SEO_FIELDS.map((f) => f.key),
  ...Object.values(TEMPLATE_FIELDS).flatMap((fields) =>
    fields.filter((f) => f.type === 'email').map((f) => f.key),
  ),
  // Cursor keys carry URLs into a CSS `url()` sink on the site, so they only write
  // through saveCursorField's validator — never as a runtime-manifest text field.
  ...CURSOR_KEYS,
])

/** The shape a CUSTOM site's field key must have to become a site_content key. Mirrors
 *  the DB's own client-supplied-key constraint (`media.site_role ~ '^[a-z0-9_]{1,64}$'`,
 *  20260724120000) so the two agree on what a site may name a region. Lowercase
 *  identifier only: no path, quote, or separator characters can reach the key column. */
function isContentKeyShape(key: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(key)
}

/**
 * Write ONE custom-site field to `site_content` (blank clears the row → the site falls
 * back to whatever it renders for an unset key).
 *
 * Deliberately does NOT check manifest membership, for the same reason `saveEditorStyle`
 * doesn't: a custom site posts its edit-list at RUNTIME over the bridge (D-D), so there
 * is nothing local to resolve the key against. Before this existed, every custom-site
 * text save returned 'Unknown field.' and the Text panel was write-only. The key SHAPE
 * plus the reserved set are what replace manifest membership.
 */
async function saveCustomField(
  supabase: SupabaseClient,
  artistId: string,
  fieldKey: string,
  trimmed: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isContentKeyShape(fieldKey)) return { ok: false, error: 'Unknown field.' }
  if (RESERVED_CONTENT_KEYS.has(fieldKey)) return { ok: false, error: 'That field name is reserved.' }

  if (trimmed === '') {
    // DELETE, not an empty string: storing '' would ship a blank override the site can't
    // tell from a real value, so clearing a caption would never actually clear it.
    const { error } = await supabase.from('site_content').delete().eq('artist_id', artistId).eq('key', fieldKey)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  const { error } = await supabase
    .from('site_content')
    .upsert({ artist_id: artistId, key: fieldKey, value: trimmed }, { onConflict: 'artist_id,key' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Write ONE cursor setting. The only path that can touch a CURSOR_KEYS row: the keys
 * are reserved out of the custom-field path above, and the validator here is the write
 * gate for the CSS `url()` sink — an https URL, a known trail style, or a hex, nothing
 * else persists. Blank deletes the row, same semantics as every other site_content key.
 */
export async function saveCursorField(
  supabase: SupabaseClient,
  artistId: string,
  key: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = value.trim()
  const invalid = cursorValueError(key, trimmed)
  if (invalid) return { ok: false, error: invalid }
  if (trimmed === '') {
    const { error } = await supabase.from('site_content').delete().eq('artist_id', artistId).eq('key', key)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  const { error } = await supabase
    .from('site_content')
    .upsert({ artist_id: artistId, key, value: trimmed }, { onConflict: 'artist_id,key' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function saveEditorField(
  supabase: SupabaseClient,
  artistId: string,
  /** The built-in template whose manifest resolves this field, or NULL for a custom
   *  site, whose manifest the editor only sees at runtime (see the module note). */
  template: string | null,
  fieldKey: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const manifest = template === null ? undefined : manifestFor(template)

  // The 2000-char cap applies to BOTH paths: a caption longer than its strip is invisible
  // on the site but still ships in the HTML of every page load.
  const trimmed = value.trim().slice(0, 2000)

  // A custom site's fields arrive over the bridge, so there is nothing to resolve them
  // against. Route before the membership check, which could only ever refuse them.
  if (!manifest) return saveCustomField(supabase, artistId, fieldKey, trimmed)

  const field = fieldByKey(manifest, fieldKey)
  if (!field) return { ok: false, error: 'Unknown field.' }

  if (field.target.store === 'site_content') {
    const key = field.target.key
    if (trimmed === '') {
      const { error } = await supabase.from('site_content').delete().eq('artist_id', artistId).eq('key', key)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }
    // Reuse the schema's per-field validation (email fields reject junk).
    // `manifest.template`, not the argument: identical for a built-in (manifestFor keys on
    // it) and it keeps the nullable custom-site signal out of the schema lookup.
    const scField = fieldsFor(manifest.template).find((f) => f.key === key) ?? SEO_FIELDS.find((f) => f.key === key)
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

/** The only two homes a single-occupancy image has on the wire. Named as a type so the
 *  validator below and the editor's EditorImageField cannot drift apart. */
export type ImageFieldTarget =
  | { store: 'artist'; column: 'hero_image_url' }
  | { store: 'media'; purpose: 'profile_photo' }

/** A client-supplied target, or null. The union is closed and checked member by member —
 *  an allowlist, so a new store or column added upstream is refused here until someone
 *  decides it should be writable from a cross-origin manifest. */
function validImageTarget(t: ImageFieldTarget | undefined): ImageFieldTarget | null {
  if (!t) return null
  if (t.store === 'artist' && t.column === 'hero_image_url') return { store: 'artist', column: 'hero_image_url' }
  if (t.store === 'media' && t.purpose === 'profile_photo') return { store: 'media', purpose: 'profile_photo' }
  return null
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
 * A CUSTOM site has no local manifest to look the field up in — its images are declared
 * by the frame at runtime — so `template` is null there and the caller passes the target
 * it read from the announced manifest. That target is VALIDATED, never trusted: it must
 * be one of the two single-occupancy homes the wire models, so a crafted request writes
 * nowhere. (Text has had this shape since 2026-08-05, via saveCustomField; images were
 * left behind, so every custom-site upload AND remove failed with "Unknown image field."
 * — found in the 2026-08-09 review, after the panel had started offering the tiles.)
 *
 * RLS scopes every write to the caller's tenant; the action wrapper adds auth + revalidate.
 */
export async function setImageField(
  supabase: SupabaseClient,
  artistId: string,
  /** The built-in template whose manifest declares this field, or null for a custom site. */
  template: string | null,
  fieldKey: string,
  storagePath: string | null,
  /** Where to write, for a CUSTOM site only. Ignored when a manifest resolves the field:
   *  where the server can look the answer up, it does not take the client's word for it. */
  declaredTarget?: ImageFieldTarget,
): Promise<{ ok: boolean; error?: string }> {
  const manifest = template === null ? undefined : manifestFor(template)
  const declared = manifest ? fieldByKey(manifest, fieldKey) : undefined
  const target =
    manifest === undefined ? validImageTarget(declaredTarget) : declared?.type === 'image' ? declared.target : null
  if (!target) return { ok: false, error: 'Unknown image field.' }
  const field = { target } as { target: ImageFieldTarget }

  // Same client-supplied-path guard as setBrandAsset (lib/brand.ts). This is the older of
  // the two write paths and carried the gap first.
  if (storagePath !== null && !isOwnedStoragePath(artistId, storagePath))
    return { ok: false, error: 'That file location is not valid.' }

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
