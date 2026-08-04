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
 *   body  { slug, purpose, name, email, message, website, demo_url?, attachments? }
 *   200   { ok: true, uploads: Ticket[], skipped: { item, reason }[] }
 *   400   { ok: false, error: "invalid_email" | "missing_field" | "message_too_long" }
 *
 *   A bad demo_url or a non-audio attachment NEVER 400s. It is dropped and named in
 *   `skipped`, because losing a real person's message to save them from their own file
 *   picker is the worse outcome — and this endpoint already stores the enquiry before
 *   sending for exactly that reason.
 *
 *   The honeypot returns the same shape as a genuine submission with no files. Any
 *   difference is a signal that teaches whoever wrote the bot which field caught them.
 *   429   { ok: false, error: "rate_limited" }
 *   5xx   { ok: false, error: "send_failed" }
 */
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  buildSubject,
  firstForwardedIp,
  formatFrom,
  hashIp,
  parseAllowedOrigins,
  pickOrigin,
  retentionCutoffIso,
  sanitiseFilename,
  shouldSweep,
  validateAttachments,
  hasContent,
  validateBody,
  validateDemoUrl,
} from './validate.ts'

const ATTACHMENT_BUCKET = 'enquiry-attachments'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
// Auto-injected by the platform. NOT a secret we manage, and never sent to the client.
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IP_SALT = Deno.env.get('CONTACT_IP_SALT') ?? ''
const ALLOWED = parseAllowedOrigins(Deno.env.get('CONTACT_ALLOWED_ORIGINS'))
/** Skips the Resend call and marks the enquiry sent. Used for deploy smoke tests. */
const DRY_RUN = Deno.env.get('CONTACT_DRY_RUN') === 'true'
/** Where the manager reads their enquiries. Optional: without it the email says "open
 *  Lone Star" instead of linking, which is worse but never broken. A wrong link in an
 *  email cannot be corrected after sending, so this is not guessed from a header. */
const APP_URL = (Deno.env.get('LONE_STAR_APP_URL') ?? '').replace(/\/+$/, '')

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
  // A void-returning function answers 204 with NO BODY, and res.json() throws on empty
  // input. `log_contact_attempt` is exactly that, so every path that logs an attempt —
  // honeypot, invalid input, send failure, attachment tickets — threw into the catch-all
  // and returned 500. The success path was unaffected because it never calls it, which is
  // why this survived until the function was deployed and a bot-shaped request hit it.
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** PostgREST table access as service_role. Same reasoning as `rpc`: one HTTP call, no
 *  client library. `prefer` carries return=representation where a result is needed. */
async function rest<T>(
  path: string,
  init: { method: string; body?: unknown; prefer?: string } = { method: 'GET' },
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`rest ${init.method} ${path} failed: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/**
 * Mint a one-shot signed UPLOAD url for exactly one object path.
 *
 * This is what lets an anonymous visitor write to a private bucket without the bucket
 * ever granting anon a write policy: the capability is scoped to a single path we chose,
 * inside a folder named after the enquiry we just created. The token is Supabase's, and
 * its lifetime (two hours) is not configurable — what actually bounds the risk is the
 * scope, not the clock.
 */
async function signUpload(path: string): Promise<{ signedUrl: string; token: string } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${ATTACHMENT_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    // `url` comes back as a relative path carrying ?token=...
    const { url } = (await res.json()) as { url: string }
    const token = new URL(url, SUPABASE_URL).searchParams.get('token') ?? ''
    return { signedUrl: `${SUPABASE_URL}/storage/v1${url.startsWith('/') ? url : `/${url}`}`, token }
  } catch {
    return null
  }
}

/**
 * Delete expired attachment OBJECTS and their rows. Files only — the enquiry is kept.
 *
 * Runs here rather than in SQL for a reason that is easy to get wrong: deleting a row
 * from `storage.objects` does NOT delete the underlying file. A SQL-side prune would
 * leave paid-for orphans in the bucket with nothing left pointing at them. The Storage
 * API has to be the one doing it.
 *
 * Opportunistic, ~1 request in 100, like the contact_attempts prune — there is no pg_cron
 * here. Entirely best-effort: a failed sweep must never affect the enquiry being handled.
 */
async function sweepExpiredAttachments(): Promise<void> {
  try {
    const cutoff = retentionCutoffIso(Date.now())
    const rows = await rest<{ id: string; storage_path: string }[]>(
      `enquiry_attachments?created_at=lt.${encodeURIComponent(cutoff)}&storage_path=not.is.null&select=id,storage_path&limit=100`,
    )
    if (!rows?.length) return

    // Objects FIRST. If this half fails we keep the rows and try again next sweep; the
    // other order would forget the paths and strand the files permanently.
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${ATTACHMENT_BUCKET}`, {
      method: 'DELETE',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: rows.map((r) => r.storage_path) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!del.ok) return

    // TOMBSTONE, don't delete. Deleting the row destroyed the only evidence a file ever
    // existed, so the dashboard could not say "attachment expired" — it just showed
    // nothing, indistinguishable from an enquiry that never had audio. Keeping the row
    // (filename, type, expired_at) costs a few bytes and keeps the manager informed.
    const ids = rows.map((r) => r.id).join(',')
    await rest(`enquiry_attachments?id=in.(${ids})`, {
      method: 'PATCH',
      body: { storage_path: null, expired_at: new Date().toISOString() },
    })
  } catch (e) {
    console.error('contact: attachment sweep failed', e)
  }
}

/**
 * Store the demo link, then mint one upload ticket per requested file.
 *
 * ORDER IS THE SECURITY MODEL. This runs only after the enquiry has passed validation,
 * rate limiting and recipient resolution — so a bot that gets 400ed or 429ed never
 * receives a write capability at all. Uploading is a privilege earned by submitting a
 * real enquiry, not a thing the endpoint offers up front.
 *
 * The demo url and the artist id come back from ONE update rather than a second read,
 * and `submit_enquiry` is deliberately left alone: it is a carefully documented function
 * with a hard "never raise" invariant, and changing its signature would mean dropping and
 * recreating it to widen a return type. Not worth it to avoid one round trip.
 *
 * Every failure here degrades rather than throws. The enquiry is already stored and the
 * email already sent; losing an attachment ticket must not turn a delivered message into
 * a 500 for the visitor.
 */
async function issueUploadTickets(
  enquiryId: string | null,
  artistId: string | null,
  attachments: { filename: string; mime_type: string; bytes: number }[],
  attempt: { slug: string; purpose: string; ipHash: string },
): Promise<{
  tickets: { filename: string; bucket: string; path: string; token: string; signed_url: string }[]
  skipped: { item: string; reason: string }[]
}> {
  if (!enquiryId || !artistId || attachments.length === 0) return { tickets: [], skipped: [] }
  try {

    const tickets = []
    const failed: { item: string; reason: string }[] = []
    for (const att of attachments) {
      const path = `${artistId}/${enquiryId}/${crypto.randomUUID()}-${sanitiseFilename(att.filename)}`
      const signed = await signUpload(path)
      if (!signed) {
        // Reported, not dropped in silence. `uploads` can be SHORTER than `attachments`,
        // so a client matching by index would pair the wrong ticket to the wrong file —
        // and a client matching by filename would simply never hear about this one.
        failed.push({ item: att.filename, reason: 'upload_unavailable' })
        continue
      }

      // The row is written NOW, before the file exists. The alternative — a second
      // endpoint the browser calls after uploading — is more surface for a stranger to
      // reach, and this table has exactly one writer on purpose. An abandoned upload
      // leaves a row with no object, which the dashboard shows the same way it shows an
      // expired one.
      await rest('enquiry_attachments', {
        method: 'POST',
        body: {
          enquiry_id: enquiryId,
          artist_id: artistId,
          storage_path: path,
          filename: att.filename.slice(0, 200),
          mime_type: att.mime_type,
          bytes: att.bytes,
        },
      })

      // Each ticket costs its own rate-limit slot, so attachments cannot be used to
      // sidestep the per-IP limits.
      await rpc('log_contact_attempt', {
        p_slug: attempt.slug,
        p_purpose: attempt.purpose,
        p_ip_hash: attempt.ipHash,
        p_outcome: 'attachment',
      })

      tickets.push({
        filename: att.filename,
        bucket: ATTACHMENT_BUCKET,
        path,
        token: signed.token,
        signed_url: signed.signedUrl,
      })
    }
    return { tickets, skipped: failed }
  } catch (e) {
    console.error('contact: upload tickets failed', e)
    return { tickets: [], skipped: attachments.map((a) => ({ item: a.filename, reason: 'upload_unavailable' })) }
  }
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
function composeText(b: {
  name: string
  email: string
  purpose: string
  message: string
  demoUrl: string | null
  attachmentCount: number
  dashboardUrl: string | null
}): string {
  const lines = [
    `From:    ${b.name} <${b.email}>`,
    `Purpose: ${b.purpose}`,
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

Deno.serve(async (req: Request) => {
  const origin = pickOrigin(req.headers.get('origin'), ALLOWED)

  // Preflight first, before anything that could throw.
  //
  // `corsHeaders` directly, NOT `json(204, ...)`. That threw: 204 is a null-body status,
  // so the Response constructor rejects a body, and the old line called json() purely to
  // borrow its headers — the throw happened while building the object it was reaching
  // into. Every preflight 500d, which a browser reports as an opaque CORS failure with
  // nothing in it to suggest the cause. Found by curling the deployed function.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  // The speed bump that used to be `verify_jwt = true`, moved here so it cannot break
  // preflight. OPTIONS is answered ABOVE this, unauthenticated, because a CORS preflight
  // carries no Authorization header by specification — checking it at the gateway 401s
  // the preflight and the browser reports an opaque CORS error instead.
  //
  // Not an authorization control: the anon key is public and anyone reading the site
  // bundle has it. It turns away the entirely-scripted abuse that never bothered to look.
  // The real controls are the per-IP rate limit and server-side recipient resolution.
  if (req.method === 'POST' && !req.headers.get('authorization')) {
    return json(401, { ok: false, error: 'unauthorized' }, origin)
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
    let demoUrl: string | null = null
    let attachments: { filename: string; mime_type: string; bytes: number }[] = []
    let skipped: { item: string; reason: string }[] = []
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
      // Identical to a genuine submission with no files, deliberately: any difference
      // here is a signal that tells whoever wrote the bot which field caught them.
      return json(200, { ok: true, uploads: [], skipped: [] }, origin)
    }

    // The two Block B fields. NEITHER CAN FAIL THE ENQUIRY: a bad link or a stray
    // non-audio file is dropped and named, never a rejection. This endpoint stores the
    // enquiry before it even tries to send, precisely so a message is never lost to a
    // downstream problem — rejecting the whole submission over one optional field was the
    // same principle applied inconsistently (caught by the skeen side, 2026-08-04).
    if (result.kind === 'ok') {
      const demo = validateDemoUrl((raw as Record<string, unknown>).demo_url)
      const atts = validateAttachments((raw as Record<string, unknown>).attachments)
      demoUrl = demo.value
      attachments = atts.value
      skipped = [...demo.skipped, ...atts.skipped]

      // An enquiry has to carry something. Checked HERE rather than in validateBody
      // because a demo's content may be entirely the link and the audio, neither of which
      // exists until this point.
      if (!hasContent({ message: result.value.message, demoUrl, attachmentCount: attachments.length })) {
        await rpc('log_contact_attempt', {
          p_slug: result.value.slug,
          p_purpose: result.value.purpose,
          p_ip_hash: ipHash,
          p_outcome: 'invalid',
        })
        return json(400, { ok: false, error: 'missing_field' }, origin)
      }
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

    // Persist the demo link and learn the tenant for ANY stored enquiry — the ok path and
    // the unroutable one alike. It used to run only on success, so while mail is
    // unconfigured (every submission unroutable) the demo LINK was silently dropped, which
    // on a demo is most of the payload. One PATCH does both; submit_enquiry is left alone
    // rather than widening its return type, which would mean dropping and recreating a
    // function with a hard never-raise invariant.
    let artistId: string | null = null
    if (row?.enquiry_id) {
      try {
        const updated = await rest<{ artist_id: string }[]>(
          `enquiries?id=eq.${row.enquiry_id}&select=artist_id`,
          { method: 'PATCH', body: { demo_url: demoUrl }, prefer: 'return=representation' },
        )
        artistId = updated?.[0]?.artist_id ?? null
      } catch (e) {
        // The message is already stored. Losing the optional link is not worth failing a
        // delivery over.
        console.error('contact: demo_url update failed', e)
      }
    }

    if (!row || row.status !== 'ok') {
      if (row?.status === 'rate_limited') {
        return json(429, { ok: false, error: 'rate_limited' }, origin, { 'Retry-After': '3600' })
      }
      if (row?.status === 'invalid') {
        return json(400, { ok: false, error: 'missing_field' }, origin)
      }
      // unknown_artist is a 400: the slug is client-supplied and wrong.
      if (row?.status === 'unknown_artist') {
        return json(400, { ok: false, error: 'missing_field' }, origin)
      }

      // UNROUTABLE is not a failure the VISITOR should see. Since 20260804230000 the door
      // STORES the enquiry even with no recipient or no verified sender, so the message is
      // safe in the manager's table — which, until mail is configured, is the only place
      // it was ever going to land. Telling the sender it failed would make them send again
      // or give up over a gap on our side that they cannot do anything about.
      if (row?.status === 'no_recipient' && row.enquiry_id) {
        console.error('contact: stored but unroutable — mail not configured', {
          slug: body.slug,
          enquiry: row.enquiry_id,
        })
        const issued = await issueUploadTickets(row.enquiry_id, artistId, attachments, {
          slug: body.slug,
          purpose: body.purpose,
          ipHash,
        })
        return json(
          200,
          { ok: true, uploads: issued.tickets, skipped: [...skipped, ...issued.skipped] },
          origin,
        )
      }

      // Anything left is genuinely unexpected — a status the door grew that this function
      // has not been taught, or no row at all.
      console.error('contact: unhandled door status', { slug: body.slug, status: row?.status })
      return json(500, { ok: false, error: 'send_failed' }, origin)
    }

    // ---- Send. The enquiry row already exists, so a failure here loses nothing. ----
    let providerId: string | null = null
    let sendError: string | null = null

    const dashboardUrl = APP_URL && artistId ? `${APP_URL}/artists/${artistId}/enquiries` : null

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
            text: composeText({
              ...body,
              purpose: body.purpose,
              demoUrl,
              attachmentCount: attachments.length,
              dashboardUrl,
            }),
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
      console.error('contact: send failed, enquiry kept', { slug: body.slug, enquiry: row.enquiry_id, error: sendError })
      await rpc('log_contact_attempt', {
        p_slug: body.slug,
        p_purpose: body.purpose,
        p_ip_hash: ipHash,
        p_outcome: 'send_failed',
      })
      // NOT a 500. The enquiry is stored and the manager has it — telling the visitor it
      // failed makes them send again (two rows in the inbox) or give up believing nothing
      // arrived. Storing before sending exists precisely so a mail outage cannot lose a
      // message; reporting the outage as the outcome throws that away. The failure is
      // already recorded where someone can act on it: status='failed' with send_error on
      // the row, plus the contact_attempts ledger. (skeen review, 2026-08-04.)
    }

    // Never echo the RECIPIENT — to_email, from, or recipient_source. Resolving the
    // recipient server-side is the entire point of this endpoint, and a "helpful" debug
    // field here reopens the hole.
    //
    // `enquiry_id` and `artist_id` DO now leave, inside upload ticket paths, and that is a
    // deliberate narrowing of the older "nothing else" rule rather than an oversight:
    // there is no way to hand a stranger a scoped write location without telling them the
    // scope. Both are safe to disclose — artist_id is already public through
    // get_public_site, and enquiry_id grants nothing under RLS, where `enquiries` is
    // manager-only and no endpoint is keyed on it. The recipient fields are what that
    // rule protects, and they are untouched.
    const issued = await issueUploadTickets(row.enquiry_id, artistId, attachments, {
      slug: body.slug,
      purpose: body.purpose,
      ipHash,
    })
    const uploads = issued.tickets
    skipped = [...skipped, ...issued.skipped]

    // Opportunistic retention sweep, AFTER the response work is done, so a slow delete
    // never delays the visitor's confirmation. Best-effort by design.
    if (shouldSweep(Math.random())) await sweepExpiredAttachments()

    return json(200, { ok: true, uploads, skipped }, origin)
  } catch (e) {
    // Catch-all so a throw still returns WITH CORS HEADERS. Without this the browser
    // reports an opaque CORS failure and hides the real 500 completely.
    console.error('contact: unhandled', e)
    return json(500, { ok: false, error: 'send_failed' }, origin)
  }
})
