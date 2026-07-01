'use server'

/**
 * Public "apply for access" submission. A logged-out visitor has no session, so
 * the server client acts as anon — and the ONLY write path is the anon-granted
 * SECURITY DEFINER door `submit_application` (the applications table has no anon
 * insert policy). The door validates + raises on bad input.
 */
import { createClient } from '@/lib/supabase/server'

export async function submitApplication(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const artistName = String(formData.get('artist_name') ?? '').trim()
  const link = String(formData.get('link') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()

  if (!name || !email) throw new Error('Please enter your name and email.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_application', {
    p_name: name,
    p_email: email,
    p_artist_name: artistName || null,
    p_link: link || null,
    p_notes: notes || null,
  })
  if (error) {
    // Surface the door's validation message when it's user-facing (e.g. bad email).
    throw new Error(
      /email/i.test(error.message)
        ? 'Enter a valid email address.'
        : 'Could not submit your application — please try again.',
    )
  }
}
