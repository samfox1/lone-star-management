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
import { parseAllowedOrigins, pickAllowedOrigin } from '../_shared/cors.ts'

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

/** Mirrors `contact_attempts_slug_len`. Artist slugs are ≤ 15 characters today. */
export const SLUG_STORE_MAX = 80

/**
 * An artist-defined enquiry kind, as a slug: 'booking', 'demo', 'press', 'sync'.
 *
 * No longer a union of three. Kinds live in `enquiry_kinds` and are the artist's to
 * invent, so this endpoint cannot hold the list — it would need redeploying every time
 * somebody added one. What it CAN enforce is the shape, which is what PURPOSE_RE does.
 */
export type Purpose = string

/** Mirrors ek_slug_fmt on enquiry_kinds and the purpose CHECK on enquiries. */
export const PURPOSE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** The kind every artist has and the one anything unrecognisable becomes. */
export const PURPOSE_FALLBACK = 'other'

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
  if (typeof v !== 'string') return PURPOSE_FALLBACK
  const slug = v.trim().toLowerCase()
  return PURPOSE_RE.test(slug) ? slug : PURPOSE_FALLBACK
}

export function validateBody(raw: unknown): ValidationResult {
  const body = (raw ?? {}) as Record<string, unknown>
  // Bounded: it is stored on every REJECTED attempt too, and an unbounded value there is
  // free storage for anyone probing the endpoint (contact_attempts_slug_len mirrors it).
  const slug = str(body.slug).trim().slice(0, SLUG_STORE_MAX)
  const purpose = coercePurpose(body.purpose)

  // Honeypot is checked FIRST, before any other rejection, so a bot that also sends a
  // malformed body still gets the silent 200 rather than a revealing 400.
  if (str(body.website).trim() !== '') return { kind: 'honeypot', slug, purpose }

  const name = str(body.name).trim()
  const email = str(body.email).trim()
  const message = str(body.message).trim()

  // MESSAGE IS NO LONGER REQUIRED HERE. A demo is a link and some audio; insisting on a
  // note as well would reject a perfectly good submission for not saying hello. What must
  // be true is that the enquiry carries SOMETHING, and only the caller knows that — the
  // demo link and the attachments are validated after this. See `hasContent`.
  if (!slug || !name || !email) {
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
 * SHA-256(salt : ip), hex, truncated to 32 chars (128 bits — far past collision
 * concerns at this volume).
 *
 * THE SALT IS NOT OPTIONAL. The entire IPv4 space is about 4 billion values, so an
 * unsalted hash is reversible by brute force in seconds and the column would be a
 * plaintext IP column wearing a disguise. Hashing here rather than in Postgres also
 * means the raw IP never crosses the wire into the database at all.
 */
export { hashIp } from '../_shared/hash.ts'

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

/**
 * e.g. `[Booking] Skeen — enquiry from Jane Promoter`
 *
 * Takes the KIND'S LABEL, not its slug. This used to be a three-entry map right here,
 * which stopped being possible the moment kinds became the artist's to define — the label
 * for 'sync-licensing' is whatever they typed, and only the database knows it. It arrives
 * as `purpose_label` on the submit_enquiry row, already defaulted there.
 *
 * `stripHeader` still runs over the whole line: the label is manager-supplied text landing
 * in a mail header, and ek_label_clean rejecting CR/LF at the storage layer is the other
 * half of the same belt-and-braces, not a reason to skip this one.
 */
export function buildSubject(purposeLabel: string, artistName: string, visitorName: string): string {
  // No `.trim()` after stripHeader — that function already ends in one, so a second call
  // could never change the result (it survived mutation for exactly that reason).
  const label = stripHeader(purposeLabel ?? '') || 'Contact'
  return stripHeader(`[${label}] ${artistName} — enquiry from ${visitorName}`).slice(0, 200)
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
export const pickOrigin = pickAllowedOrigin

/** Parse the comma-separated CONTACT_ALLOWED_ORIGINS secret. */
export { parseAllowedOrigins }

/* ── Demo links and audio attachments ───────────────────────────────────────────── */

/** Mirrors the CHECK on enquiries.demo_url. */
export const DEMO_URL_MAX = 2048

/** At most three per enquiry. A demo is a demo, not a discography, and every ticket is a
 *  write capability handed to an unauthenticated stranger. */
export const ATTACHMENTS_MAX = 3

/** What the private bucket accepts. Kept in step with the bucket's own
 *  allowed_mime_types — the bucket is the real guard; this stops a ticket ever being
 *  minted for a file the bucket would refuse. */
export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
] as const

export type AttachmentRequest = { filename: string; mime_type: string; bytes: number }

export type SkipReason = 'invalid_demo_url' | 'unsupported_audio_type' | 'too_many_attachments'
export type SkippedItem = { item: string; reason: SkipReason }

export type DemoUrlResult = { value: string | null; skipped: SkippedItem[] }

/**
 * The optional demo link: **https only**.
 *
 * A REJECTED LINK DOES NOT FAIL THE ENQUIRY. That was the original design and it was
 * wrong — skeen caught it: this endpoint stores the enquiry before it even tries to send,
 * specifically so a message is never lost to a downstream problem, and then the first
 * version of this rejected the whole submission over one bad optional field. Same
 * principle, applied inconsistently. A bad link is dropped and NAMED, so the visitor is
 * told rather than quietly having part of their message discarded.
 *
 * `javascript:` and `data:` are the dangerous ones — this is attacker-controlled text a
 * MANAGER clicks in their own dashboard. `http:` is refused too: a demo link is not worth
 * a downgrade, and allowing it doubles the surface for nothing.
 *
 * Control characters are stripped before the scheme is read, because browsers ignore
 * whitespace embedded in a scheme token: `java\tscript:` executes.
 *
 * DELIBERATELY REDUNDANT with the `url.protocol` check below — a mutation sweep confirmed
 * removing either one changes no behaviour today, because `new URL()` normalises the
 * scheme and rejects the rest. It stays because that normalisation is the runtime's, and
 * this code runs on Deno at the edge while its tests run on Node: leaning on two engines
 * agreeing about a security decision is not a bet worth taking to delete two lines. If
 * you are here to remove dead code, this is not it.
 */
export function validateDemoUrl(raw: unknown): DemoUrlResult {
  if (typeof raw !== 'string') return { value: null, skipped: [] }
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, skipped: [] }

  const reject: DemoUrlResult = { value: null, skipped: [{ item: 'demo link', reason: 'invalid_demo_url' }] }
  if (trimmed.length > DEMO_URL_MAX) return reject

  // A link carrying a control character or a raw space is REFUSED, not quietly stored.
  // `collapsed` used to feed the prefix test only, while the value RETURNED was the raw
  // `trimmed` — so "https://x.example/a\rb" was accepted and its carriage return went on
  // into the email body and the database. Nothing in a real URL needs those bytes, and a
  // dropped link is named in `skipped` rather than lost.
  const collapsed = trimmed.replace(/[\u0000-\u0020\u007f]/g, '')
  if (collapsed !== trimmed) return reject
  // THESE TWO CHECKS ARE DELIBERATELY REDUNDANT, and each therefore survives mutation:
  // disable either and the other still rejects every non-https input, so no test can tell
  // them apart. That is the point — see the header. Do not "simplify" one away.
  if (!/^https:\/\//i.test(collapsed)) return reject

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return reject
    return { value: trimmed, skipped: [] }
  } catch {
    return reject
  }
}

export type AttachmentsResult = { value: AttachmentRequest[]; skipped: SkippedItem[] }

/**
 * Validate the attachment METADATA a visitor sends, before any ticket is minted.
 *
 * NEVER FAILS THE ENQUIRY. An unsupported file is dropped and named; files past the cap
 * are dropped and named. The message always gets through — losing a real person's enquiry
 * to save them from their own file picker is the worse outcome, and skeen had already
 * reached the same conclusion independently for oversized files.
 *
 * Dropping is not silent. A visitor who deliberately attached something expects it to
 * arrive, so saying nothing reads as acceptance; the caller is handed the list to show.
 *
 * No bytes travel through this endpoint. The client describes what it intends to upload
 * and the server decides whether to hand back a scoped write capability. `bytes` is
 * advisory, for display: a number in a JSON body constrains nothing, and the bucket's own
 * size limit is what actually applies.
 */
/**
 * Does this enquiry carry anything at all?
 *
 * The real invariant, replacing "message is required". A booking with no message is
 * useless; a demo with a link and two tracks is complete without one. So the rule is that
 * at least one of the three must be present.
 *
 * It lives HERE and not in `submit_enquiry` because the database cannot know: the demo
 * link is written after the row, and the attachments do not exist until tickets are
 * issued. That is a genuine loosening of the door's "correct on its own" property, and it
 * is why the SQL now accepts an empty message — the only caller is service_role, and this
 * function is the thing standing in front of it.
 */
export function hasContent(input: {
  message: string
  demoUrl: string | null
  attachmentCount: number
}): boolean {
  return input.message.trim() !== '' || !!input.demoUrl || input.attachmentCount > 0
}

export function validateAttachments(raw: unknown): AttachmentsResult {
  // `!Array.isArray` alone: it is already false for undefined and null, so the two
  // equality checks that used to sit in front of it could never change the outcome —
  // five mutants survived on that line because nothing could tell they were there.
  if (!Array.isArray(raw)) return { value: [], skipped: [] }

  const value: AttachmentRequest[] = []
  const skipped: SkippedItem[] = []

  for (const item of raw) {
    // The `typeof` half survives mutation and cannot be killed: this list comes from
    // JSON.parse, so a non-object item is a string, number or boolean, and every one of
    // those yields an empty filename and is skipped by the next check anyway. It stays
    // because the function must be correct for any caller, not only for JSON.
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const filename = str(r.filename).trim()
    const mime = str(r.mime_type).trim().toLowerCase()
    if (!filename) continue

    if (!(AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
      skipped.push({ item: filename, reason: 'unsupported_audio_type' })
      continue
    }
    if (value.length >= ATTACHMENTS_MAX) {
      skipped.push({ item: filename, reason: 'too_many_attachments' })
      continue
    }
    // `Number.isFinite` alone — it returns false for every non-number, so the
    // `typeof === 'number'` test that used to precede it could never change the outcome.
    const bytes = Number.isFinite(r.bytes) ? Math.max(0, Math.floor(r.bytes as number)) : 0
    value.push({ filename, mime_type: mime, bytes })
  }
  return { value, skipped }
}

/**
 * Make a visitor-supplied filename safe to put in a storage path.
 *
 * The name becomes the tail of `<artist_id>/<enquiry_id>/<uuid>-<name>`. A slash or a
 * `..` would let the sender choose where their file lands, escaping the per-enquiry folder
 * the ticket is scoped to — and that scope is the entire security model for these uploads,
 * so this is load-bearing rather than cosmetic.
 *
 * An explicit ALLOWLIST rather than blocking known-bad characters: it is the only form of
 * this that cannot be worked around with an encoding trick. Never returns empty, because
 * an empty segment produces an unusable object key.
 */
export function sanitiseFilename(name: string): string {
  const cleaned = (name ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+/, '')
    .slice(0, 120)
  return cleaned || 'audio'
}

/* ── Attachment retention ───────────────────────────────────────────────────────── */

/** Files only. The ENQUIRY is kept forever: the message is small and it is the manager's
 *  record of who got in touch. Only the audio expires. */
export const RETENTION_DAYS = 90

/** Roughly one request in a hundred does the sweep. There is no pg_cron here, so the
 *  cleanup rides on traffic — the same opportunistic approach the contact_attempts prune
 *  uses (20260722130000). A contact form gets enough requests for this to keep up, and
 *  paying a little on 1% of them is cheaper than a scheduled worker for a table this size. */
export const SWEEP_PROBABILITY = 0.01

/** Anything created before this is expired. */
export function retentionCutoffIso(nowMs: number, days: number = RETENTION_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Whether THIS request should pay for the sweep. Takes the roll so it can be tested. */
export function shouldSweep(roll: number, probability: number = SWEEP_PROBABILITY): boolean {
  return roll < probability
}

/* ── Post-validation composition + the door's HTTP map ──────────────────────────── */

export type ExtrasResult =
  | { kind: 'reject'; error: 'missing_field' }
  | { kind: 'ok'; demoUrl: string | null; attachments: AttachmentRequest[]; skipped: SkippedItem[] }

/**
 * Merge the two optional Block B fields into the enquiry, AFTER validateBody has passed.
 *
 * This step used to live inline in index.ts, where nothing typechecks or tests it —
 * and it owns a real decision: a bad link or file never fails the enquiry (dropped and
 * named in `skipped`), but an enquiry left carrying NOTHING once the drops are done is
 * still missing_field. That ordering matters — an invalid link whose enquiry had no
 * message must reject, not store a blank row the manager can do nothing with.
 */
export function composeExtras(
  message: string,
  demoUrlRaw: unknown,
  attachmentsRaw: unknown,
): ExtrasResult {
  const demo = validateDemoUrl(demoUrlRaw)
  const atts = validateAttachments(attachmentsRaw)
  if (!hasContent({ message, demoUrl: demo.value, attachmentCount: atts.value.length })) {
    return { kind: 'reject', error: 'missing_field' }
  }
  return {
    kind: 'ok',
    demoUrl: demo.value,
    attachments: atts.value,
    skipped: [...demo.skipped, ...atts.skipped],
  }
}

export type DoorDecision =
  | { kind: 'proceed'; unroutable: boolean }
  | { kind: 'reject'; httpStatus: 400 | 429 | 500; error: string; retryAfterSeconds?: number }

/**
 * Map what submit_enquiry said to what the visitor hears.
 *
 * Two rules this map exists to protect:
 * - `no_recipient` WITH a stored row is a SUCCESS for the visitor. While mail is
 *   unconfigured every submission takes this path; the message is safely in the
 *   manager's table, and reporting failure would make the sender resend or give up.
 * - A status this map has never been taught — or no row at all — is a 500, never a
 *   silent success. If the door grows a new status, the visitor-facing behaviour has
 *   to be decided here, on purpose, with a test.
 */
export function decideDoor(
  row: { status: string; enquiry_id: string | null } | null | undefined,
): DoorDecision {
  if (!row) return { kind: 'reject', httpStatus: 500, error: 'send_failed' }
  switch (row.status) {
    case 'ok':
      return { kind: 'proceed', unroutable: false }
    case 'no_recipient':
      return row.enquiry_id
        ? { kind: 'proceed', unroutable: true }
        : { kind: 'reject', httpStatus: 500, error: 'send_failed' }
    case 'rate_limited':
      return { kind: 'reject', httpStatus: 429, error: 'rate_limited', retryAfterSeconds: 3600 }
    // unknown_artist is also a 400: the slug is client-supplied and wrong.
    case 'invalid':
    case 'unknown_artist':
      return { kind: 'reject', httpStatus: 400, error: 'missing_field' }
    default:
      return { kind: 'reject', httpStatus: 500, error: 'send_failed' }
  }
}

/**
 * Everyone this enquiry is addressed to, ready for Resend's `to`.
 *
 * `to_emails` is what `resolve_enquiry_recipients` produced (primary first, then the
 * manager's configured list). `to_email` is the primary alone, and it is the fallback for
 * exactly one situation that WILL happen: the Edge Function deploys independently of the
 * database, so between `supabase db push` and `supabase functions deploy` — in either
 * order — one side is newer than the other. An older `submit_enquiry` returns no
 * `to_emails` at all, and dropping to zero recipients there would turn every enquiry
 * unroutable for the length of the deploy.
 *
 * Re-does the de-duplication that `enquiry_recipients`' unique index already does, on
 * purpose: this function has to be correct on its own, the same reason `submit_enquiry`
 * re-validates input the Edge Function has already checked. Two copies of one address in
 * `to` is a duplicate send to a human and, to some providers, a malformed request.
 *
 * Returns [] when there is nothing to send to. The caller must treat that as unroutable
 * rather than calling Resend with an empty `to`, which is a 4xx and would be recorded as
 * a send failure rather than the configuration problem it actually is.
 */
export function pickRecipients(
  row: { to_email?: string | null; to_emails?: string[] | null } | null | undefined,
): string[] {
  if (!row) return []
  const candidates = Array.isArray(row.to_emails) && row.to_emails.length > 0
    ? row.to_emails
    : [row.to_email]

  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const email = raw.trim()
    // The same shape the CHECK constraints and submit_enquiry use. A value that cannot be
    // an address would be rejected by Resend for the WHOLE send, taking the good
    // recipients down with it.
    if (!EMAIL_RE.test(email)) continue
    // Either case would do — the key is only ever compared with itself, so `toUpperCase`
    // is an equivalent mutant. Lower matches the SQL side (`lower(email)`), which is the
    // reason to prefer it.
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

/**
 * The email body. Moved here from index.ts (review, 2026-09-22): it is a pure function
 * deciding what a stranger reads, and index.ts is for plumbing nobody can test.
 *
 * Plain-text only, on purpose. A contact form has no formatting to preserve, and an
 * HTML body would mean escaping attacker-controlled text into markup that lands in
 * someone's mail client. Text has no such surface.
 */
export function composeText(b: {
  name: string
  email: string
  /** The kind's LABEL, not its slug — the subject already shows the label, and the body
   *  used to print the slug beside it. */
  purposeLabel: string
  message: string
  demoUrl: string | null
  attachmentCount: number
  dashboardUrl: string | null
}): string {
  const lines = [
    `From:    ${b.name} <${b.email}>`,
    `Purpose: ${stripHeader(b.purposeLabel) || 'Contact'}`,
  ]
  if (b.demoUrl) lines.push(`Demo:    ${b.demoUrl}`)
  lines.push('', b.message, '')

  // The audio is NEVER attached. A large attachment gets rejected by the receiving side
  // and damages the sending domain's reputation for every other enquiry, so the email
  // links to the file instead — and says when it goes, because nobody checks an inbox
  // knowing there is a 90-day clock on it.
  if (b.attachmentCount > 0) {
    const n = b.attachmentCount
    lines.push(
      `${n} audio file${n === 1 ? '' : 's'} attached to this enquiry.`,
      b.dashboardUrl
        ? `Listen or download: ${b.dashboardUrl}`
        : 'Open the enquiry in Lone Star to listen or download.',
      'Files are deleted after 90 days — save anything worth keeping. The message itself is kept.',
      '',
    )
  }

  lines.push('— Sent from your Lone Star site contact form. Reply to this email to answer directly.')
  return lines.join('\n')
}
