'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * The two things Settings can change (2026-09-13). Both instant — no draft, no publish —
 * and both answer with `{ error }` rather than throwing, so the row can put the old value
 * back and say why.
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

/** The artist's name — the only place left that edits it, now that the `/edit` page
 *  and its `updateArtistAction` (which this duplicated) are gone. */
export async function saveArtistNameAction(artistId: string, name: string): Promise<{ error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give the artist a name.' }
  if (trimmed.length > 200) return { error: 'That name is too long (200 characters at most).' }
  const supabase = await createClient()
  const { error } = await supabase.from('artists').update({ name: trimmed }).eq('id', artistId).select('id').single()
  if (error) return { error: error.message }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
