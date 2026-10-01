'use server'

/**
 * The SEO tool's Profiles tab: mark an outside-profile job done ("Mark as sent"), or undo it.
 *
 * Checks, in order, before any write: the item and flag are what this action accepts (they
 * arrive from the client), a signed-in user, then `callerOwns` (an RLS-scoped read of the
 * artist). The write runs on the manager's own session, so RLS decides as well; the ownership
 * check is there because a denied DELETE is row-filtered and would otherwise report success.
 */
import { revalidatePath } from 'next/cache'
import { isProfileItem, setProfileMark } from '@/lib/manager-tools/profiles/marks'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '../../../../_owns'

export async function markProfileItemAction(
  artistId: string,
  item: string,
  done: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!isProfileItem(item)) return { ok: false, error: 'Unknown item.' }
  if (typeof done !== 'boolean') return { ok: false, error: 'Bad request.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (!(await callerOwns(supabase, artistId))) return { ok: false, error: 'Artist not found.' }

  const res = await setProfileMark(supabase, artistId, item, done)
  if (!res.ok) return res
  revalidatePath(`/artists/${artistId}/tools/seo/profiles`)
  return { ok: true }
}
