'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { isConfirmToken, tokenResult, type TokenResult } from '@/lib/enquiries/confirm'

/**
 * The confirm email's button, pressed (EMAIL_CONFIRM_PLAN.md §4). PUBLIC: whoever holds the link
 * is whoever the email reached, which is the whole proof. Only a POST confirms, so a link scanner
 * that opens every URL in an email never does.
 *
 * The SERVICE client, because confirm_email_token is service-only (anon cannot execute it), and
 * for exactly that one call. The token's shape is checked FIRST (isConfirmToken: 43 url-safe
 * base64 characters): anything else is not a token this system minted, and never reaches the
 * database. Unknown, used and expired all answer `invalid` and name no one.
 */
export async function confirmEmailTokenAction(_prev: TokenResult | null, form: FormData): Promise<TokenResult> {
  const token = form.get('token')
  if (!isConfirmToken(token)) return { status: 'invalid' }

  const { data, error } = await createAdminClient().rpc('confirm_email_token', { p_token: token })
  if (error) return { status: 'error' }
  return tokenResult(Array.isArray(data) ? data[0] : data)
}
