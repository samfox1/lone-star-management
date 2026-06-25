import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses RLS, so use it ONLY for narrow,
 * server-side, already-authorized work (e.g. signing a gated-audio URL for a
 * path the DB has already vouched for). Never expose it to the browser. Keeping
 * the key wiring in one factory makes service-role use auditable in one place.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}
