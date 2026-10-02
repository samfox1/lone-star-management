'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * What Settings can change (2026-09-13): the booking address. Instant (no draft, no publish),
 * and it answers with `{ error }` rather than throwing, so the row can put the old value back
 * and say why. The name moved to Profile on 2026-10-02 (profile/actions.ts).
 */

/** Save (or clear, with a blank) the address enquiries go to. The door validates and
 *  guards ownership; a refusal comes back as its message. */
export async function saveBookingEmailAction(artistId: string, email: string): Promise<{ error?: string; value?: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_booking_email', { p_artist_id: artistId, p_email: email })
  if (error) return { error: /not an email/.test(error.message) ? 'That isn’t an email address.' : error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return { value: (data as string | null) ?? null }
}
