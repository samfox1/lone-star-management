'use server'

/**
 * Music server actions that are not generic content plumbing.
 *
 * Its OWN actions file rather than more surface on the dashboard's shared `actions.ts`,
 * which is already ~1400 lines of generic CRUD this has nothing to do with. The merge
 * itself lives in `lib/song-merge.ts` (pure planning + a function over an injected
 * client, so it is testable without the cookie context); this wrapper is auth, storage
 * cleanup and revalidation only.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { mergeSongs } from '@/lib/song-merge'
import { gcDeletedAudioObject } from '@/lib/storage-gc'
import { callerOwns } from '../_owns'

/**
 * Merge the duplicate `dropId` into `keepId`, then delete the duplicate.
 *
 * TWO independent ownership checks, because they answer different questions:
 *   - `callerOwns` asks whether this manager may act on this artist at all. RLS
 *     row-filters the UPDATE and DELETE rather than rejecting them, so without this a
 *     non-owner's merge would touch zero rows and report SUCCESS.
 *   - `mergeSongs` re-reads both songs scoped to that same artist, so a pair spanning two
 *     artists resolves to fewer than two rows and never merges. A cross-artist merge is
 *     unreachable even if the client sends any pair of ids it likes.
 *
 * Storage: the duplicate's master is collected AFTER the row is gone, and only when the
 * merged song didn't adopt it. Plain song deletion runs the same collector from
 * deleteContentAction('track'), so neither row-deleting path leaks its audio object.
 */
export async function mergeSongsAction(
  artistId: string,
  keepId: string,
  dropId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  if (!(await callerOwns(supabase, artistId))) return { error: 'Not found.' }

  const res = await mergeSongs(supabase, artistId, keepId, dropId)
  if (!res.ok) return { error: res.error }

  await gcDeletedAudioObject(supabase, dropId, res.orphanedAudioPath)

  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
