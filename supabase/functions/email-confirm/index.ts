/**
 * POST /functions/v1/email-confirm: send a manager's newly listed address its confirmation code.
 *
 * Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to make sure
 * the email is legit" … "this should be required before deploying". An address Tapir sends
 * enquiries to is used only once confirmed (resolve_enquiry_recipients filters on it); this
 * function is how the code reaches the address. Plan of record: EMAIL_CONFIRM_PLAN.md, piece 2.
 *
 * Called SERVER-TO-SERVER by the dashboard's sendEmailCodeAction with the manager's own access
 * token, never from a browser, so there is no CORS and no preflight (unlike contact and event),
 * and verify_jwt is ON at the gateway (supabase/config.toml).
 *
 * Deliberately THIN, like contact. Everything that decides an outcome is either in ./build.ts
 * (pure, tests/unit/enquiries/email-confirm-build.test.ts) or in begin_email_confirmation (who
 * may ask, is the address listed, the resend caps, the code and its hash; tested against the
 * real DB in tests/integration/enquiries/email-confirmations.test.ts). What is left is plumbing.
 *
 * Contract (pinned with the dashboard action):
 *   request  POST, `Authorization: Bearer <manager access token>`, body { artistId, email }
 *   reply    ALWAYS `{ status }` and nothing else. NEVER the code, the token, or an address.
 *     200  the SQL's word, straight through: 'sent' | 'confirmed' | 'too_soon' | 'too_many'
 *          | 'not_listed' | 'not_allowed' (whatever begin_email_confirmation returns)
 *     200  'send_failed': nothing went out (Resend refused, or mail is not configured). The
 *          SQL's hashes stay; a new send is allowed after its 60 s.
 *     400  'invalid'       body is not { artistId: uuid, email }
 *     401  'unauthorized'  no token, or a token that is not a signed-in user
 *     405  'method_not_allowed'
 *     500  'error'         anything unexpected; the detail is in the function log only
 */
import { formatFrom } from '../contact/validate.ts'
import {
  buildConfirmHtml,
  buildConfirmSubject,
  buildConfirmText,
  firstRow,
  parseConfirmRequest,
  replyStatus,
} from './build.ts'

// Injected by the platform. NOT secrets we manage, and never sent to a caller.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// No default, on purpose: a missing key is a 'send_failed' and a log line, never a guess.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
/** Where the dashboard runs, for the email's Confirm link (/confirm-email/<token>). Optional:
 *  without it the email carries the code only. Not derived from a request header, because a
 *  wrong link in an email cannot be corrected after it is sent. SEPARATE from contact's
 *  LONE_STAR_APP_URL on purpose: that one is set today, and the dashboard it names does not
 *  serve /confirm-email until it is deployed with it. Set this only then, so no email ever
 *  carries a link to a page that 404s. */
const APP_URL = Deno.env.get('EMAIL_CONFIRM_APP_URL') ?? null
/** Skips the Resend call. For the first deploy's smoke test, like contact's CONTACT_DRY_RUN.
 *  The SQL still runs, so a dry run DOES use a send slot and replace any earlier code. */
const DRY_RUN = Deno.env.get('EMAIL_CONFIRM_DRY_RUN') === 'true'

/** The confirmation comes from Tapir, not the artist: the address belongs to someone the
 *  artist's team named, and they have never heard from the artist's site before. */
const FROM_NAME = 'Tapir'

function reply(http: number, status: string): Response {
  return new Response(JSON.stringify({ status }), {
    status: http,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * PostgREST `code` only, for a log line. Not the message, unlike contact's errorSummary: a
 * RAISE in begin_email_confirmation may name the address, and this function's rule is that
 * no address leaves it, logs included.
 */
async function errorCode(res: Response): Promise<string> {
  try {
    return String(((await res.json()) as { code?: string }).code ?? '').slice(0, 40)
  } catch {
    return ''
  }
}

/** Service-role PostgREST call. Plain fetch, not supabase-js, for contact's reason: it is one
 *  HTTP POST, and the client would add a dependency and a version to keep in step. */
async function serviceFetch(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const err = new Error(`${init.method} ${path.split('?')[0]} failed: ${res.status} ${await errorCode(res)}`)
    err.name = 'ServiceFetchError'
    throw err
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * The user behind the bearer token, or null. This is `auth.getUser(jwt)` with the service
 * client, as one fetch: GoTrue checks the token itself (signature, expiry, not signed out), so
 * a forged or stale token, or the anon key, comes back as no user. The gateway's verify_jwt is
 * a first gate; this is the one that names the user the SQL checks.
 */
async function userFromToken(jwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const id = ((await res.json()) as { id?: unknown }).id
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/**
 * The house sender: `from_local_part@sending_domain` from the mail_settings row, the same
 * verified domain contact sends from. Null when the row is missing. Per-artist sending
 * domains (artist_mail_settings) are NOT used: this email is Tapir's, not the artist's.
 */
async function houseSender(): Promise<string | null> {
  const rows = (await serviceFetch(
    'mail_settings?id=eq.true&select=sending_domain,from_local_part&limit=1',
    { method: 'GET' },
  )) as { sending_domain?: string | null; from_local_part?: string | null }[] | null
  const row = rows?.[0]
  if (!row?.sending_domain || !row.from_local_part) return null
  return `${row.from_local_part}@${row.sending_domain}`
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, 'method_not_allowed')

  const jwt = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!jwt) return reply(401, 'unauthorized')

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('email-confirm: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
      return reply(500, 'error')
    }

    // 1. Who is asking. Before the body is even read, so a caller with no session learns
    //    nothing about what a valid body looks like.
    const userId = await userFromToken(jwt)
    if (!userId) return reply(401, 'unauthorized')

    let raw: unknown = null
    try {
      raw = await req.json()
    } catch {
      raw = null
    }
    const body = parseConfirmRequest(raw)
    if (!body) return reply(400, 'invalid')

    // Mail config is checked BEFORE the SQL call, a small change of order from the plan, for
    // one reason: begin_email_confirmation REPLACES the code and the link of any earlier email
    // and spends one of the address's five sends an hour. A send that cannot happen (no house
    // sender, no Resend key) must not kill a code the person may be holding right now.
    const from = await houseSender()
    if (!from || (!DRY_RUN && !RESEND_API_KEY)) {
      console.error('email-confirm: mail not configured', {
        artist: body.artistId,
        sender: Boolean(from),
        resendKey: Boolean(RESEND_API_KEY),
      })
      return reply(200, 'send_failed')
    }

    // 2. The SQL decides everything: may this user ask, is the address on a list, the caps.
    //    Only on 'sent' does it return the plaintext code and token, the only time they exist.
    const result = await serviceFetch('rpc/begin_email_confirmation', {
      method: 'POST',
      body: { p_user_id: userId, p_artist_id: body.artistId, p_email: body.email },
    })
    const status = replyStatus(result)
    if (!status) {
      console.error('email-confirm: begin_email_confirmation returned no status', { artist: body.artistId })
      return reply(500, 'error')
    }
    if (status !== 'sent') return reply(200, status)

    const row = firstRow(result)!
    if (typeof row.code !== 'string' || !row.code || typeof row.token !== 'string' || !row.token) {
      // A SQL bug, not a caller's: 'sent' must carry both. Nothing went out, so say so.
      console.error('email-confirm: sent without a code or token', { artist: body.artistId })
      return reply(200, 'send_failed')
    }

    // 3. The email.
    const email = {
      artistName: row.artist_name ?? '',
      kinds: Array.isArray(row.kinds) ? row.kinds : [],
      siteHost: row.site_host ?? null,
      code: row.code,
      token: row.token,
      appUrl: APP_URL,
    }

    if (DRY_RUN) {
      console.log('email-confirm: dry run, nothing sent', { artist: body.artistId })
      return reply(200, 'sent')
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: formatFrom(FROM_NAME, from),
          to: [body.email],
          subject: buildConfirmSubject(email.artistName),
          text: buildConfirmText(email),
          html: buildConfirmHtml(email),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        // Status and Resend's error NAME only, as contact does. The message can echo an
        // address (with the shared test sender, every non-owner recipient is a 403 naming the
        // account owner's inbox).
        let name = ''
        try {
          name = ((await res.json()) as { name?: string }).name ?? ''
        } catch {
          name = ''
        }
        console.error('email-confirm: send failed', { artist: body.artistId, error: `resend ${res.status} ${name}`.trim() })
        return reply(200, 'send_failed')
      }
    } catch (e) {
      console.error('email-confirm: send failed', {
        artist: body.artistId,
        error: `resend request failed: ${e instanceof Error ? e.name : 'unknown'}`,
      })
      return reply(200, 'send_failed')
    }

    return reply(200, 'sent')
  } catch (e) {
    // Our own messages in full (serviceFetch's carry a path, a status and a PostgREST code,
    // never a body); anything else by NAME only, because a JSON.parse error quotes the text it
    // choked on, and that text could hold an address.
    const ours = e instanceof Error && e.name === 'ServiceFetchError'
    console.error('email-confirm: unhandled', ours ? e.message : e instanceof Error ? e.name : 'unknown')
    return reply(500, 'error')
  }
})
