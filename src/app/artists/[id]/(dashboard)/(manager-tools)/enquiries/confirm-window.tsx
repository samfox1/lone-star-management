'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import {
  CODE_LENGTH,
  codeIsLive,
  EMPTY_SLOTS,
  codeDigits,
  codeFrom,
  codeIsDead,
  codeMessage,
  countdown,
  enterDigits,
  secondsLeft,
  sendMessage,
} from '@/lib/enquiries/confirm'
import { CardModal } from '../../card-modal'
import { RowIcon } from '../_ui/row-icon'
import { MONO_META } from '../_ui/styles'
import { confirmEmailCodeAction, sendEmailCodeAction } from './actions'

/**
 * THE CODE WINDOW (EMAIL_CONFIRM_PLAN.md §3, mock prototypes/email_confirm_20261005.html). Sam,
 * 2026-10-05: "after initially sending it, a window should appear telling the user to enter the
 * 6 digit code. If they want to close this window, thats fine".
 *
 *   the first line   level with the × (an untitled CardModal): "Enter the 6-digit code", and
 *                    under it where the code went
 *   six slots        underlines, no boxes; a digit moves on, Backspace moves back, a pasted (or
 *                    autofilled) code fills them all. The 6th digit checks it: no button
 *   a wrong code     clears the slots, one quiet line; 'locked' or 'expired' say so and leave
 *                    the resend glyph as the way forward
 *   bottom left      the resend glyph and its 60 s countdown
 *   bottom right     a trash: a waiting address is not click-to-edit, so a typo leaves here
 *
 * Opening it after an add SENDS (`sendOnOpen`). Opening it from a blue address sends too, unless
 * a code it can still type is already out ('unless-live', Sam 2026-10-05: send it "and then the
 * modal opens after"); then it opens on that code and the glyph is how to send again. Closing
 * it is fine: the address stays blue and waits.
 *
 * Re-entry latches are refs (AGENTS.md rule 5): a paste and the 6th keypress in one tick check
 * once; two fast clicks on resend send once.
 */
export function ConfirmWindow({
  artistId,
  email,
  sendOnOpen,
  sentAt: sentBefore,
  onSent,
  onConfirmed,
  onRemove,
  onClose,
}: {
  artistId: string
  email: string
  /** Send a code as it opens: always (the address was just added), or 'unless-live' (a click on
   *  a blue address: not over a code sent within its 15 minutes). */
  sendOnOpen: boolean | 'unless-live'
  /** When the last code went to this address on this visit (ms), for the countdown. */
  sentAt?: number
  /** A send went out at this time, or did not after all (undefined: no wait before the next). */
  onSent: (at: number | undefined) => void
  onConfirmed: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const [slots, setSlots] = useState<readonly string[]>(EMPTY_SLOTS)
  const [note, setNote] = useState<string | null>(null)
  /** Locked or expired: the slots stay off until a new code is sent. */
  const [dead, setDead] = useState(false)
  /** Does this window send as it opens? Decided once, here, where reading the clock is allowed. */
  const [sendsNow] = useState(() => (sendOnOpen === 'unless-live' ? !codeIsLive(sentBefore, Date.now()) : sendOnOpen))
  /** When the last code went: now, if this window sends as it opens. */
  const [sentAt, setSentAt] = useState(() => (sendsNow ? Date.now() : sentBefore))
  const [now, setNow] = useState(() => Date.now())
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const checking = useRef(false)
  const sending = useRef(false)
  /** The send on open happens once, however often the effect runs (StrictMode runs it twice). */
  const opened = useRef(false)

  const left = secondsLeft(sentAt, now)

  // The countdown ticks only while there is one.
  useEffect(() => {
    if (left <= 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [left])

  /** The slot to focus, kept until it can take focus: after a resend the slots are still
   *  disabled until the render that turns them back on. */
  const wantFocus = useRef<number | null>(null)
  useEffect(() => {
    if (wantFocus.current === null) return
    inputs.current[wantFocus.current]?.focus()
    if (document.activeElement === inputs.current[wantFocus.current]) wantFocus.current = null
  })
  const focusSlot = (i: number) => {
    wantFocus.current = i
    inputs.current[i]?.focus()
    if (document.activeElement === inputs.current[i]) wantFocus.current = null
  }

  /** The resend glyph: the countdown restarts at once, then the code goes. */
  function sendAgain() {
    if (sending.current) return
    const at = Date.now()
    setSentAt(at)
    setNow(at)
    onSent(at)
    void send(true)
  }

  /** Ask the function to mail a code, and say what came of it. `fresh`: a resend, whose new
   *  code empties the slots (the first send leaves alone what is already being typed). */
  async function send(fresh = false) {
    if (sending.current) return
    sending.current = true
    try {
      const { status } = await sendEmailCodeAction(artistId, email)
      if (status === 'confirmed') return onConfirmed()
      // A failure that never reached the rate limit leaves nothing to wait for.
      if (status === 'error' || status === 'not_allowed' || status === 'not_listed') {
        setSentAt(undefined)
        onSent(undefined)
      }
      setNote(sendMessage(status))
      if (status === 'sent' && fresh) {
        setDead(false)
        setSlots(EMPTY_SLOTS)
        focusSlot(0)
      }
    } catch {
      setSentAt(undefined)
      onSent(undefined)
      setNote(sendMessage('error'))
    } finally {
      sending.current = false
    }
  }

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    focusSlot(0)
    if (sendsNow) {
      onSent(sentAt)
      void send()
    }
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function check(code: string) {
    if (checking.current) return
    checking.current = true
    try {
      const { status } = await confirmEmailCodeAction(artistId, email, code)
      if (status === 'confirmed') return onConfirmed()
      setSlots(EMPTY_SLOTS)
      setNote(codeMessage(status))
      if (codeIsDead(status)) setDead(true)
      else focusSlot(0)
    } catch {
      setSlots(EMPTY_SLOTS)
      setNote(codeMessage('error'))
      focusSlot(0)
    } finally {
      checking.current = false
    }
  }

  function take(next: { slots: string[]; focus: number }) {
    setSlots(next.slots)
    focusSlot(next.focus)
    const code = codeFrom(next.slots)
    if (code) void check(code)
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const digits = codeDigits(e.clipboardData.getData('text'))
    if (digits) take(enterDigits(slots, i, digits))
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !slots[i] && i > 0) {
      e.preventDefault()
      const next = [...slots]
      next[i - 1] = ''
      setSlots(next)
      focusSlot(i - 1)
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      focusSlot(i - 1)
    } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
      e.preventDefault()
      focusSlot(i + 1)
    }
  }

  return (
    <CardModal open narrow onClose={onClose} label="Enter the code" footer={null}>
      {/* Level with the × (no title: the opener said what this is); clear of it on the right. */}
      <div className="-mt-[28px] pr-10">
        <p className="text-[15px] font-medium leading-6 text-ink">Enter the 6-digit code</p>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
          Sent to <span className="break-all font-space text-[12.5px] text-ink">{email}</span>
        </p>
      </div>

      <div role="group" aria-label="Code" className="mt-7 flex justify-center gap-2.5">
        {slots.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el
            }}
            aria-label={`Digit ${i + 1}`}
            value={digit}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            disabled={dead}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => take(enterDigits(slots, i, e.target.value, digit))}
            onPaste={(e) => onPaste(i, e)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className={cx(
              // A line, not a box (Sam: no boxed inputs); the gap after the third splits the code
              // the way the email prints it ("482 913").
              'w-[34px] rounded-none border-0 border-b-[1.5px] border-ink-faint bg-transparent p-0 pb-1 text-center font-space text-[26px] leading-9 text-ink outline-none focus:border-ink disabled:border-hairline',
              i === 2 && 'mr-3.5',
            )}
          />
        ))}
      </div>

      <p aria-live="polite" className="mt-2.5 h-5 text-center text-[13px] leading-5 text-ink-muted">
        {note}
      </p>

      <div className="mt-1.5 flex items-center">
        {/* The glyphs sit flush with the text above: their 36px targets reach past it. */}
        <RowIcon
          icon="refresh"
          label="Send again"
          variant="boxed"
          size="sm"
          glyphSize={14}
          labelSide="top"
          labelAlign="start"
          disabled={left > 0}
          onClick={sendAgain}
          className="-ml-[11px]"
        />
        <span className={cx('-ml-1.5', MONO_META)}>{countdown(left)}</span>
        <RowIcon
          icon="trash"
          label="Remove address"
          variant="boxed"
          size="sm"
          tone="danger"
          glyphSize={14}
          labelSide="top"
          labelAlign="end"
          onClick={onRemove}
          className="-mr-[11px] ml-auto"
        />
      </div>
    </CardModal>
  )
}
