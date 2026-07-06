'use server'

import { createClient } from '@/lib/supabase/server'

export type SubscribeState = { ok?: true; error?: string }

/**
 * Public email capture for an artist's site. Calls the anon `subscribe()` door,
 * which validates the email, resolves the artist from its slug, and inserts (a
 * duplicate is a silent success). No auth: a logged-out fan reaches this. The
 * door is the only write path to `subscribers`, so nothing here trusts input
 * beyond passing it through to that validated RPC.
 */
export async function subscribeAction(slug: string, formData: FormData): Promise<SubscribeState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('subscribe', { p_slug: slug, p_email: email })
  // The door raises a friendly message on a bad email; surface it, else generic.
  if (error) return { error: error.message || 'Something went wrong — try again.' }
  return { ok: true }
}
