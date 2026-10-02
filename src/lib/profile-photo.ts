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
 * page (a pick from Images, or an upload that lands in Images first), and the Site & profile page's
 * and the editor's uploads, which also land in Images first and then pick that photo
 * (profile-photo-uploader.tsx), so a replaced photo can always be picked again. The editor's
 * Remove clears it through setImageField's media branch.
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
 * Put a file in the profile photo slot, or clear it with `null`.
 *
 * INSERT FIRST, THEN DELETE THE OTHERS (review of d558c8e, 2026-10-02). It used to vacate the slot
 * and then insert, so an insert that failed left the draft with NO photo: an upload then removed
 * its new file (performUpload), and the next Publish took the live photo off the site with the old
 * file left for the sweep. Now the worst case is two rows, never none: a failed insert changes
 * nothing, and a failed delete leaves the old and the new row side by side. Every reader takes the
 * first row by sort order (the old one, the new row's sort order is now), so that case reports an
 * error: the change did not take, and the next save clears the extra row. A clear is just the
 * delete. Old pages that left two rows behind (the Site page's uploader once only inserted) end
 * with one on the next replace.
 *
 * The replaced rows' files are not removed here: one may be the live photo, or a library photo's
 * file; the publish-time sweep knows which (storage-gc.ts).
 */
export async function setProfilePhoto(supabase: SupabaseClient, artistId: string, storagePath: string | null): Promise<ProfilePhotoResult> {
  // The path comes from the browser on the upload doors: it must be this artist's own file.
  if (storagePath !== null && !isOwnedStoragePath(artistId, storagePath)) return { ok: false, error: 'That file location is not valid.' }
  if (!storagePath) {
    const del = await supabase.from('media').delete().eq('artist_id', artistId).eq('purpose', PROFILE_PHOTO)
    return del.error ? { ok: false, error: del.error.message } : { ok: true }
  }
  const ins = await supabase
    .from('media')
    .insert({
      artist_id: artistId,
      purpose: PROFILE_PHOTO,
      storage_path: storagePath,
      on_site: true,
      sort_order: Math.floor(Date.now() / 1000),
    })
    .select('id')
    .single()
  const newId = (ins.data as { id?: unknown } | null)?.id
  if (ins.error || typeof newId !== 'string') return { ok: false, error: ins.error?.message ?? 'Could not save the profile photo.' }
  const del = await supabase.from('media').delete().eq('artist_id', artistId).eq('purpose', PROFILE_PHOTO).neq('id', newId)
  if (del.error) return { ok: false, error: `The old profile photo is still there (${del.error.message}). Try again.` }
  return { ok: true }
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
