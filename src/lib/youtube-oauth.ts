/**
 * CONNECT WITH YOUTUBE — find the manager's channel by a Google sign-in instead of a pasted
 * link (Sam, 2026-09-28). The Shopify app (`src/lib/merch/shopify-oauth.ts`) is the pattern.
 *
 * The flow, end to end:
 *   1. /api/youtube/start checks the manager owns the artist, signs a STATE cookie (this
 *      artist, this manager, the Sync choice, a nonce, a PKCE verifier, ten minutes) and
 *      sends the browser to Google's sign-in, asking for `youtube.readonly` and nothing else.
 *   2. The manager picks an account and presses Allow; Google sends the browser to
 *      /api/youtube/callback with a one-time `code` (or `error=access_denied` on Cancel).
 *   3. The callback checks the state, the manager and their ownership, trades the code (with
 *      the verifier) for an access token, reads `channels?mine=true` ONCE, revokes the token,
 *      then saves the channel through the SAME door a pasted link uses (`connectOneAction`
 *      → the profile `links` row + `youtube_channel_id` + the first import).
 *
 * THE TOKEN IS NEVER KEPT. We only need the channel id: the video sync already reads public
 * data with the API key (`YOUTUBE_API_KEY`). So the access token lives inside one request —
 * no database, no cookie, no log — and is then REVOKED rather than left to expire. Revoking
 * costs one best-effort request, kills the token at once instead of in an hour, and removes
 * Tapir from the account's "apps with access" list, which is honest: we hold no access. It
 * also means a future Connect asks again, which is right for a one-time lookup. `access_type
 * =online` means Google sends no refresh token; if one ever came it would die with the grant.
 *
 * Only the app's two credentials come from the environment (`GOOGLE_OAUTH_CLIENT_ID`,
 * `GOOGLE_OAUTH_CLIENT_SECRET`). Without them the button is hidden and pasting is the way.
 *
 * Everything that decides whether a request is TRUSTED is a plain function here, so each
 * rule has a unit test (tests/unit/manager-tools/connections/youtube-oauth.test.ts). Nothing
 * in this file logs, and no error message it builds carries a token, a code or the secret.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CONNECT_METHODS, parseHandle, type HandleMethod } from '@/lib/connect-methods'
import type { ConnectInput } from '@/lib/connections'

/** The ONE scope: read the signed-in account's own channel. No upload, no manage, no email. */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'

export const STATE_COOKIE = 'ls_youtube_oauth'
/** How long a trip to Google may take: picking an account plus pressing Allow. */
export const STATE_TTL_MS = 10 * 60 * 1000
export const CALLBACK_PATH = '/api/youtube/callback'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const MY_CHANNEL_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true'
const TIMEOUT_MS = 10_000

/** A YouTube channel id: `UC` + 22 url-safe base64 characters. It goes into a link. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
/** RFC 7636's verifier alphabet and length. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

export type GoogleOAuthConfig = { clientId: string; clientSecret: string }

/** The app's credentials, or null when either is missing (blank counts as missing). */
export function googleOAuthConfig(env: Record<string, string | undefined> = process.env): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Whether "Connect with YouTube" shows. The ONLY thing about the app that reaches the
 *  browser: a boolean, never the id or the secret. */
export function youtubeOAuthConfigured(): boolean {
  return googleOAuthConfig() !== null
}

/** Only https, or plain http on localhost (dev). Google refuses any other http redirect
 *  anyway; checking here means a state cookie is never set, or read, anywhere else. */
export function allowedOrigin(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
}

/** Constant-time string equality. Unequal lengths are a plain false (timingSafeEqual would
 *  throw), which leaks only the length — fixed for a nonce or a digest anyway. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

// ── The state cookie ────────────────────────────────────────────────────────────────────

export type OAuthState = { nonce: string; artistId: string; userId: string; sync: boolean; verifier: string; expiresAt: number }
type StatePayload = { n: string; a: string; u: string; y: boolean; v: string; e: number }

function stateSignature(body: string, secret: string): string {
  // Domain-separated: never mistaken for a Shopify state, or any other use of a secret.
  return createHmac('sha256', secret).update(`lone-star:youtube-oauth-state:${body}`).digest('base64url')
}

/** PKCE S256: base64url(sha256(verifier)). */
function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * The nonce that goes to Google as `state`, the PKCE challenge, and the cookie that remembers
 * what the trip was for. SIGNED with the client secret (it names the artist the channel will
 * be saved to) and bound to the MANAGER, so a trip started in one session cannot be finished
 * in another. The verifier rides in the same HttpOnly cookie, scoped to the callback path.
 */
export function createState(
  input: { artistId: string; userId: string; sync: boolean },
  secret: string,
  now: number = Date.now(),
): { nonce: string; challenge: string; cookie: string } {
  const nonce = randomBytes(16).toString('hex')
  const verifier = randomBytes(32).toString('base64url')
  const payload: StatePayload = { n: nonce, a: input.artistId, u: input.userId, y: input.sync, v: verifier, e: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { nonce, challenge: pkceChallenge(verifier), cookie: `${body}.${stateSignature(body, secret)}` }
}

/**
 * The state cookie, read back. `expired` still names the artist — the signature proved we
 * issued it — so the manager lands back on the right page with a reason.
 */
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
    typeof p.y !== 'boolean' ||
    typeof p.v !== 'string' ||
    !VERIFIER.test(p.v) ||
    typeof p.e !== 'number'
  ) {
    return { ok: false, reason: 'tampered' }
  }
  if (now > p.e) return { ok: false, reason: 'expired', artistId: p.a }
  return { ok: true, state: { nonce: p.n, artistId: p.a, userId: p.u, sync: p.y, verifier: p.v, expiresAt: p.e } }
}

/** Does this return belong to the trip the cookie remembers? The same nonce and the same
 *  signed-in manager. Null when it does; otherwise the failure to report. */
export function checkCallbackState(state: OAuthState, got: { nonce: string | null; userId: string | null }): 'state' | 'auth' | null {
  if (!got.nonce || !safeEqual(got.nonce, state.nonce)) return 'state'
  if (!got.userId || got.userId !== state.userId) return 'auth'
  return null
}

// ── The link to Google ──────────────────────────────────────────────────────────────────

/**
 * Google's sign-in for this app. `access_type=online`: no refresh token, we never come back.
 * `include_granted_scopes=false`: the token carries this one scope, not anything granted
 * before. `prompt=select_account`: the manager picks which Google account (a brand
 * account's channel is its own account in that list).
 */
export function authorizeUrl(opts: { clientId: string; redirectUri: string; nonce: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', YOUTUBE_SCOPE)
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('include_granted_scopes', 'false')
  url.searchParams.set('prompt', 'select_account')
  url.searchParams.set('state', opts.nonce)
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ── Talking to Google ───────────────────────────────────────────────────────────────────

/** A step Google refused. The message never holds a credential (at most Google's own short
 *  error code, like `invalid_grant`), and only a CODE travels back to the page. */
export class YouTubeOAuthError extends Error {
  constructor(
    readonly step: 'exchange' | 'channel',
    message: string,
  ) {
    super(message)
    this.name = 'YouTubeOAuthError'
  }
}

/** Google's `error` field, only when it is the short snake_case code it should be. */
function googleErrorCode(json: unknown): string {
  const e = (json as { error?: unknown } | null)?.error
  return typeof e === 'string' && /^[a-z_]{1,64}$/.test(e) ? ` ${e}` : ''
}

/**
 * Trade the one-time code (and the PKCE verifier) for an access token. `redirect: 'manual'`
 * so a redirect can never carry a body holding the secret to another host.
 */
export async function exchangeCode(
  opts: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; scopes: string[] }> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: opts.verifier,
    }).toString(),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => null)) as { access_token?: unknown; scope?: unknown } | null
  if (!res.ok) throw new YouTubeOAuthError('exchange', `Google refused the code (HTTP ${res.status}${googleErrorCode(json)}).`)
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : ''
  if (!accessToken) throw new YouTubeOAuthError('exchange', 'Google sent no access token.')
  const scopes = typeof json?.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : []
  return { accessToken, scopes }
}

/** Did Google grant the read scope? (Its consent screen can grant less than asked.) */
export function grantedYouTube(scopes: readonly string[]): boolean {
  return scopes.includes(YOUTUBE_SCOPE)
}

export type MyChannel = { id: string; handle: string | null }

/** The reasons YouTube gives for "this account has no channel". */
const NO_CHANNEL = new Set(['youtubeSignupRequired', 'channelNotFound'])

/**
 * The signed-in account's own channel: its `UC…` id and its `@handle` (`snippet.customUrl`
 * when it starts with `@`; an older custom url without one is not a handle). Null when the
 * account has no channel. The token goes in the Authorization header, never the URL.
 */
export async function readMyChannel(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MyChannel | null> {
  const res = await fetchImpl(MY_CHANNEL_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  type Body = { items?: { id?: unknown; snippet?: { customUrl?: unknown } }[]; error?: { errors?: { reason?: unknown }[] } }
  const json = (await res.json().catch(() => null)) as Body | null
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason
    if (typeof reason === 'string' && NO_CHANNEL.has(reason)) return null
    throw new YouTubeOAuthError('channel', `YouTube refused the channel read (HTTP ${res.status}).`)
  }
  const item = json?.items?.[0]
  if (!item) return null
  if (typeof item.id !== 'string' || !CHANNEL_ID.test(item.id)) throw new YouTubeOAuthError('channel', 'YouTube sent a channel id that isn’t one.')
  const custom = item.snippet?.customUrl
  return { id: item.id, handle: typeof custom === 'string' && custom.startsWith('@') ? custom : null }
}

/** Revoke the token (and with it the grant). BEST EFFORT: false on any failure, never a
 *  throw — an unrevoked token still dies within the hour, and a found channel is not undone. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The found channel as the Connect window's own input, so `connectOneAction` treats it
 * exactly like a paste: the handle (without its `@`, as the field sends it) when YouTube's
 * handle rule takes it, otherwise the channel link, kept whole. `id` is the real `UC…` id,
 * which the save door keeps as it is instead of looking the handle up again.
 */
export function channelConnectInput(channel: MyChannel, sync: boolean): ConnectInput {
  const method = CONNECT_METHODS.youtube as HandleMethod
  const parsed = channel.handle ? parseHandle(method, channel.handle) : null
  const handle = parsed && !('error' in parsed) && parsed.handle ? parsed.handle : `https://youtube.com/channel/${channel.id}`
  return { handle, id: channel.id, sync }
}

// ── Back to the Connections page ────────────────────────────────────────────────────────

/** Every way the trip can end badly, as a CODE. Only codes travel in the URL: free text in
 *  a query string is something anyone can put on our page. */
export const OAUTH_FAILURES = ['config', 'state', 'denied', 'auth', 'exchange', 'scope', 'channel', 'none', 'connect', 'sync'] as const
export type OAuthFailure = (typeof OAUTH_FAILURES)[number]

/** The words for each, in a `Record` so a new code without words is a compile error. */
const FAILURE_WORDS: Record<OAuthFailure, string> = {
  config: 'Connecting with YouTube isn’t switched on here. Paste the channel link instead.',
  state: 'That Google sign-in expired or didn’t match. Nothing was saved. Try again.',
  denied: 'YouTube connection cancelled. Nothing was saved.',
  auth: 'Sign in as this artist’s manager, then try again. Nothing was saved.',
  exchange: 'Google didn’t hand over access. Nothing was saved. Try again.',
  scope: 'Google didn’t allow reading the channel. Nothing was saved. Try again and press Allow.',
  channel: 'Couldn’t read the YouTube channel. Nothing was saved. Try again.',
  none: 'No YouTube channel on that Google account. Try another account, or paste the channel link.',
  connect: 'Couldn’t save the YouTube channel. Try again, or paste the channel link.',
  sync: 'YouTube is connected, but importing the videos failed. Open YouTube here and press Pull now.',
}

export function returnPath(artistId: string, outcome: { ok: true } | { ok: false; reason: OAuthFailure }): string {
  const base = `/artists/${artistId}/connections`
  if (outcome.ok) return `${base}?youtube=connected`
  return `${base}?${new URLSearchParams({ youtube: 'failed', reason: outcome.reason })}`
}

export type YouTubeReturn = { kind: 'success' | 'error'; message: string }

/** What the Connections page says when the manager comes back from Google, read from the
 *  page's query. Unknown reasons read as a generic failure — never as their own text. */
export function youtubeReturnNotice(query: Record<string, string | string[] | undefined>): YouTubeReturn | null {
  const status = typeof query.youtube === 'string' ? query.youtube : null
  if (status === 'connected') return { kind: 'success', message: 'YouTube connected.' }
  if (status !== 'failed') return null
  const reason = typeof query.reason === 'string' ? query.reason : ''
  if ((OAUTH_FAILURES as readonly string[]).includes(reason)) return { kind: 'error', message: FAILURE_WORDS[reason as OAuthFailure] }
  return { kind: 'error', message: FAILURE_WORDS.connect }
}
