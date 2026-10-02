'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { setProfilePhotoFromImage } from '@/lib/profile-photo'
import { requireOwnedArtist } from '../../_owns'

/**
 * The profile photo's door (lib/profile-photo.ts). It checks the caller owns the artist (a
 * row-filtered write would otherwise answer "done"), writes through the ONE function the editor
 * uses too, and revalidates so the Publish bar sees the draft change. Every upload door lands the
 * photo in Images first and then calls this with its id (profile-photo-uploader.tsx), so every
 * profile photo stays pickable after it is replaced.
 */

/** Make one of the artist's Images the profile photo (the Profile page's picker, and every upload). */
export async function setProfilePhotoAction(artistId: string, mediaId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }
  const res = await setProfilePhotoFromImage(supabase, artistId, mediaId)
  if (!res.ok) return { error: res.error ?? 'Could not set the profile photo.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
