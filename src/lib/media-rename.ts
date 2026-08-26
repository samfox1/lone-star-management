/**
 * Rename one media object to a descriptive slug (SEO_GEO_PLAN B6b).
 *
 * `{artist}/{category}/{uuid}.jpg` → `{artist}/{category}/{slug}.jpg`. The object is
 * COPIED, not moved: the live site serves the published snapshot, which still points at
 * the old path until the next publish; a move would 404 every polaroid on the live site
 * the moment the manager renamed one. Storage GC removes the old object once no
 * snapshot references it (storage-gc.ts).
 *
 * Order of operations: copy first, then the row. If the row write fails the copy is
 * removed, so a failed rename leaves nothing behind. A slug that is already taken
 * (unique index 20260826140000) comes back as a manager-facing message.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnedStoragePath } from '@/lib/upload'
import { recommendSlug } from '@samfox1/site-bridge/alt'

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SLUG_MAX = 80

export type RenameResult = { error?: string; storage_path?: string }

/** The same folder and extension, a new file name. */
export function slugStoragePath(storagePath: string, slug: string): string {
  const dir = storagePath.slice(0, storagePath.lastIndexOf('/'))
  const ext = storagePath.slice(storagePath.lastIndexOf('.') + 1)
  return `${dir}/${slug}.${ext}`
}

export async function renameMedia(
  client: SupabaseClient,
  artistId: string,
  mediaId: string,
  slug: string,
): Promise<RenameResult> {
  // Whatever was typed becomes a slug the same way the recommendation did ("Skeen Tour "
  // → skeen-tour); only an input with nothing usable in it is refused.
  const clean = recommendSlug(slug)
  if (!SLUG_RE.test(clean) || clean.length > SLUG_MAX) return { error: 'Use letters, numbers and dashes.' }

  const { data: row, error: readErr } = await client
    .from('media')
    .select('storage_path, slug')
    .eq('id', mediaId)
    .eq('artist_id', artistId)
    .single()
  if (readErr || !row) return { error: 'Photo not found.' }
  const oldPath = row.storage_path as string
  if (!isOwnedStoragePath(artistId, oldPath)) return { error: 'Photo not found.' }
  const newPath = slugStoragePath(oldPath, clean)
  if (newPath === oldPath) return { storage_path: oldPath }

  const { error: copyErr } = await client.storage.from('media').copy(oldPath, newPath)
  if (copyErr) {
    if (/exists|duplicate|409/i.test(copyErr.message)) return { error: 'That file name is taken.' }
    return { error: copyErr.message }
  }
  const { error: rowErr } = await client
    .from('media')
    .update({ storage_path: newPath, slug: clean })
    .eq('id', mediaId)
    .eq('artist_id', artistId)
  if (rowErr) {
    await client.storage.from('media').remove([newPath])
    if (rowErr.code === '23505') return { error: 'That file name is taken.' }
    return { error: rowErr.message }
  }
  return { storage_path: newPath }
}
