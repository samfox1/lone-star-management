/**
 * CONNECT WITH EVENTBRITE — sign in to Eventbrite instead of pasting the organizer link, and
 * the artist's shows come into Tour (Sam, 2026-09-28: "by adding eventbrite, I will allow
 * users to be redirected to the artist's event information via eventbrite"). The YouTube
 * sign-in (`src/lib/youtube-oauth.ts`) is the pattern; Shopify's (`merch/shopify-oauth.ts`)
 * is where the token is kept.
 *
 * The flow, end to end:
 *   1. /api/eventbrite/start checks the manager owns the artist, signs a STATE cookie (this
 *      artist, this manager, a nonce, a PKCE verifier, the organizer id of a pasted link if
 *      there was one, ten minutes) and sends the browser to Eventbrite's authorize page.
 *   2. The manager signs in and presses Allow; Eventbrite sends the browser to
 *      /api/eventbrite/callback with a one-time `code` (or `error=access_denied`).
 *   3. The callback checks the state, the manager and their ownership, trades the code for
 *      the artist's token, finds the organizer page (`findOrganizer`), stores the token in
 *      VAULT (`connect_eventbrite`), saves the organizer link through the SAME door a pasted
 *      link uses (`connectOneAction`), and pulls the shows (`syncEventbriteAction`).
 *
 * WHY THE TOKEN IS KEPT (and only in Vault). Pulling shows LATER needs it: Eventbrite v3 has
 * no anonymous access and no app-only token ("every request … must be authenticated with a
 * valid OAuth token", tokens "are tied to user accounts"), and an organization's events are
 * read with a member's token. So "Pull now" needs the artist's own. It lives in Supabase
 * Vault, reached only through owner-gated SECURITY DEFINER functions (mirroring Shopify's),
 * never in a column, a cookie or a log. Eventbrite's tokens carry NO scopes (full account
 * access) and do not expire, and Eventbrite documents no revoke endpoint: Remove forgets the
 * token (deletes the Vault secret); ending the grant at Eventbrite itself is the artist's,
 * from their Eventbrite account.
 *
 * PKCE. Eventbrite does not document PKCE. We send it anyway (RFC 7636 §5: clients SHOULD;
 * an authorization server MUST ignore parameters it does not know, RFC 6749 §3.1/§3.2): it
 * protects the code if Eventbrite honours it and costs nothing if not. The guards that
 * certainly hold are the client secret on the exchange and the signed, nonce-bound state.
 *
 * Only the app's two credentials come from the environment (`EVENTBRITE_CLIENT_ID` — what
 * Eventbrite calls the API key — and `EVENTBRITE_CLIENT_SECRET`). Without them the button is
 * hidden and pasting the organizer link is the way.
 *
 * Every rule that decides whether a request is TRUSTED is a plain function here, pinned in
 * tests/unit/manager-tools/connections/eventbrite-oauth.test.ts. Nothing here logs, and no
 * message built here carries a token, a code or the secret.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { EVENTBRITE_ID, createEventbriteClient, type EventbriteClient, type EventbriteOrganizer } from '@/lib/eventbrite'
import { EVENTBRITE_START_PATH } from '@/lib/manager-tools/connections/services/eventbrite'

export const STATE_COOKIE = 'ls_eventbrite_oauth'
/** How long a trip to Eventbrite may take: signing in plus pressing Allow. */
export const STATE_TTL_MS = 10 * 60 * 1000
export const START_PATH = EVENTBRITE_START_PATH
export const CALLBACK_PATH = '/api/eventbrite/callback'

const AUTHORIZE_URL = 'https://www.eventbrite.com/oauth/authorize'
const TOKEN_URL = 'https://www.eventbrite.com/oauth/token'
const TIMEOUT_MS = 10_000

/** RFC 7636's verifier alphabet and length. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

export type EventbriteOAuthConfig = { clientId: string; clientSecret: string }

/** The app's credentials, or null when either is missing (blank counts as missing). */
export function eventbriteOAuthConfig(env: Record<string, string | undefined> = process.env): EventbriteOAuthConfig | null {
  const clientId = env.EVENTBRITE_CLIENT_ID?.trim()
  const clientSecret = env.EVENTBRITE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Whether "Connect with Eventbrite" shows. The ONLY thing about the app that reaches the
 *  browser: a boolean, never the key or the secret. */
export function eventbriteOAuthConfigured(): boolean {
  return eventbriteOAuthConfig() !== null
}

/** What the Connections and Tour pages pass as Eventbrite's `signedIn` state: true when a
 *  sign-in is stored; false when not but "Connect with Eventbrite" is on offer; undefined
 *  when neither — the app is not set up, so nothing could pull and nothing is offered. */
export function eventbriteSignedInState(stored: boolean): boolean | undefined {
  if (stored) return true
  return eventbriteOAuthConfigured() ? false : undefined
}

/** Only https, or plain http on localhost (dev): a state cookie is never set, or read,
 *  anywhere else. */
export function allowedOrigin(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
}

/** Constant-time string equality; unequal lengths are a plain false. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

// ── The state cookie ────────────────────────────────────────────────────────────────────

export type OAuthState = { nonce: string; artistId: string; userId: string; organizer: string | null; verifier: string; expiresAt: number }
type StatePayload = { n: string; a: string; u: string; o: string; v: string; e: number }

function stateSignature(body: string, secret: string): string {
  // Domain-separated: never mistaken for a YouTube or Shopify state, whatever the secret.
  return createHmac('sha256', secret).update(`lone-star:eventbrite-oauth-state:${body}`).digest('base64url')
}

/** PKCE S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * The nonce that goes to Eventbrite as `state`, the PKCE challenge, and the cookie that
 * remembers what the trip was for — SIGNED with the client secret (it names the artist the
 * token will be saved to) and bound to the MANAGER. An organizer hint that is not digits is
 * dropped here, so nothing but an id ever rides along.
 */
export function createState(
  input: { artistId: string; userId: string; organizer: string | null },
  secret: string,
  now: number = Date.now(),
): { nonce: string; challenge: string; cookie: string } {
  const nonce = randomBytes(16).toString('hex')
  const verifier = randomBytes(32).toString('base64url')
  const organizer = input.organizer && EVENTBRITE_ID.test(input.organizer) ? input.organizer : ''
  const payload: StatePayload = { n: nonce, a: input.artistId, u: input.userId, o: organizer, v: verifier, e: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { nonce, challenge: pkceChallenge(verifier), cookie: `${body}.${stateSignature(body, secret)}` }
}

/** The state cookie, read back. `expired` still names the artist (the signature proved we
 *  issued it), so the manager lands back on the right page with a reason. */
export function readState(
  cookie: string | undefined,
  secret: string,
  now: number = Date.now(),
): { ok: true; state: OAuthState } | { ok: false; reason: 'missing' | 'tampered' } | { ok: false; reason: 'expired'; artistId: string } {
  if (!cookie) return { ok: false, reason: 'missing' }
  const parts = cookie.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'tampered' }
  const [body, sig] = parts
  if (!safeEqual(stateSignature(body, secret), sig)) return { ok: false, reason: 'tampered' }
  let p: Partial<StatePayload>
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'tampered' }
  }
  if (
    !p ||
    typeof p.n !== 'string' ||
    typeof p.a !== 'string' ||
    typeof p.u !== 'string' ||
    typeof p.o !== 'string' ||
    (p.o !== '' && !EVENTBRITE_ID.test(p.o)) ||
    typeof p.v !== 'string' ||
    !VERIFIER.test(p.v) ||
    typeof p.e !== 'number'
  ) {
    return { ok: false, reason: 'tampered' }
  }
  if (now > p.e) return { ok: false, reason: 'expired', artistId: p.a }
  return { ok: true, state: { nonce: p.n, artistId: p.a, userId: p.u, organizer: p.o || null, verifier: p.v, expiresAt: p.e } }
}

/** Does this return belong to the trip the cookie remembers? The same nonce and the same
 *  signed-in manager. Null when it does; otherwise the failure to report. */
export function checkCallbackState(state: OAuthState, got: { nonce: string | null; userId: string | null }): 'state' | 'auth' | null {
  if (!got.nonce || !safeEqual(got.nonce, state.nonce)) return 'state'
  if (!got.userId || got.userId !== state.userId) return 'auth'
  return null
}

// ── The link to Eventbrite ──────────────────────────────────────────────────────────────

/** Eventbrite's authorize page for this app. Eventbrite has no scopes: the grant is the
 *  account's, which is why the token is only ever kept in Vault. */
export function authorizeUrl(opts: { clientId: string; redirectUri: string; nonce: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.nonce)
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ── Talking to Eventbrite ───────────────────────────────────────────────────────────────

/** A step Eventbrite refused. The message never holds a credential (at most Eventbrite's
 *  own short error code, like `invalid_grant`); only a CODE travels back to the page. */
export class EventbriteOAuthError extends Error {
  constructor(
    readonly step: 'exchange',
    message: string,
  ) {
    super(message)
    this.name = 'EventbriteOAuthError'
  }
}

/** The OAuth `error` field, only when it is the short snake_case code it should be. */
function oauthErrorCode(json: unknown): string {
  const e = (json as { error?: unknown } | null)?.error
  return typeof e === 'string' && /^[a-z_]{1,64}$/.test(e) ? ` ${e}` : ''
}

/**
 * Trade the one-time code for the artist's token. Form-encoded, as Eventbrite's docs ask;
 * `redirect: 'manual'` so a redirect can never carry the secret to another host.
 */
export async function exchangeCode(
  opts: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    }).toString(),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null
  if (!res.ok) throw new EventbriteOAuthError('exchange', `Eventbrite refused the code (HTTP ${res.status}${oauthErrorCode(json)}).`)
  const token = typeof json?.access_token === 'string' ? json.access_token.trim() : ''
  if (!token) throw new EventbriteOAuthError('exchange', 'Eventbrite sent no access token.')
  return token
}

// ── Which organizer page is this artist ─────────────────────────────────────────────────

export type OrganizerChoice = { ok: true; organizer: EventbriteOrganizer } | { ok: false; reason: 'none' | 'several' | 'elsewhere' }

/** A name as a comparison key: case, accents, spaces and punctuation aside. */
function nameKey(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The organizer page to connect, from every one on the signed-in account:
 *   - the one a pasted organizer link named (the hint) — or, when it is not on this
 *     account, a refusal: never another page in its place;
 *   - the only one there is;
 *   - of several, the ONE whose name is the artist's;
 *   - otherwise ASK: the page says to paste this artist's organizer link and connect again.
 */
export function chooseOrganizer(organizers: readonly EventbriteOrganizer[], opts: { hint: string | null; artistName: string }): OrganizerChoice {
  if (!organizers.length) return { ok: false, reason: 'none' }
  if (opts.hint) {
    const named = organizers.find((o) => o.id === opts.hint)
    return named ? { ok: true, organizer: named } : { ok: false, reason: 'elsewhere' }
  }
  if (organizers.length === 1) return { ok: true, organizer: organizers[0] }
  const key = nameKey(opts.artistName)
  const same = key ? organizers.filter((o) => nameKey(o.name) === key) : []
  return same.length === 1 ? { ok: true, organizer: same[0] } : { ok: false, reason: 'several' }
}

/** Every organizer page on every organization the account belongs to, then the choice.
 *  Throws (an `EventbriteApiError`) when Eventbrite will not answer. */
export async function findOrganizer(token: string, opts: { hint: string | null; artistName: string }, client: EventbriteClient = createEventbriteClient()): Promise<OrganizerChoice> {
  const organizations = await client.listOrganizations(token)
  const organizers: EventbriteOrganizer[] = []
  for (const org of organizations) organizers.push(...(await client.listOrganizers(token, org.id)))
  return chooseOrganizer(organizers, opts)
}

// ── Back to the Connections page ────────────────────────────────────────────────────────

/** Every way the trip can end badly, as a CODE. Only codes travel in the URL. */
export const OAUTH_FAILURES = ['config', 'state', 'denied', 'auth', 'exchange', 'organizer', 'none', 'several', 'elsewhere', 'connect', 'sync'] as const
export type OAuthFailure = (typeof OAUTH_FAILURES)[number]

/** The words for each, in a `Record` so a new code without words is a compile error. */
const FAILURE_WORDS: Record<OAuthFailure, string> = {
  config: 'Connecting with Eventbrite isn’t switched on here. Paste the organizer link instead.',
  state: 'That Eventbrite sign-in expired or didn’t match. Nothing was saved. Try again.',
  denied: 'Eventbrite connection cancelled. Nothing was saved.',
  auth: 'Sign in as this artist’s manager, then try again. Nothing was saved.',
  exchange: 'Eventbrite didn’t hand over access. Nothing was saved. Try again.',
  organizer: 'Couldn’t read the Eventbrite account. Nothing was saved. Try again.',
  none: 'No organizer profile on that Eventbrite account. Nothing was saved.',
  several:
    'That Eventbrite account has several organizer profiles. Paste this artist’s organizer link in the Eventbrite field, then press Connect with Eventbrite. Nothing was saved.',
  elsewhere: 'That organizer link isn’t on the Eventbrite account you signed in with. Nothing was saved.',
  connect: 'Couldn’t save the Eventbrite connection. Try again, or paste the organizer link.',
  sync: 'Eventbrite is connected, but pulling the shows failed. Open Eventbrite here and press Pull now.',
}

export function returnPath(artistId: string, outcome: { ok: true } | { ok: false; reason: OAuthFailure }): string {
  const base = `/artists/${artistId}/connections`
  if (outcome.ok) return `${base}?eventbrite=connected`
  return `${base}?${new URLSearchParams({ eventbrite: 'failed', reason: outcome.reason })}`
}

export type EventbriteReturn = { kind: 'success' | 'error'; message: string }

/** What the Connections page says when the manager comes back from Eventbrite, read from
 *  the page's query. Unknown reasons read as a generic failure — never as their own text. */
export function eventbriteReturnNotice(query: Record<string, string | string[] | undefined>): EventbriteReturn | null {
  const status = typeof query.eventbrite === 'string' ? query.eventbrite : null
  if (status === 'connected') return { kind: 'success', message: 'Eventbrite connected.' }
  if (status !== 'failed') return null
  const reason = typeof query.reason === 'string' ? query.reason : ''
  if ((OAUTH_FAILURES as readonly string[]).includes(reason)) return { kind: 'error', message: FAILURE_WORDS[reason as OAuthFailure] }
  return { kind: 'error', message: FAILURE_WORDS.connect }
}
