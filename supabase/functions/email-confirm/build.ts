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
 * The subject, the same for everyone (Sam, 2026-10-05: "it can just say Confirm Email … for
 * subject"). Fixed words, so no manager's text ever reaches a mail header.
 */
export const CONFIRM_SUBJECT = 'Confirm Email'

/** Who sends it. Never bare "Tapir" (Sam, 2026-10-05: "its called Digital Tapir"). */
export const FROM_NAME = 'Digital Tapir'

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
  const who = name ? `${name}'s team` : `A team on ${FROM_NAME}`
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

// Mail clients ignore <style> blocks unevenly, so every rule is inline, on tables (Outlook).
// The dashboard's fonts first with safe fallbacks (Gmail will not load web fonts).
const SANS = "'Instrument Sans', Helvetica, Arial, sans-serif"
const MONO = "'Space Mono', ui-monospace, Menlo, Consolas, monospace"
const INK = '#111111'
const MUTED = '#3f3f46'
const FAINT = '#9aa0a6'

/** A host fit to be a link: the SQL hands over a bare lower-case host, and anything else is
 *  shown as text, never put in an href. */
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** The sentence as HTML: the same words as `sentence`, with the site a quiet black link (left
 *  as text, Gmail turned it into a blue one). "www." is dropped from what is shown. */
function sentenceHtml(e: ConfirmEmail): string {
  const name = stripHeader(e.artistName)
  const who = escapeHtml(name ? `${name}'s team` : `A team on ${FROM_NAME}`)
  const kinds = kindsToWords(e.kinds)
  const host = stripHeader(e.siteHost ?? '')
  const site = !host
    ? ''
    : HOST_RE.test(host)
      ? ` from <a href="https://${host}" style="color:${INK};text-decoration:underline;">${escapeHtml(host.replace(/^www\./, ''))}</a>`
      : ` from ${escapeHtml(host)}`
  return `${who} wants to send ${kinds ? `${escapeHtml(kinds)} ` : ''}enquiries${site} to this address.`
}

/** The code on six lines, like the window it is typed into (style B, Sam 2026-10-05: "lets do
 *  B"); a gap after the third. Not six digits (never, from the SQL): shown as one piece. */
function codeHtml(code: string): string {
  const cell = (d: string) =>
    `<td style="width:34px;padding:0 4px 6px;border-bottom:2px solid ${INK};text-align:center;font-family:${MONO};font-size:30px;font-weight:700;line-height:1.2;color:${INK};">${escapeHtml(d)}</td>`
  const gap = (w: number) => `<td style="width:${w}px;font-size:0;line-height:0;">&nbsp;</td>`
  if (!/^\d{6}$/.test(code)) {
    return `<p style="margin:0;font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:6px;color:${INK};">${escapeHtml(code)}</p>`
  }
  const d = code.split('')
  const row = [cell(d[0]), gap(8), cell(d[1]), gap(8), cell(d[2]), gap(22), cell(d[3]), gap(8), cell(d[4]), gap(8), cell(d[5])].join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${row}</tr></table>`
}

/**
 * Style B (prototypes/confirm_email_style_20261005.html): a black band with the name, "Confirm
 * email", the sentence, the code on six lines, how long it lives, then the Confirm button (when
 * the dashboard is online) or who to give the code to, and the opt-out under a hairline.
 *
 * The six cells split the code, so a hidden preheader carries it whole: the inbox preview reads
 * "Your code is 482 913", and that is the line a phone offers to copy.
 */
export function buildConfirmHtml(e: ConfirmEmail): string {
  const link = confirmLink(e.appUrl, e.token)
  const code = formatCode(e.code)
  const pad = 'padding-left:28px;padding-right:28px;'
  const row = (style: string, html: string) => `<tr><td style="${pad}${style}">${html}</td></tr>`
  const text = (size: number, color: string) => `font-family:${SANS};font-size:${size}px;line-height:1.55;color:${color};`
  const then = link
    ? row(
        'padding-top:26px;',
        `<a href="${escapeHtml(link)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;padding:12px 26px;">Confirm</a>`,
      )
    : row(`padding-top:26px;${text(15, INK)}`, escapeHtml(handOver(e)))
  const rows = [
    `<tr><td style="background:${INK};${pad}padding-top:14px;padding-bottom:14px;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">${escapeHtml(FROM_NAME)}</td></tr>`,
    row(`padding-top:32px;font-family:${SANS};font-size:22px;font-weight:600;letter-spacing:-0.2px;color:${INK};`, 'Confirm email'),
    row(`padding-top:10px;${text(15, MUTED)}`, sentenceHtml(e)),
    row('padding-top:30px;', codeHtml(e.code)),
    row(`padding-top:12px;font-family:${MONO};font-size:11px;letter-spacing:0.5px;color:${FAINT};`, 'Works for 15 minutes'),
    then,
    row(
      'padding-top:28px;padding-bottom:28px;',
      `<div style="border-top:1px solid #ececec;padding-top:16px;${text(13, FAINT)}">${escapeHtml(IGNORE)}</div>`,
    ),
  ]
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${escapeHtml(code)}</div>`
  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">${preheader}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;border:1px solid ${INK};">${rows.join('')}</table>` +
    `</td></tr></table></body></html>`
  )
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
