'use client'

import { useActionState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { confirmedLine } from '@/lib/enquiries/confirm'
import { confirmEmailTokenAction } from './actions'

/**
 * The link page's one question and its answers (mock: prototypes/email_confirm_20261005.html §05).
 * Before the button nothing is looked up, so the page says nothing about whose link it is.
 */
export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmailTokenAction, null)

  if (state?.status === 'confirmed') {
    return (
      <Shell>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper">
          <Icon name="check" size={20} strokeWidth={2} />
        </span>
        <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.01em]">Confirmed</h1>
        <p className="mt-1.5 text-[14px] text-ink-muted">
          <span className="break-all font-space text-[13px] text-ink">{state.email}</span> {confirmedLine(state.artistName, state.kinds)}
        </p>
      </Shell>
    )
  }
  if (state?.status === 'invalid') return <LinkExpired />

  return (
    <Shell>
      <form action={action} className="flex flex-col items-center">
        <input type="hidden" name="token" value={token} />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Confirm this address for enquiries</h1>
        {state?.status === 'error' ? <p className="mt-1.5 text-[14px] text-ink-muted">Couldn’t confirm. Try again.</p> : null}
        <button type="submit" disabled={pending} className={buttonClass('solid', 'mt-6 px-5')}>
          Confirm
        </button>
      </form>
    </Shell>
  )
}

/** Unknown, used or expired: the same words for all three, and no one named. */
export function LinkExpired() {
  return (
    <Shell>
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">This link has expired</h1>
      <p className="mt-1.5 text-[14px] text-ink-muted">Ask for a new code.</p>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center text-center">{children}</div>
}
