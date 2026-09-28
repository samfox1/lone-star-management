// The Shopify app's pure pieces: the callback and webhook signatures, the state that binds a
//   trip to Shopify to one manager and one artist, the store address, the authorize link.
/**
 * Connecting Shopify by OAuth (Sam, 2026-09-28: "If they have their own connect portal …
 * lets just prompt that"). Everything that decides whether a request is TRUSTED lives in
 * `src/lib/merch/shopify-oauth.ts` as plain functions, so each rule is pinned here without a
 * route, a database or a network:
 *
 *   - the callback's `hmac` is Shopify's signature over the other query params (sorted,
 *     `k=v` joined by `&`, HMAC-SHA256 hex with the app secret). The expected value below is
 *     computed straight from that spec with node's crypto, never with the code under test;
 *   - the comparison is constant-time (`timingSafeEqual`), and a wrong-LENGTH signature is a
 *     plain `false`, not a thrown RangeError;
 *   - the `state` cookie is signed with the app secret, carries the artist + the manager +
 *     the store, and expires; a tampered artist, a stranger, another store or a late return
 *     are all refused;
 *   - a webhook's signature is base64 HMAC-SHA256 of the RAW body.
 */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Spy on timingSafeEqual while keeping the real implementation: the rule "compare in constant
// time" is an implementation property, and this is the only way to see it.
const crypto = vi.hoisted(() => ({ calls: 0 }))
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      crypto.calls++
      return real.timingSafeEqual(a, b)
    },
  }
})

import {
  OAUTH_FAILURES,
  SHOPIFY_SCOPES,
  STATE_TTL_MS,
  authorizeUrl,
  checkCallbackState,
  createState,
  createStorefrontToken,
  exchangeCode,
  missingScopes,
  readState,
  registerUninstallWebhook,
  returnPath,
  shopifyAppConfig,
  shopifyReturnNotice,
  verifyCallbackHmac,
  verifyWebhookHmac,
} from '@/lib/merch/shopify-oauth'
import { isShopDomain, normalizeShopDomain, shopifyInstallPath } from '@/lib/merch/shop-domain'
import { PROBE_FAILURES, probeAdvice } from '@/lib/merch/probe'

const SECRET = 'shpss_test_secret'
const SHOP = 'skeen-store.myshopify.com'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const OTHER_ARTIST = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'

afterEach(() => {
  crypto.calls = 0
})

/** Shopify's own recipe, written out from the spec — not the code under test. */
function signQuery(params: Record<string, string>, secret = SECRET): URLSearchParams {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  const hmac = createHmac('sha256', secret).update(message).digest('hex')
  return new URLSearchParams({ ...params, hmac })
}

const CALLBACK = { code: 'abc123', host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvc2tlZW4tc3RvcmU', shop: SHOP, state: 'nonce-1', timestamp: '1727500000' }

describe('the callback signature (hmac)', () => {
  it('CRITICAL: accepts a query Shopify signed', () => {
    expect(verifyCallbackHmac(signQuery(CALLBACK), SECRET)).toBe(true)
  })

  it('CRITICAL: refuses when any signed param was changed after signing', () => {
    expect(verifyCallbackHmac(signQuery(CALLBACK), SECRET)).toBe(true) // witness
    for (const key of Object.keys(CALLBACK) as (keyof typeof CALLBACK)[]) {
      const q = signQuery(CALLBACK)
      q.set(key, `${CALLBACK[key]}x`)
      expect(verifyCallbackHmac(q, SECRET), key).toBe(false)
    }
  })

  it('CRITICAL: refuses a param added after signing (another store, say)', () => {
    const q = signQuery(CALLBACK)
    expect(verifyCallbackHmac(q, SECRET)).toBe(true) // witness
    q.set('shop_override', 'evil.myshopify.com')
    expect(verifyCallbackHmac(q, SECRET)).toBe(false)
  })

  it('refuses a signature made with another secret, a missing one, and a repeated key', () => {
    expect(verifyCallbackHmac(signQuery(CALLBACK), SECRET)).toBe(true) // witness
    expect(verifyCallbackHmac(signQuery(CALLBACK, 'another-app-secret'), SECRET)).toBe(false)
    const unsigned = signQuery(CALLBACK)
    unsigned.delete('hmac')
    expect(verifyCallbackHmac(unsigned, SECRET)).toBe(false)
    // A second store after the signed one: every copy is in the signed message, so the
    // signature itself refuses it.
    const doubled = signQuery(CALLBACK)
    doubled.append('shop', 'evil.myshopify.com')
    expect(verifyCallbackHmac(doubled, SECRET)).toBe(false)
    // A second hmac: the valid one still first. Refused on the count alone — without that
    // rule this passes, because `hmac` is not part of the message.
    const twoSigs = signQuery(CALLBACK)
    twoSigs.append('hmac', 'f'.repeat(64))
    expect(verifyCallbackHmac(twoSigs, SECRET)).toBe(false)
  })

  it('CRITICAL: compares in constant time, and a wrong-length signature is false, not a throw', () => {
    const q = signQuery(CALLBACK)
    expect(verifyCallbackHmac(q, SECRET)).toBe(true)
    expect(crypto.calls).toBeGreaterThan(0)
    q.set('hmac', 'abc')
    expect(() => verifyCallbackHmac(q, SECRET)).not.toThrow()
    expect(verifyCallbackHmac(q, SECRET)).toBe(false)
  })
})

describe('the state cookie', () => {
  const T0 = 1_000_000

  it('CRITICAL: round-trips the artist, the manager, the store and the nonce', () => {
    const { nonce, cookie } = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0)
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    const read = readState(cookie, SECRET, T0 + 1000)
    expect(read).toEqual({ ok: true, state: { nonce, artistId: ARTIST, userId: USER, shop: SHOP, expiresAt: T0 + STATE_TTL_MS } })
  })

  it('two trips never share a nonce', () => {
    const a = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0)
    const b = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0)
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('CRITICAL: a cookie edited to point at another artist is refused', () => {
    const { cookie } = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0)
    const [body, sig] = cookie.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const forged = Buffer.from(JSON.stringify({ ...payload, a: OTHER_ARTIST })).toString('base64url')
    // Witness: the untouched cookie reads, so the refusal below is the edit's doing.
    expect(readState(cookie, SECRET, T0).ok).toBe(true)
    expect(readState(`${forged}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  it('CRITICAL: a cookie signed with another secret is refused', () => {
    const { cookie } = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, 'another-secret', T0)
    expect(readState(cookie, 'another-secret', T0).ok).toBe(true) // witness: it is a real cookie
    expect(readState(cookie, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  it('CRITICAL: a late return is refused, but still names its artist so the page can say so', () => {
    const { cookie } = createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0)
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS - 1).ok).toBe(true)
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired', artistId: ARTIST })
  })

  it('no cookie, or garbage, is refused without throwing', () => {
    expect(readState(createState({ artistId: ARTIST, userId: USER, shop: SHOP }, SECRET, T0).cookie, SECRET, T0).ok).toBe(true) // witness
    expect(readState(undefined, SECRET, T0)).toEqual({ ok: false, reason: 'missing' })
    expect(readState('', SECRET, T0)).toEqual({ ok: false, reason: 'missing' })
    for (const junk of ['nodot', 'a.b.c', '.', '%%%.%%%', `${Buffer.from('not json').toString('base64url')}.x`]) {
      expect(() => readState(junk, SECRET, T0)).not.toThrow()
      expect(readState(junk, SECRET, T0).ok).toBe(false)
    }
  })

  describe('checkCallbackState — what the return must match', () => {
    const state = { nonce: 'n'.repeat(32), artistId: ARTIST, userId: USER, shop: SHOP, expiresAt: Infinity }
    const good = { nonce: state.nonce, shop: SHOP, userId: USER }

    it('the matching return passes (the witness for every refusal below)', () => {
      expect(checkCallbackState(state, good)).toBeNull()
    })
    it('CRITICAL: another nonce is refused', () => {
      expect(checkCallbackState(state, { ...good, nonce: 'm'.repeat(32) })).toBe('state')
      expect(checkCallbackState(state, { ...good, nonce: null })).toBe('state')
    })
    it('CRITICAL: another store is refused, even a real one', () => {
      expect(checkCallbackState(state, { ...good, shop: 'other-store.myshopify.com' })).toBe('shop')
      expect(checkCallbackState(state, { ...good, shop: 'evil.com' })).toBe('shop')
      expect(checkCallbackState(state, { ...good, shop: null })).toBe('shop')
    })
    it('CRITICAL: another signed-in manager (or nobody) is refused', () => {
      expect(checkCallbackState(state, { ...good, userId: 'user-2' })).toBe('auth')
      expect(checkCallbackState(state, { ...good, userId: null })).toBe('auth')
    })
  })
})

describe('the store address', () => {
  it('CRITICAL: only a bare {store}.myshopify.com host is a store', () => {
    for (const ok of ['skeen-store.myshopify.com', 'a.myshopify.com', 'store9.myshopify.com']) expect(isShopDomain(ok), ok).toBe(true)
    for (const bad of [
      'evil.com',
      'skeen-store.myshopify.com.evil.com',
      'evil.com/skeen-store.myshopify.com',
      'https://skeen-store.myshopify.com',
      'skeen-store.myshopify.com/',
      ' skeen-store.myshopify.com',
      '-store.myshopify.com',
      'Skeen-Store.myshopify.com',
      'skeen_store.myshopify.com',
      'myshopify.com',
      '',
      null,
      undefined,
      42,
    ])
      expect(isShopDomain(bad), String(bad)).toBe(false)
  })

  it('tidies what a manager pastes: case, scheme, path, the admin link', () => {
    expect(normalizeShopDomain('  Skeen-Store.MyShopify.com ')).toBe(SHOP)
    expect(normalizeShopDomain('https://skeen-store.myshopify.com/admin/products')).toBe(SHOP)
    expect(normalizeShopDomain('https://admin.shopify.com/store/skeen-store/products?x=1')).toBe(SHOP)
    // Tidying never turns something else INTO a store: the result is still checked.
    expect(isShopDomain(normalizeShopDomain('https://skeen.com'))).toBe(false)
    expect(isShopDomain(normalizeShopDomain('skeen-store.myshopify.com.evil.com'))).toBe(false)
  })

  it('the install link carries the artist and the store, encoded', () => {
    const path = shopifyInstallPath('a1', SHOP)
    const url = new URL(path, 'https://x.test')
    expect(url.pathname).toBe('/api/shopify/install')
    expect(url.searchParams.get('artist')).toBe('a1')
    expect(url.searchParams.get('shop')).toBe(SHOP)
  })
})

describe('the authorize link', () => {
  it('CRITICAL: goes to the store, asking for exactly the scopes, returning to our callback with the nonce', () => {
    const url = new URL(authorizeUrl({ shop: SHOP, apiKey: 'client-id', redirectUri: 'https://app.test/api/shopify/callback', nonce: 'nonce-1' }))
    expect(url.origin).toBe(`https://${SHOP}`)
    expect(url.pathname).toBe('/admin/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('scope')).toBe(SHOPIFY_SCOPES.join(','))
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/shopify/callback')
    expect(url.searchParams.get('state')).toBe('nonce-1')
    // Offline (per-store) access: an online token asks for grant_options[]=per-user.
    expect(url.searchParams.has('grant_options[]')).toBe(false)
  })

  it('CRITICAL: refuses to build a link to anything but a store', () => {
    expect(() => authorizeUrl({ shop: 'evil.com', apiKey: 'k', redirectUri: 'https://app.test/cb', nonce: 'n' })).toThrow()
  })

  it('asks for the one scope the merch code uses, and never a write or a customer scope', () => {
    expect([...SHOPIFY_SCOPES]).toEqual(['unauthenticated_read_product_listings'])
    expect(missingScopes(['unauthenticated_read_product_listings'])).toEqual([])
    expect(missingScopes(['unauthenticated_read_product_tags'])).toEqual(['unauthenticated_read_product_listings'])
    expect(missingScopes([])).toEqual(['unauthenticated_read_product_listings'])
  })
})

describe('the app credentials', () => {
  it('configured only when BOTH are set (blank counts as unset)', () => {
    expect(shopifyAppConfig({ SHOPIFY_API_KEY: 'k', SHOPIFY_API_SECRET: 's' })).toEqual({ apiKey: 'k', apiSecret: 's' })
    expect(shopifyAppConfig({ SHOPIFY_API_KEY: 'k', SHOPIFY_API_SECRET: '' })).toBeNull()
    expect(shopifyAppConfig({ SHOPIFY_API_KEY: '  ', SHOPIFY_API_SECRET: 's' })).toBeNull()
    expect(shopifyAppConfig({})).toBeNull()
  })
})

describe('the webhook signature', () => {
  const body = Buffer.from(JSON.stringify({ myshopify_domain: SHOP }))
  const sign = (b: Uint8Array, secret = SECRET) => createHmac('sha256', secret).update(b).digest('base64')

  it('CRITICAL: accepts the raw body Shopify signed', () => {
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true)
    expect(crypto.calls).toBeGreaterThan(0)
  })

  it('CRITICAL: refuses a changed body, another secret, no header, a wrong-length header', () => {
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true) // witness
    const changed = Buffer.from(JSON.stringify({ myshopify_domain: 'other-store.myshopify.com' }))
    expect(verifyWebhookHmac(changed, sign(body), SECRET)).toBe(false)
    expect(verifyWebhookHmac(body, sign(body, 'another-secret'), SECRET)).toBe(false)
    expect(verifyWebhookHmac(body, null, SECRET)).toBe(false)
    expect(verifyWebhookHmac(body, '', SECRET)).toBe(false)
    expect(() => verifyWebhookHmac(body, 'short', SECRET)).not.toThrow()
    expect(verifyWebhookHmac(body, 'short', SECRET)).toBe(false)
  })
})

describe('talking to Shopify (fetch mocked)', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('exchanges the code at the store, with the app credentials in the body, never following a redirect', async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: 'shpat_admin', scope: 'unauthenticated_read_product_listings' }))
    const got = await exchangeCode({ shop: SHOP, code: 'abc', apiKey: 'client-id', apiSecret: SECRET }, fetchImpl as unknown as typeof fetch)
    expect(got).toEqual({ accessToken: 'shpat_admin', scopes: ['unauthenticated_read_product_listings'] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://${SHOP}/admin/oauth/access_token`)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    const sent = new URLSearchParams(String(init.body))
    expect(sent.get('client_id')).toBe('client-id')
    expect(sent.get('client_secret')).toBe(SECRET)
    expect(sent.get('code')).toBe('abc')
  })

  it('a refused or empty exchange throws a message with no secret in it', async () => {
    for (const res of [json(400, { error: 'invalid_request' }), json(200, {}), new Response('<html>', { status: 200 })]) {
      const err = await exchangeCode({ shop: SHOP, code: 'abc', apiKey: 'client-id', apiSecret: SECRET }, (async () => res) as unknown as typeof fetch).catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect(String(err.message)).not.toContain(SECRET)
    }
  })

  it('makes a storefront token through the Admin API with the admin token, and returns it', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { data: { storefrontAccessTokenCreate: { storefrontAccessToken: { accessToken: 'sf_token' }, userErrors: [] } } }),
    )
    const token = await createStorefrontToken({ shop: SHOP, adminToken: 'shpat_admin' }, fetchImpl as unknown as typeof fetch)
    expect(token).toBe('sf_token')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(new RegExp(`^https://${SHOP.replace(/\./g, '\\.')}/admin/api/\\d{4}-\\d{2}/graphql\\.json$`))
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('shpat_admin')
    expect(String(init.body)).toContain('storefrontAccessTokenCreate')
  })

  it('a storefront-token refusal throws, with no token in the message', async () => {
    const refused = async () => json(200, { data: { storefrontAccessTokenCreate: { storefrontAccessToken: null, userErrors: [{ message: 'Access denied' }] } } })
    const err = await createStorefrontToken({ shop: SHOP, adminToken: 'shpat_admin' }, refused as unknown as typeof fetch).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err.message)).not.toContain('shpat_admin')
  })

  it('registers the uninstall webhook, and a failure is false, never a throw', async () => {
    const ok = vi.fn(async () => json(200, { data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'gid://1' }, userErrors: [] } } }))
    expect(await registerUninstallWebhook({ shop: SHOP, adminToken: 'shpat_admin', uri: 'https://app.test/api/shopify/webhooks' }, ok as unknown as typeof fetch)).toBe(true)
    const body = JSON.parse(String((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.variables).toEqual({ topic: 'APP_UNINSTALLED', webhookSubscription: { uri: 'https://app.test/api/shopify/webhooks', format: 'JSON' } })
    const boom = async () => {
      throw new Error('network')
    }
    expect(await registerUninstallWebhook({ shop: SHOP, adminToken: 'shpat_admin', uri: 'https://app.test/x' }, boom as unknown as typeof fetch)).toBe(false)
  })
})

describe('the way back to the page, and what it says there', () => {
  it('success and failure land on the artist’s Connections page with a code, never free text', () => {
    expect(returnPath(ARTIST, { ok: true })).toBe(`/artists/${ARTIST}/connections?shopify=connected`)
    expect(returnPath(ARTIST, { ok: false, reason: 'hmac' })).toBe(`/artists/${ARTIST}/connections?shopify=failed&reason=hmac`)
  })

  it('CRITICAL: every failure code has plain words (derived from the list, so a new code without words fails here)', () => {
    // The list is not empty — a loop over nothing proves nothing.
    expect(OAUTH_FAILURES).toEqual(expect.arrayContaining(['config', 'shop', 'state', 'hmac', 'denied', 'auth', 'exchange', 'scope', 'token', 'connect', 'sync']))
    for (const reason of OAUTH_FAILURES) {
      const notice = shopifyReturnNotice({ shopify: 'failed', reason })
      expect(notice?.kind, reason).toBe('error')
      expect(notice?.message.length, reason).toBeGreaterThan(10)
    }
  })

  it('a probe failure after connecting reads as the probe’s own title', () => {
    for (const reason of PROBE_FAILURES) {
      expect(shopifyReturnNotice({ shopify: 'failed', reason: `probe-${reason}` })?.message).toContain(probeAdvice(reason).title)
    }
  })

  it('success reads as success; no flag reads as nothing; a made-up reason still reads as a failure, not as its text', () => {
    expect(shopifyReturnNotice({ shopify: 'connected' })).toEqual({ kind: 'success', message: expect.stringMatching(/connected/i) })
    expect(shopifyReturnNotice({})).toBeNull()
    const odd = shopifyReturnNotice({ shopify: 'failed', reason: 'Call 555-0100 for help' })
    expect(odd?.kind).toBe('error')
    expect(odd?.message).not.toContain('555')
  })
})
