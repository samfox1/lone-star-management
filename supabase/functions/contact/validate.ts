/**
 * Pure helpers for the /contact Edge Function.
 *
 * ZERO IMPORTS, ZERO DENO GLOBALS, ON PURPOSE. This file is the testability lever for
 * the whole function: vitest (which runs in Node, see vitest.config.ts) imports it
 * directly, so validation, IP extraction, hashing and header composition are covered by
 * the normal `npm test` run even though the surrounding function only ever executes in
 * Deno on Supabase's edge. Anything that needs `Deno.env`, `fetch`, or a Supabase client
 * belongs in index.ts, not here.
 *
 * `crypto.subtle` is the one runtime API used, and it is a web standard present in both
 * Deno and Node 20+, so it does not break that rule.
 */

/** Mirrors the CHECK constraint on enquiries.message. */
export const MESSAGE_MAX = 5000
export const NAME_MAX = 200
export const EMAIL_MAX = 320

/**
 * Deliberately the SAME shape as the regex in the Postgres door (20260722130000) and
 * in site-content-schema.ts. Not RFC 5322 — a full-fidelity email regex rejects real
 * addresses and accepts nonsense, and the real validation is that a human replies.
 * The job here is only to reject obvious junk and anything carrying a header break.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type Purpose = 'booking' | 'demo' | 'other'

export type ContactBody = {
  slug: string
  purpose: Purpose
  name: string
  email: string
  message: string
}

export type ValidationError = 'missing_field' | 'invalid_email' | 'message_too_long'

export type ValidationResult =
  /** A real submission, trimmed and coerced. */
  | { kind: 'ok'; value: ContactBody }
  /**
   * The hidden `website` field came back non-empty, so this is a bot. The caller must
   * respond 200 {ok:true} and drop it silently — telling the bot it was caught just
   * teaches whoever wrote it to leave the field alone next time.
   */
  | { kind: 'honeypot'; slug: string; purpose: Purpose }
  | { kind: 'error'; error: ValidationError; slug: string; purpose: Purpose }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Unrecognized purposes COERCE to 'other' rather than failing. A site that ships a new
 * purpose value before the backend knows about it should still deliver its enquiries.
 */
export function coercePurpose(v: unknown): Purpose {
  return v === 'booking' || v === 'demo' || v === 'other' ? v : 'other'
}

export function validateBody(raw: unknown): ValidationResult {
  const body = (raw ?? {}) as Record<string, unknown>
  const slug = str(body.slug).trim()
  const purpose = coercePurpose(body.purpose)

  // Honeypot is checked FIRST, before any other rejection, so a bot that also sends a
  // malformed body still gets the silent 200 rather than a revealing 400.
  if (str(body.website).trim() !== '') return { kind: 'honeypot', slug, purpose }

  const name = str(body.name).trim()
  const email = str(body.email).trim()
  const message = str(body.message).trim()

  if (!slug || !name || !email || !message) {
    return { kind: 'error', error: 'missing_field', slug, purpose }
  }
  // Length is checked BEFORE syntax so a 2MB blob gets the accurate error rather than
  // being reported as a bad address.
  if (message.length > MESSAGE_MAX) {
    return { kind: 'error', error: 'message_too_long', slug, purpose }
  }
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { kind: 'error', error: 'invalid_email', slug, purpose }
  }

  return {
    kind: 'ok',
    value: { slug, purpose, name: name.slice(0, NAME_MAX), email, message },
  }
}

/**
 * The client IP, as far as we can trust it.
 *
 * `x-forwarded-for` is a comma-separated chain and only the FIRST entry is the original
 * client; everything after it was appended by proxies and is trivially forgeable by
 * anyone who sends their own header. Taking the last entry (a common mistake) lets an
 * attacker pick their own rate-limit bucket per request.
 *
 * When no header is present at all we return the literal 'unknown' rather than skipping
 * the limit, so a caller who strips headers lands in ONE shared bucket and gets
 * STRICTER treatment than a normal visitor, not an exemption.
 */
export function firstForwardedIp(headers: { get(name: string): string | null }): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  return 'unknown'
}

/**
 * SHA-256(salt : ip), hex, truncated to 32 chars (128 bits — far past collision
 * concerns at this volume).
 *
 * THE SALT IS NOT OPTIONAL. The entire IPv4 space is about 4 billion values, so an
 * unsalted hash is reversible by brute force in seconds and the column would be a
 * plaintext IP column wearing a disguise. Hashing here rather than in Postgres also
 * means the raw IP never crosses the wire into the database at all.
 */
export async function hashIp(salt: string, ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

/**
 * Strip anything that could break out of an SMTP header. CR and LF are the injection
 * vector (they start a new header line, which is how a `Bcc:` gets smuggled in); the
 * rest are control characters with no business in a display name.
 */
export function stripHeader(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * `"Skeen Site" <noreply@mail.example.com>` — quoted so a display name containing a
 * comma or a period doesn't corrupt the address list. Inner quotes and backslashes are
 * escaped rather than dropped.
 */
export function formatFrom(name: string, address: string): string {
  const clean = stripHeader(name).replace(/["\\]/g, '')
  return clean ? `"${clean}" <${address}>` : address
}

const PURPOSE_LABEL: Record<Purpose, string> = {
  booking: 'Booking',
  demo: 'Demo',
  other: 'Contact',
}

/** e.g. `[Booking] Skeen — enquiry from Jane Promoter` */
export function buildSubject(purpose: Purpose, artistName: string, visitorName: string): string {
  return stripHeader(
    `[${PURPOSE_LABEL[purpose]}] ${artistName} — enquiry from ${visitorName}`,
  ).slice(0, 200)
}

/**
 * Echo the caller's Origin only if it is on the allowlist, otherwise fall back to the
 * first configured origin (which fails the browser's check and blocks the response).
 *
 * `*` would be technically safe here — no cookies are involved and the anon key is
 * public — but it would let ANY site on the internet post their form through our
 * verified sending domain into our artists' inboxes. The allowlist is the difference
 * between a contact form and an open relay with extra steps.
 */
export function pickOrigin(origin: string | null, allowed: string[]): string {
  if (origin && allowed.includes(origin)) return origin
  return allowed[0] ?? 'null'
}

/** Parse the comma-separated CONTACT_ALLOWED_ORIGINS secret. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}
