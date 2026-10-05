import type { Metadata } from 'next'
import { isConfirmToken } from '@/lib/enquiries/confirm'
import { ConfirmForm, LinkExpired } from './confirm-form'

export const metadata: Metadata = {
  title: 'Confirm email',
  robots: { index: false, follow: false },
  // The token is in this page's address: never hand it to another site as a referrer.
  referrer: 'no-referrer',
}

/**
 * THE CONFIRM EMAIL'S BUTTON LANDS HERE (EMAIL_CONFIRM_PLAN.md §4). Public: not under a
 * protected prefix (src/lib/supabase/middleware.ts), so whoever the email reached can open it
 * signed out, Ross included.
 *
 * GET looks nothing up and confirms nothing: it asks, and the button POSTs (confirm-form.tsx →
 * actions.ts). A link scanner that pre-opens every URL in an email only ever sees the question.
 * A token that is not even the right shape gets the expired page at once, with no call at all.
 */
export default async function ConfirmEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-paper px-4 py-16 font-ui text-ink">
      {isConfirmToken(token) ? <ConfirmForm token={token} /> : <LinkExpired />}
    </main>
  )
}
