'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { setProfilePhoto, setProfilePhotoFromImage } from '@/lib/profile-photo'
import { requireOwnedArtist } from '../../_owns'

/**
 * The profile photo's two doors (lib/profile-photo.ts). Each checks the caller owns the artist
 * (a row-filtered write would otherwise answer "done"), writes through the ONE function the
 * editor uses too, and revalidates so the Publish bar sees the draft change.
 */

/** Make one of the artist's Images the profile photo (the Profile page's picker). */
export async function setProfilePhotoAction(artistId: string, mediaId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }
  const res = await setProfilePhotoFromImage(supabase, artistId, mediaId)
  if (!res.ok) return { error: res.error ?? 'Could not set the profile photo.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/** Put a just-uploaded file in the slot, or clear it with null (the Site & profile page). */
export async function setProfilePhotoFileAction(artistId: string, storagePath: string | null): Promise<{ error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }
  const res = await setProfilePhoto(supabase, artistId, storagePath)
  if (!res.ok) return { error: res.error ?? 'Could not set the profile photo.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
