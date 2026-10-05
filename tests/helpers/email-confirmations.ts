/**
 * Email confirmation, for the tests that route enquiries (20261006120000).
 *
 * Since that migration `resolve_enquiry_recipients` sends only to addresses CONFIRMED for the
 * artist (or still in their legacy grace). Sam, 2026-09-30: "there should be a confirmation
 * email sent with a code for us to make sure the email is legit". So a routing test that puts
 * an address on a list and expects it to receive must confirm it too. Those tests are about
 * LISTS (order, primary, one kind never borrowing another's); confirmation has its own file,
 * tests/integration/enquiries/email-confirmations.test.ts.
 *
 * ONE SWITCH for every file that depends on the migration. Before the push the table does not
 * exist: confirming is a no-op, the routing files behave exactly as before, and the
 * confirmation file is skipped. Flip it in the SAME change as the push, then run
 * tests/integration/enquiries/.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const EMAIL_CONFIRMATIONS_PUSHED = false

/**
 * Mark addresses confirmed for one artist, the state a finished code or link leaves, without
 * sending anything. Service client only (the table is service-only). Lower-cased because the
 * table keys on lower(email) and the lists keep whatever case was typed.
 */
export async function confirmForRouting(
  svc: SupabaseClient,
  artistId: string,
  emails: string[],
): Promise<void> {
  if (!EMAIL_CONFIRMATIONS_PUSHED) return
  const now = new Date().toISOString()
  const rows = [...new Set(emails.map((e) => e.trim().toLowerCase()))].map((email) => ({
    artist_id: artistId,
    email,
    confirmed_at: now,
  }))
  const { error } = await svc.from('artist_email_confirmations').upsert(rows, { onConflict: 'artist_id,email' })
  if (error) throw new Error(`confirmForRouting(${artistId}): ${error.message}`)
}
