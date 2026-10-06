/**
 * CONFIRMING AN ADDRESS before enquiries go to it (EMAIL_CONFIRM_PLAN.md, Sam 2026-09-30: "a
 * confirmation email sent with a code for us to make sure the email is legit"). The pure half of
 * the dashboard's code window and the public link page: the six slots, the statuses as words,
 * the countdown, what the loader's status call means, and the link token's shape.
 *
 * The rules themselves (15 minutes, 5 tries, 60 s between sends, hashes only) live in SQL
 * (20261006120000_email_confirmations.sql). Nothing here decides who receives anything: an
 * address the dashboard draws as confirmed is still routed only if the database says so.
 */
import { clockTime, listWords, minutesSeconds } from '@/lib/manager-tools/format'

/** Digits in a code (begin_email_confirmation mints six). */
export const CODE_LENGTH = 6

/** Seconds between sends to one address (the SQL refuses sooner with `too_soon`). */
const RESEND_SECONDS = 60

/** The same address however it was typed: confirmation is per (artist, lower(email)). */
export function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// The six slots
// ---------------------------------------------------------------------------
/** What was typed or pasted, as a code's digits: everything else dropped ("482 913", "Your
 *  code is 482913."), at most six. */
export function codeDigits(text: string): string {
  return text.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

export const EMPTY_SLOTS: readonly string[] = Array.from({ length: CODE_LENGTH }, () => '')

/**
 * Text arriving in slot `at`, as the slots after it and the slot to focus next:
 *
 *   a whole code   six digits, wherever they land (a paste, a phone's one-time-code autofill),
 *                  fill every slot from the first
 *   fewer digits   fill from `at` on, as far as they go; focus moves past them
 *   no digits      clears slot `at` (Backspace, or a letter typed into it)
 *
 * `prev` is what slot `at` held before a keypress: a digit typed beside it arrives as two, and
 * the new one is kept.
 */
export function enterDigits(slots: readonly string[], at: number, text: string, prev = ''): { slots: string[]; focus: number } {
  let digits = codeDigits(text)
  if (digits.length === CODE_LENGTH) return { slots: digits.split(''), focus: CODE_LENGTH - 1 }
  const next = [...slots]
  if (!digits) {
    next[at] = ''
    return { slots: next, focus: at }
  }
  if (prev && digits.length === 2) digits = digits[0] === prev ? digits[1] : digits[0]
  for (let j = 0; j < digits.length && at + j < CODE_LENGTH; j++) next[at + j] = digits[j]
  return { slots: next, focus: Math.min(at + digits.length, CODE_LENGTH - 1) }
}

/** The code, once every slot holds a digit; null until then. */
export function codeFrom(slots: readonly string[]): string | null {
  const code = slots.join('')
  return code.length === CODE_LENGTH && /^\d+$/.test(code) ? code : null
}

// ---------------------------------------------------------------------------
// What the server said, as words
// ---------------------------------------------------------------------------
/** confirm_email_code's answers ('replaced' and 'locked_today' since 20261006150000). */
export type CodeStatus = 'confirmed' | 'wrong' | 'replaced' | 'locked' | 'locked_today' | 'expired'
/** The email-confirm function's answers (begin_email_confirmation's, plus the send). */
export type SendStatus = 'sent' | 'confirmed' | 'too_soon' | 'too_many' | 'send_failed' | 'not_allowed' | 'not_listed'

const CODE_STATUSES: readonly CodeStatus[] = ['confirmed', 'wrong', 'replaced', 'locked', 'locked_today', 'expired']
const SEND_STATUSES: readonly SendStatus[] = ['sent', 'confirmed', 'too_soon', 'too_many', 'send_failed', 'not_allowed', 'not_listed']

/** An answer this build knows, or 'error' (a network failure, a 401, a status added later). */
export function codeStatus(value: unknown): CodeStatus | 'error' {
  return CODE_STATUSES.find((s) => s === value) ?? 'error'
}
export function sendStatus(value: unknown): SendStatus | 'error' {
  return SEND_STATUSES.find((s) => s === value) ?? 'error'
}

/**
 * The window's quiet line after a code is checked: WHY it was refused and what to do next (Sam,
 * 2026-10-05: "Please provide clear error messaging to help me understand why", after Ross's code
 * from an earlier email was refused as "didn't match" and the right one had run out). Nothing
 * when it confirmed. `sentAt`: when the current code went out, to say when it ran out.
 */
export function codeMessage(status: CodeStatus | 'error', sentAt?: number): string | null {
  switch (status) {
    case 'confirmed':
      return null
    case 'wrong':
      return 'That code didn’t match. Check it against the newest email.'
    case 'replaced':
      return 'That’s the code from an earlier email. A newer one replaced it: use the newest email.'
    case 'locked':
      return 'Five wrong tries used up this code. Send a new one with the arrow below.'
    case 'locked_today':
      return 'Too many wrong tries today for this address. Try again tomorrow.'
    case 'expired':
      return sentAt === undefined
        ? 'This code ran out (codes last 15 minutes). Send a new one with the arrow below.'
        : `This code ran out at ${clockTime(new Date(sentAt + CODE_LIFE_MS))} (codes last 15 minutes). Send a new one with the arrow below.`
    default:
      return 'Couldn’t check that code. Try again.'
  }
}

/** A code that cannot be tried again: only a new send (or, for the day's lock, tomorrow) brings
 *  the slots back. */
export function codeIsDead(status: CodeStatus | 'error'): boolean {
  return status === 'locked' || status === 'locked_today' || status === 'expired'
}

/** The window's one quiet line after a send; nothing when it went (or was already confirmed). */
export function sendMessage(status: SendStatus | 'error'): string | null {
  switch (status) {
    case 'sent':
    case 'confirmed':
      return null
    case 'too_soon':
      return 'A code just went out. You can send another in a minute.'
    case 'too_many':
      return 'That’s the limit for now: 5 codes an hour and 10 a day for one address. Try again later.'
    case 'send_failed':
      return 'The email didn’t send. Try again in a minute.'
    case 'not_listed':
      return 'This address isn’t on any list now, so no code was sent.'
    case 'not_allowed':
      return 'You can’t send codes for this artist.'
    default:
      return 'Couldn’t send the code. Try again.'
  }
}

/** Seconds until the next send may go, from when the last one did. */
export function secondsLeft(sentAt: number | undefined, now: number): number {
  if (sentAt === undefined) return 0
  return Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000))
}

/** The countdown beside the resend glyph: "1:00", "0:42"; nothing once it may send. */
export function countdown(seconds: number): string {
  if (seconds <= 0) return ''
  return minutesSeconds(seconds)
}

// ---------------------------------------------------------------------------
// What the Settings › Email loader read
// ---------------------------------------------------------------------------
/**
 * Which addresses show as confirmed. DEFAULT DENY, like the SQL: an address not listed as
 * confirmed is waiting (blue, with the key). `liveCodes`: for a waiting address whose code can
 * still be typed, when it went out (ms), so a click opens the window on THAT code instead of
 * sending a new one over it (20261006140000).
 */
export type ConfirmState = { confirmed: string[]; liveCodes?: Record<string, number> }

/**
 * `email_confirmation_status(p_artist_id)` as a ConfirmState.
 *
 * ANY error shows every address waiting, never confirmed: a manager reading ink would believe
 * enquiries reach someone the database may be refusing. (Until 20261006120000 was pushed a
 * missing function switched the feature off; that branch failed OPEN and went with the push.)
 */
export function confirmStateFrom(res: { data: unknown; error: { code?: string } | null }): ConfirmState {
  if (res.error) return { confirmed: [], liveCodes: {} }
  const rows = Array.isArray(res.data) ? (res.data as { email?: unknown; confirmed?: unknown; live_code_sent_at?: unknown }[]) : []
  const liveCodes: Record<string, number> = {}
  for (const r of rows) {
    const at = typeof r.live_code_sent_at === 'string' ? Date.parse(r.live_code_sent_at) : NaN
    if (typeof r.email === 'string' && r.confirmed !== true && Number.isFinite(at)) liveCodes[emailKey(r.email)] = at
  }
  return {
    confirmed: rows.filter((r) => r.confirmed === true && typeof r.email === 'string').map((r) => emailKey(r.email as string)),
    liveCodes,
  }
}

/** How long a code can be typed (the SQL's 15 minutes). A code sent on this visit counts as
 *  live until then, so a second click does not send over it. */
const CODE_LIFE_MS = 15 * 60 * 1000

/** A code sent at `sentAt` can still be typed at `now`. */
export function codeIsLive(sentAt: number | undefined, now: number): boolean {
  return sentAt !== undefined && now - sentAt < CODE_LIFE_MS
}

// ---------------------------------------------------------------------------
// The link page (/confirm-email/[token])
// ---------------------------------------------------------------------------
/**
 * A link token's shape: 32 random bytes as url-safe base64 with the padding cut, exactly 43
 * characters of [A-Za-z0-9_-] (begin_email_confirmation). Anything else is not a token this
 * system minted, and is refused before any database call.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function isConfirmToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value)
}

/** What the link page shows after its button. Only `confirmed` names anyone: an unknown, used
 *  or expired token says nothing about whose it was. */
export type TokenResult =
  | { status: 'confirmed'; email: string; artistName: string; kinds: string[] }
  | { status: 'invalid' }
  | { status: 'error' }

/** confirm_email_token's row as a TokenResult. A row that is not a whole confirmation is
 *  `invalid`. */
export function tokenResult(row: unknown): TokenResult {
  const r = (row ?? {}) as { status?: unknown; email?: unknown; artist_name?: unknown; kinds?: unknown }
  if (r.status !== 'confirmed' || typeof r.email !== 'string' || !r.email) return { status: 'invalid' }
  return {
    status: 'confirmed',
    email: r.email,
    artistName: typeof r.artist_name === 'string' ? r.artist_name : '',
    kinds: Array.isArray(r.kinds) ? r.kinds.filter((k): k is string => typeof k === 'string' && !!k.trim()) : [],
  }
}

/** Kind labels in a sentence: "booking", "booking and demo", "booking, demo and contact". */
export function kindWords(kinds: readonly string[]): string {
  return listWords([...new Set(kinds.map((k) => k.trim().toLowerCase()).filter(Boolean))])
}

/** After the address on the confirmed page: "gets Skeen’s booking enquiries." */
export function confirmedLine(artistName: string, kinds: readonly string[]): string {
  const whose = artistName.trim() ? `${artistName.trim()}’s ` : ''
  const what = kindWords(kinds)
  return `gets ${whose}${what ? `${what} ` : ''}enquiries.`
}
