/**
 * POST /functions/v1/contact — the public contact/booking enquiry door.
 *
 * This function IS the public door for enquiries. Unlike every other public entry in
 * this system (get_public_site, record_event, subscribe, …) the door is not an
 * anon-granted SECURITY DEFINER function, because it needs two things Postgres cannot
 * give it: the caller's IP, for per-IP rate limiting, and an outbound HTTP call to
 * Resend. See the header of 20260722120000_contact_enquiries.sql and ADR 0010.
 *
 * It is deliberately THIN. Everything that decides an outcome lives either in
 * ./validate.ts (pure, unit-tested by vitest in tests/contact-validate.test.ts) or in
 * the submit_enquiry RPC (unit-tested against the real DB in tests/enquiry-door.test.ts).
 * What is left here is plumbing, and plumbing is what cannot be covered by `npm test`.
 * Keep it that way: logic added here is logic nobody can test.
 *
 * Contract (pinned with the skeen site):
 *   body  { slug, purpose, name, email, message, website }
 *   200   { ok: true }
 *   400   { ok: false, error: "invalid_email" | "missing_field" | "message_too_long" }
 *   429   { ok: false, error: "rate_limited" }
 *   5xx   { ok: false, error: "send_failed" }
 */
import { json } from '../_shared/cors.ts'
import {
  buildSubject,
  firstForwardedIp,
  formatFrom,
  hashIp,
  parseAllowedOrigins,
  pickOrigin,
  validateBody,
} from './validate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Auto-injected by the platform. NOT a secret we manage, and never sent to the client.
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IP_SALT = Deno.env.get('CONTACT_IP_SALT') ?? ''
const ALLOWED = parseAllowedOrigins(Deno.env.get('CONTACT_ALLOWED_ORIGINS'))
/** Skips the Resend call and marks the enquiry sent. Used for deploy smoke tests. */
const DRY_RUN = Deno.env.get('CONTACT_DRY_RUN') === 'true'

/**
 * Call a Postgres function as service_role over PostgREST.
 *
 * Plain fetch rather than supabase-js: this is one HTTP POST, and the client would add
 * a dependency, a realtime/auth surface we never use, and a version to keep in step —
 * for nothing. Same reasoning as not pulling in the Resend SDK below.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

type DoorRow = {
  status: 'ok' | 'rate_limited' | 'invalid' | 'unknown_artist' | 'no_recipient'
  enquiry_id: string | null
  to_email: string | null
  from_name: string | null
  from_email: string | null
  artist_name: string | null
  recipient_source: string | null
}

/**
 * Plain-text only, on purpose. A contact form has no formatting to preserve, and an
 * HTML body would mean escaping attacker-controlled text into markup that lands in
 * someone's mail client. Text has no such surface.
 */
function composeText(b: { name: string; email: string; purpose: string; message: string }): string {
  return [
    `From:    ${b.name} <${b.email}>`,
    `Purpose: ${b.purpose}`,
    '',
    b.message,
    '',
    '— Sent from your Lone Star site contact form. Reply to this email to answer directly.',
  ].join('\n')
}

Deno.serve(async (req: Request) => {
  const origin = pickOrigin(req.headers.get('origin'), ALLOWED)

  // Preflight first, before anything that could throw.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: json(204, {}, origin).headers })
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, origin)
  }

  try {
    let raw: unknown = null
    try {
      raw = await req.json()
    } catch {
      raw = null // falls through to missing_field below
    }

    const result = validateBody(raw)
    const ip = firstForwardedIp(req.headers)
    const ipHash = await hashIp(IP_SALT, ip)

    // A bot gets 200 and silence. Telling it that the honeypot caught it only teaches
    // whoever wrote it to leave the field alone next time.
    if (result.kind === 'honeypot') {
      await rpc('log_contact_attempt', {
        p_slug: result.slug,
        p_purpose: result.purpose,
        p_ip_hash: ipHash,
        p_outcome: 'honeypot',
      })
      return json(200, { ok: true }, origin)
    }

    // Log rejections too, so probing the endpoint with garbage still burns a
    // rate-limit slot instead of being free reconnaissance.
    if (result.kind === 'error') {
      await rpc('log_contact_attempt', {
        p_slug: result.slug,
        p_purpose: result.purpose,
        p_ip_hash: ipHash,
        p_outcome: 'invalid',
      })
      return json(400, { ok: false, error: result.error }, origin)
    }

    const body = result.value
    const [row] = await rpc<DoorRow[]>('submit_enquiry', {
      p_slug: body.slug,
      p_purpose: body.purpose,
      p_name: body.name,
      p_email: body.email,
      p_message: body.message,
      p_ip_hash: ipHash,
    })

    if (!row || row.status !== 'ok') {
      if (row?.status === 'rate_limited') {
        return json(429, { ok: false, error: 'rate_limited' }, origin, { 'Retry-After': '3600' })
      }
      if (row?.status === 'invalid') {
        return json(400, { ok: false, error: 'missing_field' }, origin)
      }
      // unknown_artist is a 400: the slug is client-supplied and wrong. no_recipient is
      // OUR misconfiguration (no booking address, or an unseeded mail_settings), so it
      // is a 5xx — the visitor did nothing wrong and should be told to try again.
      if (row?.status === 'unknown_artist') {
        return json(400, { ok: false, error: 'missing_field' }, origin)
      }
      console.error('contact: unroutable', { slug: body.slug, status: row?.status })
      return json(500, { ok: false, error: 'send_failed' }, origin)
    }

    // ---- Send. The enquiry row already exists, so a failure here loses nothing. ----
    let providerId: string | null = null
    let sendError: string | null = null

    if (DRY_RUN) {
      providerId = 'dry-run'
    } else {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: formatFrom(row.from_name ?? '', row.from_email!),
            to: [row.to_email],
            // THE LOAD-BEARING HEADER. The manager hits reply and it goes to the
            // visitor. Putting the visitor in `from` instead would fail DMARC (we do
            // not control their domain) and land the whole thing in spam.
            reply_to: body.email,
            subject: buildSubject(body.purpose, row.artist_name ?? '', body.name),
            text: composeText({ ...body, purpose: body.purpose }),
          }),
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) {
          providerId = ((await res.json()) as { id?: string }).id ?? null
        } else {
          sendError = `resend ${res.status}: ${(await res.text()).slice(0, 500)}`
        }
      } catch (e) {
        sendError = `resend request failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    await rpc('mark_enquiry_sent', {
      p_id: row.enquiry_id,
      p_ok: sendError === null,
      p_provider_id: providerId,
      p_error: sendError,
    })

    if (sendError) {
      console.error('contact: send failed', { slug: body.slug, error: sendError })
      await rpc('log_contact_attempt', {
        p_slug: body.slug,
        p_purpose: body.purpose,
        p_ip_hash: ipHash,
        p_outcome: 'send_failed',
      })
      return json(500, { ok: false, error: 'send_failed' }, origin)
    }

    // {ok:true} AND NOTHING ELSE. Never echo to_email, from, enquiry_id, or
    // recipient_source — the whole point of resolving the recipient server-side is that
    // it never reaches the client. A "helpful" debug field here reopens the hole.
    return json(200, { ok: true }, origin)
  } catch (e) {
    // Catch-all so a throw still returns WITH CORS HEADERS. Without this the browser
    // reports an opaque CORS failure and hides the real 500 completely.
    console.error('contact: unhandled', e)
    return json(500, { ok: false, error: 'send_failed' }, origin)
  }
})
