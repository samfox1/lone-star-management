/**
 * THE SHOPIFY APP — connect a store by OAuth instead of pasting a token (Sam, 2026-09-28:
 * "I want things to be as easy as they can be … If they have their own connect portal …
 * lets just prompt that").
 *
 * The flow, end to end:
 *   1. /api/shopify/install checks the manager owns the artist, signs a STATE cookie (this
 *      artist, this manager, this store, a nonce, ten minutes) and sends the browser to the
 *      store's /admin/oauth/authorize.
 *   2. The store's owner approves; Shopify sends the browser to /api/shopify/callback with a
 *      one-time `code`, signed with the app secret (`hmac`).
 *   3. The callback checks the signature, the nonce, the store and the manager, trades the
 *      code for an Admin token, uses it ONCE to make a Storefront token and register the
 *      uninstall webhook, then saves the Storefront token through the SAME connect path the
 *      typed token uses (`connectOneAction` → `connect_shopify` + the probe + the first
 *      pull). The Admin token is never stored anywhere.
 *   4. /api/shopify/webhooks hears `app/uninstalled` and disconnects that store.
 *
 * Only the app's two credentials come from the environment (`SHOPIFY_API_KEY`,
 * `SHOPIFY_API_SECRET`). Without them the whole flow is off and the Connect window keeps
 * today's domain + token fields.
 *
 * Everything that decides whether a request is TRUSTED is a plain function here, so each
 * rule has a unit test (tests/unit/shopify/shopify-oauth.test.ts). Nothing in this file logs,
 * and no error message it builds ever carries a token, a code or the secret.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isShopDomain } from './shop-domain'
import { PROBE_FAILURES, probeAdvice, type ProbeFailure } from './probe'

/**
 * The ONE scope the app asks for: read the store's published products. That covers every
 * field the merch code reads through the Storefront API (`src/lib/merch/shopify.ts`): title,
 * handle, description, images, price range, variants with `availableForSale` and price, and
 * the product metafields published to the Storefront. The storefront token the app makes
 * carries exactly the app's unauthenticated scopes, so this list IS what that token can do.
 *
 * Deliberately NOT asked for: `unauthenticated_read_product_inventory` (the exact
 * `quantityAvailable` — nothing reads it; sold-out is `availableForSale`), product tags,
 * checkouts/carts (checkout is a Shopify cart permalink, no API), customers, and every
 * `write_*`. No Admin scope is needed to create a Storefront token or an app/uninstalled
 * subscription.
 */
export const SHOPIFY_SCOPES = ['unauthenticated_read_product_listings'] as const

/** The Admin API version for the two calls the callback makes. A retired version keeps
 *  working (Shopify serves the oldest supported one), so this only has to exist. */
const ADMIN_API_VERSION = '2026-07'

export const STATE_COOKIE = 'ls_shopify_oauth'
/** How long a trip to Shopify may take: signing in to the store plus approving. */
export const STATE_TTL_MS = 10 * 60 * 1000
export const CALLBACK_PATH = '/api/shopify/callback'
export const WEBHOOK_PATH = '/api/shopify/webhooks'

const TIMEOUT_MS = 10_000

export type ShopifyAppConfig = { apiKey: string; apiSecret: string }

/** The app's credentials, or null when either is missing (blank counts as missing). */
export function shopifyAppConfig(env: Record<string, string | undefined> = process.env): ShopifyAppConfig | null {
  const apiKey = env.SHOPIFY_API_KEY?.trim()
  const apiSecret = env.SHOPIFY_API_SECRET?.trim()
  return apiKey && apiSecret ? { apiKey, apiSecret } : null
}

/** Whether "Connect with Shopify" is on. The ONLY thing about the app that reaches the
 *  browser: a boolean, never the key or the secret. */
export function shopifyAppConfigured(): boolean {
  return shopifyAppConfig() !== null
}

/** Constant-time string equality. Unequal lengths are a plain false (timingSafeEqual would
 *  throw), which leaks only the length — public for a fixed-size digest anyway. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

// ── The callback's signature ────────────────────────────────────────────────────────────

/**
 * Is this callback query signed by Shopify with our app secret?
 *
 * Shopify's recipe: drop `hmac`, sort the rest by key, join as `key=value` with `&`,
 * HMAC-SHA256 with the app secret, hex. Shopify's docs build that string from the DECODED
 * values; Shopify's own Node library (`@shopify/shopify-api`) re-encodes them with
 * URLSearchParams first. The two agree for every value a callback normally carries and could
 * differ only if a value held a `+`, `/` or `=` (the base64 `host`), so both are accepted.
 * That costs nothing: either one still needs the secret to produce.
 *
 * Exactly ONE `hmac`: with two, "which one counts" is an ambiguity nobody needs. Any other
 * repeated key is already refused by the signature, since every copy is in the message.
 */
export function verifyCallbackHmac(params: URLSearchParams, secret: string): boolean {
  const given = params.getAll('hmac')
  if (given.length !== 1 || !given[0]) return false
  const entries = [...params.entries()].filter(([k]) => k !== 'hmac')
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const decoded = entries.map(([k, v]) => `${k}=${v}`).join('&')
  const encoded = new URLSearchParams(entries).toString()
  const sign = (message: string) => createHmac('sha256', secret).update(message).digest('hex')
  // Both compared, not short-circuited, so the time taken does not depend on which matched.
  const a = safeEqual(sign(decoded), given[0])
  const b = safeEqual(sign(encoded), given[0])
  return a || b
}

// ── The state cookie ────────────────────────────────────────────────────────────────────

export type OAuthState = { nonce: string; artistId: string; userId: string; shop: string; expiresAt: number }
type StatePayload = { n: string; a: string; u: string; s: string; e: number }

function stateSignature(body: string, secret: string): string {
  // Domain-separated, so this signature can never be mistaken for any other use of the secret.
  return createHmac('sha256', secret).update(`lone-star:shopify-oauth-state:${body}`).digest('base64url')
}

/**
 * The nonce that goes to Shopify as `state`, and the cookie that remembers what it was for.
 *
 * The cookie is SIGNED with the app secret, not just HttpOnly: it names the artist the
 * connection will be saved to, and a cookie can sometimes be planted by a sibling subdomain.
 * It is bound to the MANAGER too, so a trip started in one person's session cannot be
 * finished in another's.
 */
export function createState(
  input: { artistId: string; userId: string; shop: string },
  secret: string,
  now: number = Date.now(),
): { nonce: string; cookie: string } {
  const nonce = randomBytes(16).toString('hex')
  const payload: StatePayload = { n: nonce, a: input.artistId, u: input.userId, s: input.shop, e: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { nonce, cookie: `${body}.${stateSignature(body, secret)}` }
}

/**
 * The state cookie, read back. `expired` still names the artist — the signature proved we
 * issued it — so the manager lands back on the right page with a reason, rather than on the
 * home screen with nothing.
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
  if (!p || typeof p.n !== 'string' || typeof p.a !== 'string' || typeof p.u !== 'string' || typeof p.s !== 'string' || typeof p.e !== 'number') {
    return { ok: false, reason: 'tampered' }
  }
  if (now > p.e) return { ok: false, reason: 'expired', artistId: p.a }
  return { ok: true, state: { nonce: p.n, artistId: p.a, userId: p.u, shop: p.s, expiresAt: p.e } }
}

/**
 * Does this return belong to the trip the cookie remembers? The same nonce, the same store
 * (a signed callback for ANOTHER store is still refused), and the same signed-in manager.
 * Null when it does; otherwise the failure to report.
 */
export function checkCallbackState(
  state: OAuthState,
  got: { nonce: string | null; shop: string | null; userId: string | null },
): 'state' | 'shop' | 'auth' | null {
  if (!got.nonce || !safeEqual(got.nonce, state.nonce)) return 'state'
  if (!isShopDomain(got.shop) || got.shop !== state.shop) return 'shop'
  if (!got.userId || got.userId !== state.userId) return 'auth'
  return null
}

// ── The link to Shopify ─────────────────────────────────────────────────────────────────

/** Shopify's approve screen for this store. Offline access (per store, not per staff
 *  member): an online token would add `grant_options[]=per-user`. */
export function authorizeUrl(opts: { shop: string; apiKey: string; redirectUri: string; nonce: string }): string {
  if (!isShopDomain(opts.shop)) throw new Error('Not a Shopify store address.')
  const url = new URL(`https://${opts.shop}/admin/oauth/authorize`)
  url.searchParams.set('client_id', opts.apiKey)
  url.searchParams.set('scope', SHOPIFY_SCOPES.join(','))
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.nonce)
  return url.toString()
}

/** The scopes we asked for that Shopify did not grant. For the `unauthenticated_*` scopes a
 *  write does not imply a read, so this is a plain set difference. */
export function missingScopes(granted: readonly string[]): string[] {
  return SHOPIFY_SCOPES.filter((s) => !granted.includes(s))
}

// ── Talking to Shopify ──────────────────────────────────────────────────────────────────

/** A step of the connect that Shopify refused. The message never holds a credential (at
 *  most a Shopify userError's own sentence), and only its `step` travels back to the page. */
class ShopifyOAuthError extends Error {
  constructor(
    readonly step: 'exchange' | 'token',
    message: string,
  ) {
    super(message)
    this.name = 'ShopifyOAuthError'
  }
}

/**
 * Trade the one-time code for an Admin API token. `redirect: 'manual'` so a redirect can
 * never carry a body holding the app secret to another host; anything but a 2xx fails.
 * `expiring=1`: Shopify now asks new apps for expiring offline tokens; this one is used
 * within the next second and then dropped, so its lifetime never matters.
 */
export async function exchangeCode(
  opts: { shop: string; code: string; apiKey: string; apiSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; scopes: string[] }> {
  if (!isShopDomain(opts.shop)) throw new ShopifyOAuthError('exchange', 'Not a Shopify store address.')
  const res = await fetchImpl(`https://${opts.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: opts.apiKey, client_secret: opts.apiSecret, code: opts.code, expiring: '1' }).toString(),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new ShopifyOAuthError('exchange', `Shopify refused the code (HTTP ${res.status}).`)
  const json = (await res.json().catch(() => null)) as { access_token?: unknown; scope?: unknown } | null
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : ''
  if (!accessToken) throw new ShopifyOAuthError('exchange', 'Shopify sent no access token.')
  const scopes = typeof json?.scope === 'string' ? json.scope.split(',').map((s) => s.trim()).filter(Boolean) : []
  return { accessToken, scopes }
}

async function adminGraphql<T>(shop: string, adminToken: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T | null> {
  if (!isShopDomain(shop)) return null
  const res = await fetchImpl(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({ query, variables }),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as { data?: T } | null
  return json?.data ?? null
}

const STOREFRONT_TOKEN_CREATE = `
  mutation StorefrontTokenCreate($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) {
      storefrontAccessToken { accessToken }
      userErrors { field message }
    }
  }
`

/**
 * Make the Storefront token the merch pull and the live price lane read with — the same kind
 * of token a manager used to paste. It carries the app's unauthenticated scopes and nothing
 * else. Each connect makes a new one (Shopify allows 100 per store); they all die when the
 * app is uninstalled.
 */
export async function createStorefrontToken(opts: { shop: string; adminToken: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  type Data = { storefrontAccessTokenCreate?: { storefrontAccessToken?: { accessToken?: string } | null; userErrors?: { message?: string }[] } }
  const data = await adminGraphql<Data>(opts.shop, opts.adminToken, STOREFRONT_TOKEN_CREATE, { input: { title: 'Lone Star' } }, fetchImpl).catch(() => null)
  const token = data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken
  if (typeof token === 'string' && token) return token
  const why = data?.storefrontAccessTokenCreate?.userErrors?.[0]?.message
  throw new ShopifyOAuthError('token', why ? `Shopify wouldn't make a storefront token: ${why.slice(0, 200)}` : 'Shopify wouldn’t make a storefront token.')
}

const WEBHOOK_CREATE = `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`

/**
 * Ask this store to tell us when the app is uninstalled. Registered per store, with the Admin
 * token we hold for this one request, so it works whatever the app's own settings say; a
 * store that already has it answers with a userError, which is fine. BEST EFFORT: false on
 * any failure, never a throw — a missed subscription must not undo a working connection.
 */
export async function registerUninstallWebhook(opts: { shop: string; adminToken: string; uri: string }, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  type Data = { webhookSubscriptionCreate?: { webhookSubscription?: { id?: string } | null } }
  try {
    const data = await adminGraphql<Data>(
      opts.shop,
      opts.adminToken,
      WEBHOOK_CREATE,
      { topic: 'APP_UNINSTALLED', webhookSubscription: { uri: opts.uri, format: 'JSON' } },
      fetchImpl,
    )
    return !!data?.webhookSubscriptionCreate?.webhookSubscription?.id
  } catch {
    return false
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────────────────────

/** Is this webhook body signed by Shopify with our app secret? Base64 HMAC-SHA256 of the RAW
 *  bytes, in `X-Shopify-Hmac-Sha256`. The body must be the bytes as received, not re-serialised. */
export function verifyWebhookHmac(body: Uint8Array, header: string | null, secret: string): boolean {
  if (!header) return false
  const digest = createHmac('sha256', secret).update(body).digest('base64')
  return safeEqual(digest, header.trim())
}

// ── Back to the Connections page ────────────────────────────────────────────────────────

/** Every way the trip can end badly, as a CODE. Only codes travel in the URL: free text in a
 *  query string is something anyone can put on our page. */
export const OAUTH_FAILURES = ['config', 'shop', 'state', 'hmac', 'denied', 'auth', 'exchange', 'scope', 'token', 'connect', 'sync'] as const
type OAuthFailure = (typeof OAUTH_FAILURES)[number]
/** A failure, or a probe failure after the token was saved (`probe-bad-token`, …). */
export type ReturnReason = OAuthFailure | `probe-${ProbeFailure}`

/** The words for each, in a `Record` so a new code without words is a compile error. */
const FAILURE_WORDS: Record<OAuthFailure, string> = {
  config: 'Connecting with Shopify isn’t switched on yet. Use the store domain and token instead.',
  shop: 'That isn’t a Shopify store address. Use the one ending in .myshopify.com.',
  state: 'That Shopify sign-in expired or didn’t match. Nothing was saved. Try again.',
  hmac: 'Shopify’s reply couldn’t be checked, so nothing was saved. Try again.',
  denied: 'Shopify didn’t give access, so nothing was saved.',
  auth: 'Sign in as this artist’s manager, then try again. Nothing was saved.',
  exchange: 'Shopify didn’t hand over access. Nothing was saved. Try again.',
  scope: 'Shopify gave less access than Lone Star needs. Try again and approve the request.',
  token: 'Shopify wouldn’t make a store token. Nothing was saved. Try again.',
  connect: 'Couldn’t save the store. Try again.',
  sync: 'Shopify is connected, but the first pull failed. Open Shopify here and press Pull now.',
}

export function returnPath(artistId: string, outcome: { ok: true } | { ok: false; reason: ReturnReason }): string {
  const base = `/artists/${artistId}/connections`
  if (outcome.ok) return `${base}?shopify=connected`
  return `${base}?${new URLSearchParams({ shopify: 'failed', reason: outcome.reason })}`
}

export type ShopifyReturn = { kind: 'success' | 'error'; message: string }

/** What the Connections page says when the manager comes back from Shopify, read from the
 *  page's query. Unknown reasons read as a generic failure — never as their own text. */
export function shopifyReturnNotice(query: Record<string, string | string[] | undefined>): ShopifyReturn | null {
  const status = typeof query.shopify === 'string' ? query.shopify : null
  if (status === 'connected') return { kind: 'success', message: 'Shopify connected.' }
  if (status !== 'failed') return null
  const reason = typeof query.reason === 'string' ? query.reason : ''
  if ((OAUTH_FAILURES as readonly string[]).includes(reason)) return { kind: 'error', message: FAILURE_WORDS[reason as OAuthFailure] }
  const probe = reason.startsWith('probe-') ? reason.slice('probe-'.length) : ''
  if ((PROBE_FAILURES as readonly string[]).includes(probe)) {
    return { kind: 'error', message: `Shopify is connected, but reading the store failed: ${probeAdvice(probe as ProbeFailure).title}.` }
  }
  return { kind: 'error', message: FAILURE_WORDS.connect }
}
