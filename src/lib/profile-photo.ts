/**
 * THE PROFILE PHOTO (PROFILE_TOOL_PLAN.md, Sam 2026-10-02): "one main profile photo that the user
 * selects … from those images or upload one". The site, the press kit, the AllMusic bio email and
 * the outside-bios nudge all read it.
 *
 * It is ONE `media` row with purpose `profile_photo` (20260624140000): no new column, so publishing
 * (the Site / SEO Publish carries it, SITE_MEDIA_SLICE), the public payload and storage GC all
 * already know it. It is a DRAFT like every media row: the live site reads it from the published
 * snapshot, so a change shows after Publish.
 *
 * Three doors write it, all through `setProfilePhoto`, so they write the same record: the Profile
 * page (a pick from Images, or an upload that lands in Images first), the Site & profile page's
 * upload (template sites) and the editor's image tile (setImageField's media branch).
 *
 * A PICK SHARES THE LIBRARY PHOTO'S FILE: the profile row names the same storage path as the
 * Images row, no copy. So deleting either row must not take the file while the other names it;
 * that is storage-gc.ts's `stillNamed`. Re-picking the same image changes nothing (no write), and
 * the nudge compares by file, so neither counts as a new photo.
 *
 * Pure over an injected client: RLS scopes every write to the caller's tenant, and the actions
 * add the owner check and the revalidate.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnedStoragePath } from '@/lib/upload'

export const PROFILE_PHOTO = 'profile_photo' as const

/** The Images library's rows (the Images page lists exactly these). */
const LIBRARY = 'gallery_image'

export type ProfilePhotoResult = { ok: boolean; error?: string }

/**
 * Put a file in the profile photo slot, or clear it with `null`. Vacate-then-insert, the shape
 * `setBrandAsset` and the editor share: a clear is just the delete, and a replace cannot leave two
 * rows claiming the slot, even when old pages left two behind (the Site page's uploader once only
 * inserted). The replaced row's file is not removed here: it may be the live photo, or a library
 * photo's file; the publish-time sweep knows which (storage-gc.ts).
 */
export async function setProfilePhoto(supabase: SupabaseClient, artistId: string, storagePath: string | null): Promise<ProfilePhotoResult> {
  // The path comes from the browser on the upload doors: it must be this artist's own file.
  if (storagePath !== null && !isOwnedStoragePath(artistId, storagePath)) return { ok: false, error: 'That file location is not valid.' }
  const del = await supabase.from('media').delete().eq('artist_id', artistId).eq('purpose', PROFILE_PHOTO)
  if (del.error) return { ok: false, error: del.error.message }
  if (!storagePath) return { ok: true }
  const { error } = await supabase.from('media').insert({
    artist_id: artistId,
    purpose: PROFILE_PHOTO,
    storage_path: storagePath,
    on_site: true,
    sort_order: Math.floor(Date.now() / 1000),
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Make one of the artist's Images the profile photo, by its media id. The file is read from the
 * library row on the server, scoped by id AND artist AND purpose, so the browser names a photo,
 * never a path: another artist's photo, or a logo, is "not in Images".
 *
 * The photo already in the slot is left alone: a new row with the same file is a change for the
 * Publish bar to count that changes nothing.
 */
export async function setProfilePhotoFromImage(supabase: SupabaseClient, artistId: string, mediaId: string): Promise<ProfilePhotoResult> {
  const { data, error } = await supabase
    .from('media')
    .select('storage_path')
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .eq('purpose', LIBRARY)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  const path = (data as { storage_path?: unknown } | null)?.storage_path
  if (typeof path !== 'string' || !path) return { ok: false, error: 'That photo is not in Images.' }

  const now = await supabase.from('media').select('storage_path').eq('artist_id', artistId).eq('purpose', PROFILE_PHOTO)
  const current = ((now.data ?? []) as { storage_path: string }[]).map((r) => r.storage_path)
  if (!now.error && current.length === 1 && current[0] === path) return { ok: true }
  return setProfilePhoto(supabase, artistId, path)
}
