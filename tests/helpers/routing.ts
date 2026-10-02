/**
 * Is 20261002210000 live on the hosted project? That migration makes each enquiry kind go ONLY
 * to its own recipient list (Sam, 2026-10-02: "I should have to add each one individually") and
 * drops `resolve_booking_recipient`, the old fallback chain (booking_email → booking link → site
 * text). Tests run against the hosted project, so until it is pushed the OLD rule is live, and
 * the tests that pin the new one are skipped by name rather than left to fail or, worse, pass.
 *
 * The probe is the dropped function: PostgREST answers PGRST202 for a function that does not
 * exist. Any OTHER error throws, so a network fault can never read as "not live yet" and quietly
 * skip the suite.
 *
 * DELETE THIS, and every `runIf`/`skipIf` on it, once 20261002210000 is pushed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function kindListsOnlyLive(svc: SupabaseClient): Promise<boolean> {
  const { error } = await svc.rpc('resolve_booking_recipient', { p_artist_id: '00000000-0000-0000-0000-000000000000' })
  if (!error) return false
  if (error.code === 'PGRST202') return true
  throw new Error(`probe for 20261002210000: ${error.code} ${error.message}`)
}
