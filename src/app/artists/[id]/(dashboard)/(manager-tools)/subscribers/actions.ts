'use server'

/**
 * SUBSCRIBERS — the one write door beyond `subscribe()` itself (Sam, 2026-09-28: "a manager
 * can remove a subscriber", replacing the earlier "nobody writes this table" rule pinned by
 * tests/integration/auth/subscribers.isolation.test.ts — for DELETE only. INSERT and UPDATE
 * stay closed; `subscribe()` is still the sole way a row is created or changed).
 *
 * `requireOwnedArtist` FIRST (belt): signed in, and the artist row is visible through RLS.
 * The `subscribers_delete` RLS policy (20260928140500) is the braces — a stranger's delete
 * still row-filters to zero matches with `error: null`, which is why `deleteSubscriber`
 * reads back `.select('id')` rather than trusting the (empty) error.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { deleteSubscriber } from '@/lib/manager-tools/subscribers/subscribers'
import { requireOwnedArtist } from '../../_owns'

export async function removeSubscriberAction(artistId: string, id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }

  const result = await deleteSubscriber(supabase, artistId, id)
  if (!result.ok) return { error: result.error }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
