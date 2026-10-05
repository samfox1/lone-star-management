/**
 * Pure helpers for the /email-confirm Edge Function: the confirmation email's words and HTML,
 * the request parse, and the one status word the caller gets back.
 *
 * Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to make sure
 * the email is legit". The plan of record is EMAIL_CONFIRM_PLAN.md (piece 2).
 *
 * NO DENO GLOBALS, ON PURPOSE, same as contact/validate.ts: vitest runs in Node and imports this
 * file directly (tests/unit/enquiries/email-confirm-build.test.ts), so everything that decides
 * what the email says is covered by `npm test` even though index.ts only ever runs on the edge.
 * The one import is contact's header scrubber, which is pure too.
 *
 * THE HTML IS THE RISK. The artist name, the site host and the kind labels are all typed by
 * managers, and they land in markup a stranger opens in their mail client. Every interpolated
 * value goes through escapeHtml, no exceptions; the test plants a hostile artist name.
 */
import { stripHeader } from '../contact/validate.ts'

/** What begin_email_confirmation hands back on 'sent' that the email needs. */
export type ConfirmEmail = {
  artistName: string
  /** The LABELS of the kinds whose lists hold this address ("Booking", "Sync licensing").
   *  A Postgres text[] can hold a null, so the type says so. */
  kinds: (string | null)[]
  /** The artist's site, as a bare host ("skeen.com"). Null when they have none yet. */
  siteHost: string | null
  /** The six digits, plaintext. Exists only between the SQL call and this email. */
  code: string
  /** The url-safe link token, plaintext. Same lifetime as the code. */
  token: string
  /** Where the dashboard runs (APP_URL). Without it there is no link, only the code. */
  appUrl: string | null
}

/** Text and attribute safe: the five characters that matter in either. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * ['Booking', 'Demo', 'Contact'] → "booking, demo and contact". Empty → "", so the sentence
 * reads "...wants to send enquiries...". Blanks and repeats are dropped: the SQL should hand
 * over each kind once, but a doubled word in a sentence a stranger reads is worth one line.
 */
export function kindsToWords(kinds: (string | null)[]): string {
  const seen = new Set<string>()
  const words: string[] = []
  for (const k of kinds) {
    const w = stripHeader(k ?? '').toLowerCase()
    if (!w || seen.has(w)) continue
    seen.add(w)
    words.push(w)
  }
  if (words.length < 2) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * "Confirm Skeen's enquiries". A mail HEADER, so stripHeader runs over the name: a manager's
 * CR/LF is how a Bcc: gets smuggled in.
 */
export function buildConfirmSubject(artistName: string): string {
  // Cut short: the name is a manager's free text, and a subject line is the one place a
  // stranger reads it before deciding what this email is (a review, 2026-10-05).
  const name = cutName(stripHeader(artistName))
  return name ? `Confirm ${name}'s enquiries` : 'Confirm your enquiries address'
}

/** The longest artist name a subject carries; longer ends in "…". */
export const SUBJECT_NAME_MAX = 60

function cutName(name: string): string {
  return name.length > SUBJECT_NAME_MAX ? `${name.slice(0, SUBJECT_NAME_MAX - 1).trimEnd()}…` : name
}

/** "482913" → "482 913", easier to read off a phone. Anything else is shown as it came. */
export function formatCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/**
 * `${APP_URL}/confirm-email/<token>`, or null without APP_URL: the link page only works where
 * the dashboard is online, and a wrong link in an email cannot be fixed after it is sent.
 * The token is encoded so a stray `/` or `+` from the SQL cannot leave its path segment.
 */
export function confirmLink(appUrl: string | null, token: string): string | null {
  const base = (appUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return null
  return `${base}/confirm-email/${encodeURIComponent(token)}`
}

/** "<Artist>'s team wants to send <kinds> enquiries from <host> to this address." */
function sentence(e: ConfirmEmail): string {
  const name = stripHeader(e.artistName)
  const who = name ? `${name}'s team` : 'A team on Tapir'
  const kinds = kindsToWords(e.kinds)
  const host = stripHeader(e.siteHost ?? '')
  return `${who} wants to send ${kinds ? `${kinds} ` : ''}enquiries${host ? ` from ${host}` : ''} to this address.`
}

const IGNORE = 'Not you? Ignore this email and nothing is sent.'

/** Without the link, the code is the only way, and it is typed by whoever added the address:
 *  the email must say so, or a booking agent holds a code with nowhere to put it. */
function handOver(e: ConfirmEmail): string {
  const name = stripHeader(e.artistName)
  return `To confirm, give this code to ${name ? `${name}'s team` : 'whoever added this address'}.`
}
const CODE_LIFE = 'The code works for 15 minutes.'

export function buildConfirmText(e: ConfirmEmail): string {
  const link = confirmLink(e.appUrl, e.token)
  const lines = [sentence(e), '', `Your code: ${formatCode(e.code)}`, CODE_LIFE, '']
  lines.push(link ? `Or confirm here: ${link}` : handOver(e), '')
  lines.push(IGNORE)
  return lines.join('\n')
}

// Mail clients ignore <style> blocks unevenly, so every rule is inline. Black and white, the
// dashboard's fonts first with safe fallbacks (most clients will not load web fonts).
const SANS = "'Instrument Sans', Helvetica, Arial, sans-serif"
const MONO = "'Space Mono', ui-monospace, Menlo, Consolas, monospace"

export function buildConfirmHtml(e: ConfirmEmail): string {
  const link = confirmLink(e.appUrl, e.token)
  const p = (text: string, extra = '') =>
    `<p style="margin:0 0 20px;font-family:${SANS};font-size:15px;line-height:1.5;color:#000;${extra}">${escapeHtml(text)}</p>`
  const parts = [
    p(sentence(e)),
    `<p style="margin:0 0 8px;font-family:${MONO};font-size:28px;letter-spacing:4px;color:#000;">${escapeHtml(formatCode(e.code))}</p>`,
    p(CODE_LIFE, 'color:#555;font-size:13px;'),
  ]
  if (link) {
    parts.push(
      `<p style="margin:0 0 24px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;padding:12px 24px;">Confirm</a></p>`,
    )
  } else {
    parts.push(p(handOver(e)))
  }
  parts.push(p(IGNORE, 'color:#555;font-size:13px;margin:0;'))
  return `<!doctype html><html><body style="margin:0;padding:32px 24px;background:#fff;"><div style="max-width:480px;">${parts.join('')}</div></body></html>`
}

// ---- The request and the reply ---------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The same loose shape as contact's EMAIL_RE: reject junk, not judge addresses. The real
 *  check is the SQL's "is this on one of the artist's lists". */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMAIL_MAX = 320

/**
 * `{ artistId, email }` or null. A non-uuid artistId is refused HERE because PostgREST would
 * turn it into a 22P02 and the caller would see a 500 instead of a 400.
 */
export function parseConfirmRequest(raw: unknown): { artistId: string; email: string } | null {
  const { artistId, email } = Object(raw) as Record<string, unknown>
  // typeof first: a JSON array ['<uuid>'] stringifies to the uuid and would pass the regex.
  if (typeof artistId !== 'string' || !UUID_RE.test(artistId)) return null
  if (typeof email !== 'string') return null
  const e = email.trim().toLowerCase()
  if (e.length > EMAIL_MAX || !EMAIL_RE.test(e)) return null
  return { artistId, email: e }
}

/** One row of begin_email_confirmation, as PostgREST returns it. */
export type BeginRow = {
  status?: unknown
  code?: string | null
  token?: string | null
  artist_name?: string | null
  kinds?: string[] | null
  site_host?: string | null
}

/** A set-returning function comes back as an array, a single composite as an object.
 *  No shape check here: replyStatus is the gate, and index.ts reads the row only after it. */
export function firstRow(raw: unknown): BeginRow | null | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as BeginRow | null | undefined
}

const STATUS_RE = /^[a-z]+(_[a-z]+)*$/

/**
 * The ONE thing the caller gets back: the SQL's status word, passed straight through
 * ('sent', 'confirmed', 'too_soon', 'too_many', 'not_listed', 'not_allowed', …), or null when
 * there is none. Only lower-case letters and underscores pass, so a code (digits), a token
 * (base64url) or an address (@) can never be echoed by a SQL change that put one in the
 * wrong column.
 */
export function replyStatus(raw: unknown): string | null {
  const s = firstRow(raw)?.status
  return typeof s === 'string' && STATUS_RE.test(s) ? s : null
}
