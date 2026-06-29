'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * File a request for us to build a new artist's site. Inserts into the
 * `artist_requests` queue (RLS requires requested_by = the caller). The new row
 * shows up on the roster as a "Site in progress" pending card.
 */
export async function requestArtist(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Artist name is required')
  if (name.length > 200) throw new Error('Artist name is too long')

  // Store the handle WITHOUT a leading slash, to match how `artists.slug` is
  // stored (and rendered as `/{handle}`). Keeps the request → artist conversion
  // a straight copy instead of a strip-the-slash trap.
  const handle = String(formData.get('handle') ?? '').trim().replace(/^\/+/, '') || null

  const link = String(formData.get('link') ?? '').trim() || null
  if (link && !/^https?:\/\//i.test(link)) {
    throw new Error('Link must start with http:// or https://')
  }

  const notes = String(formData.get('notes') ?? '').trim() || null
  if (notes && notes.length > 4000) throw new Error('Notes are too long')

  const { error } = await supabase.from('artist_requests').insert({
    requested_by: user.id,
    name,
    handle,
    link,
    email: user.email ?? null, // the requester's own email; no form field needed
    notes,
  })
  if (error) throw error

  revalidatePath('/')
}
