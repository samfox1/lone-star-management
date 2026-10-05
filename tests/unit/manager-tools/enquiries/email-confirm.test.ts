// The code window's pure half: the six slots, the statuses as words, the countdown, and what
//   the loader's status call means.
/**
 * Code:     src/lib/enquiries/confirm.ts
 * Feature:  confirming an address before enquiries go to it (EMAIL_CONFIRM_PLAN.md §3, mock
 *           prototypes/email_confirm_20261005.html)
 * Tier:     LIGHT for the words and slots (the window is new and its look is still moving);
 *           STRICT for confirmStateFrom, the one place a failed read could make a waiting
 *           address LOOK confirmed. The link token's shape is pinned in
 *           tests/unit/enquiries/confirm-email-token.test.ts.
 * Covers:   • paste normalising: non-digits stripped, at most six, a whole code fills every slot
 *           • a typed digit moves on, and replaces the one already in its slot
 *           • the code exists only when all six slots hold a digit
 *           • each status's one quiet line; locked/expired are the dead ones
 *           • the 60 s countdown
 *           • the loader: a missing function switches the feature off, any other error shows
 *             every address waiting, rows give the confirmed ones
 *           Equivalent mutants left (Stryker, 2026-10-05, 98.3%): enterDigits' `length === 2`
 *           (one digit typed over another gives that digit either way), and confirmStateFrom's
 *           `: []` (any non-array rows confirm nothing either way).
 * Not here: the window itself (tests/components/manager-tools/enquiries/email-confirm.test.tsx);
 *           the SQL rules behind the statuses (tests/integration/enquiries/).
 * Fixtures: none.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SLOTS,
  codeDigits,
  codeFrom,
  codeIsDead,
  codeMessage,
  confirmStateFrom,
  confirmedLine,
  countdown,
  enterDigits,
  secondsLeft,
  sendMessage,
  sendStatus,
  codeStatus,
  kindWords,
  type CodeStatus,
  type SendStatus,
} from '@/lib/enquiries/confirm'

describe('the six slots', () => {
  // A paste keeps only digits and at most six: the email prints "482 913", a mail app may copy
  // a sentence around it.
  it('normalises a paste: strips everything but digits, caps at six', () => {
    expect(codeDigits('482 913')).toBe('482913')
    expect(codeDigits('Your code is 482-913.')).toBe('482913')
    expect(codeDigits('48291355')).toBe('482913')
    expect(codeDigits('abc')).toBe('')
    // Full-width digits are not the ASCII ones the SQL hashes.
    expect(codeDigits('４８２')).toBe('')
  })

  // A whole code fills every slot from the first, wherever it lands (a paste into slot 4, a
  // phone's autofill into slot 1).
  it('a whole code fills every slot, wherever it lands', () => {
    expect(enterDigits(EMPTY_SLOTS, 3, '482 913')).toEqual({ slots: ['4', '8', '2', '9', '1', '3'], focus: 5 })
  })

  // Fewer digits fill from the slot on and focus moves past them; they never run off the end.
  it('fewer digits fill from that slot on; focus moves past them', () => {
    expect(enterDigits(EMPTY_SLOTS, 0, '4')).toEqual({ slots: ['4', '', '', '', '', ''], focus: 1 })
    // Two pasted into an empty slot are two digits, not a replacement.
    expect(enterDigits(EMPTY_SLOTS, 0, '48')).toEqual({ slots: ['4', '8', '', '', '', ''], focus: 2 })
    expect(enterDigits(EMPTY_SLOTS, 4, '123')).toEqual({ slots: ['', '', '', '', '1', '2'], focus: 5 })
  })

  // A digit typed into a filled slot arrives beside the old one: the new one is kept.
  it('a digit typed into a filled slot replaces it', () => {
    const slots = ['4', '8', '', '', '', '']
    expect(enterDigits(slots, 1, '87', '8').slots[1]).toBe('7')
    expect(enterDigits(slots, 1, '78', '8').slots[1]).toBe('7')
  })

  // No digits (Backspace, a letter) clears just that slot.
  it('no digits clears that slot only', () => {
    expect(enterDigits(['4', '8', '2', '', '', ''], 1, '')).toEqual({ slots: ['4', '', '2', '', '', ''], focus: 1 })
  })

  // The window checks the code only once all six slots hold a digit.
  it('the code exists only when all six slots hold a digit', () => {
    expect(codeFrom(['4', '8', '2', '9', '1', '3'])).toBe('482913')
    expect(codeFrom(['4', '8', '2', '9', '1', ''])).toBeNull()
    expect(codeFrom(['x', '8', '2', '9', '1', '3'])).toBeNull()
    expect(codeFrom(['4', '8', '2', '9', '1', 'x'])).toBeNull()
  })
})

describe('what the server said', () => {
  // Each answer is one quiet line; a confirmed code says nothing (the window closes).
  it('each code status has its line; locked and expired are dead', () => {
    expect(codeMessage('confirmed')).toBeNull()
    expect(codeMessage('wrong')).toBe('That code didn’t match.')
    expect(codeMessage('locked')).toBe('Too many tries.')
    expect(codeMessage('expired')).toBe('That code expired.')
    expect(codeIsDead('locked') && codeIsDead('expired')).toBe(true)
    expect(codeIsDead('wrong')).toBe(false)
  })

  // Every status the SQL and the function answer is known as itself (EMAIL_CONFIRM_PLAN.md §1-2):
  // one dropped from the list would read as an error.
  it('knows every status the server answers', () => {
    const code: CodeStatus[] = ['confirmed', 'wrong', 'locked', 'expired']
    const send: SendStatus[] = ['sent', 'confirmed', 'too_soon', 'too_many', 'send_failed', 'not_allowed', 'not_listed']
    for (const s of code) expect(codeStatus(s)).toBe(s)
    for (const s of send) expect(sendStatus(s)).toBe(s)
  })

  // Each failure says something, and something of its own (a status falling through to the
  // generic line would read the same as an error).
  it('each failure has its own line', () => {
    const lines = (['too_soon', 'too_many', 'send_failed', 'error'] as const).map(sendMessage)
    expect(lines.every(Boolean)).toBe(true)
    expect(new Set(lines).size).toBe(lines.length)
    expect(sendMessage('confirmed')).toBeNull()
    const codeLines = (['wrong', 'locked', 'expired', 'error'] as const).map(codeMessage)
    expect(codeLines.every(Boolean)).toBe(true)
    expect(new Set(codeLines).size).toBe(codeLines.length)
  })

  // An answer this build does not know is an error, never a success.
  it('an unknown answer is an error, never confirmed or sent', () => {
    expect(codeStatus('CONFIRMED')).toBe('error')
    expect(codeStatus(undefined)).toBe('error')
    expect(sendStatus('unauthorized')).toBe('error')
    expect(sendStatus('sent')).toBe('sent')
    expect(sendMessage('sent')).toBeNull()
    expect(sendMessage('too_soon')).toBeTruthy()
  })

  // The countdown reads m:ss and is gone once a send may go.
  it('counts down from 1:00 and is empty at zero', () => {
    expect(countdown(secondsLeft(1_000_000, 1_000_000))).toBe('1:00')
    expect(countdown(secondsLeft(1_000_000, 1_018_400))).toBe('0:42')
    expect(countdown(secondsLeft(1_000_000, 1_060_000))).toBe('')
    expect(secondsLeft(undefined, 5)).toBe(0)
  })

  // The link page's sentence names the kinds by their labels, in plain words.
  it('the confirmed line says whose and which enquiries', () => {
    expect(confirmedLine('Skeen', ['Booking'])).toBe('gets Skeen’s booking enquiries.')
    expect(confirmedLine('Skeen', ['Booking', 'Demo', 'Contact'])).toBe('gets Skeen’s booking, demo and contact enquiries.')
    expect(confirmedLine('Skeen', [])).toBe('gets Skeen’s enquiries.')
    expect(confirmedLine(' Skeen ', [])).toBe('gets Skeen’s enquiries.')
    expect(confirmedLine('  ', ['Booking'])).toBe('gets booking enquiries.')
    // One kind named twice, or blank, is said once or not at all.
    expect(kindWords(['Booking', 'booking ', ' '])).toBe('booking')
  })
})

describe('the loader’s status call (STRICT: a failed read must never look confirmed)', () => {
  // Every failure shows every address waiting, never confirmed. A missing function included:
  // the pre-push switch that turned the feature off failed OPEN, and went with the push.
  it('any error shows every address waiting', () => {
    for (const code of ['PGRST202', '42883', '42501', undefined])
      expect(confirmStateFrom({ data: null, error: { code } })).toEqual({ confirmed: [] })
    // No rows and no error: nothing is confirmed (default deny).
    expect(confirmStateFrom({ data: null, error: null })).toEqual({ confirmed: [] })
  })

  // Rows: only the confirmed ones, as one lower-case key each.
  it('rows give exactly the confirmed addresses', () => {
    const data = [
      { email: 'Agent@X.com', confirmed: true, waiting: false },
      { email: 'new@x.com', confirmed: false, waiting: true },
      { email: 'odd@x.com', confirmed: 'true', waiting: false },
      { email: null, confirmed: true, waiting: false },
    ]
    expect(confirmStateFrom({ data, error: null })).toEqual({ confirmed: ['agent@x.com'] })
  })
})
