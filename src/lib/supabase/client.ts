'use client'

/**
 * Browser Supabase client. Uses the anon key — every query it makes is subject
 * to RLS, scoped to the logged-in user's JWT. Never give the browser the
 * service-role key.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
