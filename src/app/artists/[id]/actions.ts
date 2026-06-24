'use server'

/**
 * Track server actions for one artist's dashboard. Each builds the request-bound
 * Supabase client (RLS scopes every write to the caller's tenant) and calls the
 * tracks data layer, then revalidates the page. artistId / trackId are bound as
 * leading args from the page, FormData carries the user input.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  createTrack,
  deleteTrack,
  publishTracks,
  updateTrack,
} from '@/lib/tracks'

function trim(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function nullable(formData: FormData, key: string): string | null {
  const v = trim(formData, key)
  return v === '' ? null : v
}

export async function addTrackAction(artistId: string, formData: FormData) {
  const title = trim(formData, 'title')
  if (!title) return
  const supabase = await createClient()
  await createTrack(supabase, artistId, {
    title,
    stream_url: nullable(formData, 'stream_url'),
    cover_url: nullable(formData, 'cover_url'),
  })
  revalidatePath(`/artists/${artistId}`)
}

export async function updateTrackAction(
  trackId: string,
  artistId: string,
  formData: FormData,
) {
  const title = trim(formData, 'title')
  if (!title) return
  const supabase = await createClient()
  await updateTrack(supabase, trackId, { title })
  revalidatePath(`/artists/${artistId}`)
}

export async function deleteTrackAction(trackId: string, artistId: string) {
  const supabase = await createClient()
  await deleteTrack(supabase, trackId)
  revalidatePath(`/artists/${artistId}`)
}

export async function publishAction(artistId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await publishTracks(supabase, artistId, user?.id)
  revalidatePath(`/artists/${artistId}`)
}
