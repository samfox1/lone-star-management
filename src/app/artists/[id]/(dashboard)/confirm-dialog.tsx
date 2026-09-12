'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { buttonClass } from '@/components/ui/ui'

/**
 * ASKING, IN THE APP'S OWN VOICE (Sam, 2026-09-12: "add a confirmation modal or dialogue
 * or something so the user can confirm before").
 *
 * Every destructive control in the dashboard used `window.confirm`. The browser draws it
 * in the OS's wording, it cannot be styled, its buttons are "OK" and "Cancel" — an OK
 * that could mean either half of the question — and over a page that is already dimmed
 * behind a card it reads as something having gone wrong rather than as a choice.
 *
 * A HOOK, not a module-level singleton like `toast`. A toast is fire-and-forget, so a pub/
 * sub with one host suits it; a confirm has to hand an ANSWER back to the caller, and the
 * caller is mid-`await`. Keeping the state in the asking component means the answer
 * returns to the closure that asked, the dialog unmounts with whatever owned it (no
 * orphaned question outliving a closed card), and a test renders nothing extra.
 *
 * The promise resolves FALSE on cancel, Escape, or a click outside — every way out that
 * is not the named action is a no. It never rejects: a caller writing
 * `if (!(await ask(…))) return` must not need a try/catch to be safe.
 */
/** Both answers are the same size: neither is the default by being the bigger target. */
const PAIR = 'min-w-[88px] justify-center'

export function useConfirm(): {
  /** Ask, and resolve true only if the manager presses the named action. */
  ask: (question: string, opts?: { action?: string; tone?: 'danger' | 'solid' }) => Promise<boolean>
  /** Render this wherever the asking component renders. */
  dialog: ReactNode
} {
  const [pending, setPending] = useState<{ question: string; action: string; tone: 'danger' | 'solid' } | null>(null)
  const resolveRef = useRef<((answer: boolean) => void) | null>(null)

  const settle = useCallback((answer: boolean) => {
    setPending(null)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(answer)
  }, [])

  const ask = useCallback(
    (question: string, opts?: { action?: string; tone?: 'danger' | 'solid' }) => {
      // A second ask while one is open answers the first NO rather than stranding its
      // promise — an await that never settles is a button that never comes back.
      resolveRef.current?.(false)
      setPending({ question, action: opts?.action ?? 'Delete', tone: opts?.tone ?? 'danger' })
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
      })
    },
    [],
  )

  useEffect(() => {
    if (!pending) return
    // Escape answers THIS, and stops there: the card underneath listens for Escape too,
    // and a keypress meant for the question must not also close the thing behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      settle(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pending, settle])

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && settle(false)}
    >
      <div role="dialog" aria-modal="true" aria-label={pending.question} className="w-[340px] max-w-full rounded-2xl bg-paper p-5 shadow-2xl">
        <p className="text-[15px] leading-snug">{pending.question}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => settle(false)} className={buttonClass('confirm', PAIR)}>
            Cancel
          </button>
          {/* Named for what it DOES — never an "OK" that could mean either half. */}
          <button type="button" onClick={() => settle(true)} className={buttonClass(pending.tone, PAIR)}>
            {pending.action}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { ask, dialog }
}
