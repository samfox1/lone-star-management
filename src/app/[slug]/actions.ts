'use server'

import { createClient } from '@/lib/supabase/server'

export type SubscribeState = { ok?: true; error?: string }

// The door's own user-facing messages — the only DB error text we echo to a fan.
// Anything else (timeout, constraint, connectivity) shows a generic string so we
// never leak internal Postgres detail to a public page.
const DOOR_MESSAGES = new Set(['Enter a valid email address.', 'Unknown artist.'])

/**
 * Public email capture for an artist's site. Calls the anon `subscribe()` door,
 * which validates the email, resolves the artist from its slug, and inserts (a
 * duplicate is a silent success). No auth: a logged-out fan reaches this. The
 * door is the only write path to `subscribers`, so nothing here trusts input
 * beyond passing it through to that validated RPC.
 *
 * A hidden `website` honeypot catches naive bots — a filled value is treated as
 * a (fake) success and never written. This is a first line only; a proper per-IP
 * rate limit on the anon door is a tracked follow-up (see TODO, shared with the
 * audio play route).
 */
export async function subscribeAction(slug: string, formData: FormData): Promise<SubscribeState> {
  if (String(formData.get('website') ?? '').trim() !== '') return { ok: true }

  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('subscribe', { p_slug: slug, p_email: email })
  if (error) {
    return { error: DOOR_MESSAGES.has(error.message) ? error.message : 'Something went wrong — try again.' }
  }
  return { ok: true }
}
