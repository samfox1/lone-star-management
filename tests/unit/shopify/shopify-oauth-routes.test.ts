// The Shopify app's three routes: install sends an owner to Shopify, the callback saves a
//   store only when every check passes, and the uninstall webhook disconnects that store.
/**
 * /api/shopify/install, /api/shopify/callback, /api/shopify/webhooks (Sam, 2026-09-28).
 * The pure rules are pinned in shopify-oauth.test.ts; what only the routes can get wrong is
 * the ORDER and the consequences:
 *
 *   - install: only a signed-in manager of THIS artist is sent to Shopify, with a signed,
 *     HttpOnly state cookie scoped to the callback;
 *   - callback: a bad state, a bad signature, another store, another manager or a
 *     non-owner saves NOTHING and calls Shopify for NOTHING. Every refusal first runs the
 *     untouched trip and sees it save (the planted witness), so a refusal can never pass
 *     because the save path was broken all along;
 *   - the happy path saves through the SAME connect path the typed token uses
 *     (`connectOneAction`), with the STOREFRONT token — the Admin token goes nowhere;
 *   - the uninstall webhook deletes only the matching store's connection, and only for a
 *     body Shopify signed.
 *
 * Supabase and the connect action are faked; Shopify is a stubbed global fetch.
 */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STATE_COOKIE, STATE_TTL_MS, createState, readState } from '@/lib/merch/shopify-oauth'

const SECRET = 'shpss_route_secret'
const ORIGIN = 'https://app.test'
const SHOP = 'skeen-store.myshopify.com'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const USER = 'user-1'

const w = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  owns: true,
  deletes: [] as { table: string; filters: [string, unknown][] }[],
  deleteResult: { data: [{ artist_id: '11111111-1111-4111-8111-111111111111' }], error: null } as { data: unknown; error: unknown },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: w.user } }) },
    from: (table: string) => ({
      select: () => ({ eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: table === 'artists' && w.owns ? { id } : null }) }) }),
    }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call = { table, filters: [] as [string, unknown][] }
      const chain = {
        delete: () => chain,
        eq: (col: string, val: unknown) => {
          call.filters.push([col, val])
          return chain
        },
        select: async () => {
          w.deletes.push(call)
          return w.deleteResult
        },
      }
      return chain
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: 'Merch pulled: 3 added, 0 updated' })),
}))

import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { GET as install } from '@/app/api/shopify/install/route'
import { GET as callback } from '@/app/api/shopify/callback/route'
import { POST as webhook } from '@/app/api/shopify/webhooks/route'

// ── Shopify, stubbed ────────────────────────────────────────────────────────────────────

type Shopify = { exchange: () => Response; storefront: () => Response; webhook: () => Response }
let shopify: Shopify
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url === `https://${SHOP}/admin/oauth/access_token`) return shopify.exchange()
  if (/\/admin\/api\/[\d-]+\/graphql\.json$/.test(url)) {
    return String(init?.body).includes('storefrontAccessTokenCreate') ? shopify.storefront() : shopify.webhook()
  }
  return new Response('not found', { status: 404 })
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const HAPPY: Shopify = {
  exchange: () => json({ access_token: 'shpat_admin_secret', scope: 'unauthenticated_read_product_listings' }),
  storefront: () => json({ data: { storefrontAccessTokenCreate: { storefrontAccessToken: { accessToken: 'sf_token' }, userErrors: [] } } }),
  webhook: () => json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' }, userErrors: [] } } }),
}

const ENV = { key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET }
beforeEach(() => {
  process.env.SHOPIFY_API_KEY = 'client-id'
  process.env.SHOPIFY_API_SECRET = SECRET
  w.user = { id: USER }
  w.owns = true
  w.deletes = []
  w.deleteResult = { data: [{ artist_id: ARTIST }], error: null }
  shopify = { ...HAPPY }
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env.SHOPIFY_API_KEY = ENV.key
  process.env.SHOPIFY_API_SECRET = ENV.secret
})

const location = (res: Response) => res.headers.get('location') ?? ''
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''

// ── install ─────────────────────────────────────────────────────────────────────────────

function installReq(query: Record<string, string>) {
  return new NextRequest(`${ORIGIN}/api/shopify/install?${new URLSearchParams(query)}`)
}

/** The witness for install refusals: the same request, as an owner, goes to Shopify. */
async function installGoesToShopify(query = { artist: ARTIST, shop: SHOP }) {
  const res = await install(installReq(query))
  expect(new URL(location(res)).origin).toBe(`https://${SHOP}`)
  return res
}

describe('install', () => {
  it('CRITICAL: an owner is sent to the store’s approve screen, with a signed state cookie for the callback only', async () => {
    const res = await install(installReq({ artist: ARTIST, shop: SHOP }))
    expect([302, 303, 307]).toContain(res.status)
    const to = new URL(location(res))
    expect(to.origin).toBe(`https://${SHOP}`)
    expect(to.pathname).toBe('/admin/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('client-id')
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/shopify/callback`)
    // The secret is never in the link.
    expect(location(res)).not.toContain(SECRET)

    const cookie = setCookie(res)
    expect(cookie).toMatch(new RegExp(`^${STATE_COOKIE}=`))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/Path=\/api\/shopify\/callback/i)
    expect(cookie).toMatch(new RegExp(`Max-Age=${STATE_TTL_MS / 1000}`))
    // The cookie remembers this artist, this manager, this store — and the nonce Shopify got.
    const value = res.cookies.get(STATE_COOKIE)!.value
    const read = readState(value, SECRET)
    expect(read).toMatchObject({ ok: true, state: { artistId: ARTIST, userId: USER, shop: SHOP, nonce: to.searchParams.get('state') } })
  })

  it('a pasted admin link is tidied into the store address', async () => {
    await installGoesToShopify({ artist: ARTIST, shop: 'https://admin.shopify.com/store/skeen-store/products' })
  })

  it('CRITICAL: nobody signed in goes to /login, not to Shopify', async () => {
    await installGoesToShopify()
    w.user = null
    const res = await install(installReq({ artist: ARTIST, shop: SHOP }))
    expect(new URL(location(res)).pathname).toBe('/login')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: a manager of another artist gets a 404 and no cookie', async () => {
    await installGoesToShopify()
    w.owns = false
    const res = await install(installReq({ artist: ARTIST, shop: SHOP }))
    expect(res.status).toBe(404)
    expect(location(res)).toBe('')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: an address that is not a store goes back with a reason, never to that host', async () => {
    await installGoesToShopify()
    const res = await install(installReq({ artist: ARTIST, shop: 'evil.com' }))
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=failed&reason=shop`)
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('without the app credentials, it goes back and says so', async () => {
    await installGoesToShopify()
    process.env.SHOPIFY_API_SECRET = ''
    const res = await install(installReq({ artist: ARTIST, shop: SHOP }))
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=failed&reason=config`)
  })

  it('a launch from Shopify’s admin (no artist) lands on the dashboard', async () => {
    const res = await install(installReq({ shop: SHOP, hmac: 'x', timestamp: '1' }))
    expect(location(res)).toBe(`${ORIGIN}/`)
  })

  it('an artist id that is not an id is a 404', async () => {
    const res = await install(installReq({ artist: '../../admin', shop: SHOP }))
    expect(res.status).toBe(404)
  })
})

// ── callback ────────────────────────────────────────────────────────────────────────────

/** Shopify's signature, from the spec. */
function signed(params: Record<string, string>, secret = SECRET) {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return new URLSearchParams({ ...params, hmac: createHmac('sha256', secret).update(message).digest('hex') })
}

type Trip = { artistId?: string; userId?: string; shop?: string; now?: number }
function trip(t: Trip = {}) {
  return createState({ artistId: t.artistId ?? ARTIST, userId: t.userId ?? USER, shop: t.shop ?? SHOP }, SECRET, t.now)
}
function callbackReq(query: URLSearchParams, cookie: string | null, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/shopify/callback?${query}`, { headers: cookie ? { cookie: `${STATE_COOKIE}=${cookie}` } : {} })
}
function returnFor(t: { nonce: string }, over: Record<string, string> = {}) {
  return signed({ code: 'one-time-code', host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvc2tlZW4tc3RvcmU', shop: SHOP, state: t.nonce, timestamp: '1727500000', ...over })
}

/** The planted witness: the untouched trip saves exactly once. Then everything is reset. */
async function witnessSaves() {
  const t = trip()
  const res = await callback(callbackReq(returnFor(t), t.cookie))
  expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=connected`)
  expect(connectOneAction).toHaveBeenCalledTimes(1)
  vi.mocked(connectOneAction).mockClear()
  fetchMock.mockClear()
}

function expectNothingHappened() {
  expect(connectOneAction).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
}

describe('callback — the happy path', () => {
  it('CRITICAL: saves the STOREFRONT token through the typed-token connect path, and goes back saying so', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))

    expect(connectOneAction).toHaveBeenCalledTimes(1)
    expect(connectOneAction).toHaveBeenCalledWith(ARTIST, 'shopify', { domain: SHOP, token: 'sf_token' })
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=connected`)

    // The code was traded at THIS store, with the app credentials.
    const [exUrl, exInit] = fetchMock.mock.calls[0]
    expect(String(exUrl)).toBe(`https://${SHOP}/admin/oauth/access_token`)
    expect(new URLSearchParams(String(exInit?.body)).get('code')).toBe('one-time-code')
    // The Admin token made the storefront token, and went nowhere else.
    const adminCalls = fetchMock.mock.calls.slice(1)
    expect(adminCalls.length).toBeGreaterThan(0)
    for (const [, init] of adminCalls) expect((init?.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('shpat_admin_secret')
    expect(JSON.stringify(vi.mocked(connectOneAction).mock.calls)).not.toContain('shpat_admin_secret')
    expect(location(res)).not.toContain('shpat_admin_secret')
    expect(location(res)).not.toContain('sf_token')
    expect(setCookie(res)).not.toContain('shpat_admin_secret')
  })

  it('CRITICAL: the state cookie is spent — cleared on the way out', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(setCookie(res)).toMatch(new RegExp(`${STATE_COOKIE}=;`))
    expect(setCookie(res)).toMatch(/Max-Age=0/)
  })

  it('registers the uninstall webhook at this origin; a failure there does not undo the connection', async () => {
    const t = trip()
    await callback(callbackReq(returnFor(t), t.cookie))
    const hook = fetchMock.mock.calls.find(([, init]) => String(init?.body).includes('webhookSubscriptionCreate'))
    expect(JSON.parse(String(hook![1]!.body)).variables.webhookSubscription.uri).toBe(`${ORIGIN}/api/shopify/webhooks`)

    shopify.webhook = () => json({ errors: 'nope' }, 500)
    const t2 = trip()
    const res = await callback(callbackReq(returnFor(t2), t2.cookie))
    expect(location(res)).toContain('shopify=connected')
  })

  it('on http (local dev) no webhook is registered — Shopify only calls https', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie, 'http://localhost:3000'))
    expect(location(res)).toBe(`http://localhost:3000/artists/${ARTIST}/connections?shopify=connected`)
    expect(fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('webhookSubscriptionCreate'))).toBe(false)
  })
})

describe('callback — refusals save nothing and ask Shopify for nothing', () => {
  it('CRITICAL: a changed signature (hmac)', async () => {
    await witnessSaves()
    const t = trip()
    const q = returnFor(t)
    q.set('code', 'another-code') // signed for one code, carrying another
    const res = await callback(callbackReq(q, t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=failed&reason=hmac`)
  })

  it('CRITICAL: a signature made with another app’s secret', async () => {
    await witnessSaves()
    const t = trip()
    const res = await callback(callbackReq(signed({ code: 'c', shop: SHOP, state: t.nonce, timestamp: '1' }, 'another-secret'), t.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=hmac')
  })

  it('CRITICAL: another trip’s nonce (state)', async () => {
    await witnessSaves()
    const mine = trip()
    const theirs = trip()
    const res = await callback(callbackReq(returnFor(theirs), mine.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=state')
  })

  it('CRITICAL: a genuine, signed return from ANOTHER store', async () => {
    await witnessSaves()
    const t = trip() // started for skeen-store
    const res = await callback(callbackReq(returnFor(t, { shop: 'other-store.myshopify.com' }), t.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=shop')
  })

  it('CRITICAL: a late return (state expired)', async () => {
    await witnessSaves()
    const t = trip({ now: Date.now() - STATE_TTL_MS - 1000 })
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=failed&reason=state`)
  })

  it('CRITICAL: finished in another manager’s session', async () => {
    await witnessSaves()
    const t = trip()
    w.user = { id: 'user-2' }
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=auth')
  })

  it('CRITICAL: a manager who no longer manages the artist', async () => {
    await witnessSaves()
    const t = trip()
    w.owns = false
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=auth')
  })

  it('CRITICAL: no state cookie, or one edited to another artist — back to the dashboard, not to any artist', async () => {
    await witnessSaves()
    const t = trip()
    const none = await callback(callbackReq(returnFor(t), null))
    expect(location(none)).toBe(`${ORIGIN}/`)
    const [body, sig] = t.cookie.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), a: '22222222-2222-4222-8222-222222222222' })).toString('base64url')
    const edited = await callback(callbackReq(returnFor(t), `${forged}.${sig}`))
    expect(location(edited)).toBe(`${ORIGIN}/`)
    expectNothingHappened()
  })

  it('no code (the owner said no)', async () => {
    await witnessSaves()
    const t = trip()
    const q = returnFor(t)
    q.delete('code')
    const res = await callback(callbackReq(q, t.cookie))
    expectNothingHappened()
    expect(location(res)).toContain('reason=denied')
  })
})

describe('callback — Shopify says no partway', () => {
  it('the code is refused → exchange; nothing saved', async () => {
    shopify.exchange = () => json({ error: 'invalid_request' }, 400)
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('reason=exchange')
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: less access than asked → scope; no storefront token is made, nothing saved', async () => {
    shopify.exchange = () => json({ access_token: 'shpat_admin_secret', scope: 'unauthenticated_read_product_tags' })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('reason=scope')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('no storefront token → token; nothing saved', async () => {
    shopify.storefront = () => json({ data: { storefrontAccessTokenCreate: { storefrontAccessToken: null, userErrors: [{ message: 'Access denied' }] } } })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('reason=token')
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('the save path refused → its own code comes back (a probe failure, say)', async () => {
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'The store is there, but the token was refused', reason: 'probe-bad-token' })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?shopify=failed&reason=probe-bad-token`)
  })

  it('a save refused without a code reads as connect', async () => {
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('reason=connect')
  })
})

// ── webhooks ────────────────────────────────────────────────────────────────────────────

function hookReq(topic: string, payload: unknown, secret = SECRET, sig?: string) {
  const body = Buffer.from(JSON.stringify(payload))
  return new Request(`${ORIGIN}/api/shopify/webhooks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-topic': topic,
      'x-shopify-shop-domain': SHOP,
      'x-shopify-hmac-sha256': sig ?? createHmac('sha256', secret).update(body).digest('base64'),
    },
    body,
  })
}
const UNINSTALLED = { id: 1, name: 'Skeen', domain: 'shop.skeen.com', myshopify_domain: SHOP }

describe('webhooks', () => {
  it('CRITICAL: app/uninstalled disconnects exactly that store', async () => {
    const res = await webhook(hookReq('app/uninstalled', UNINSTALLED))
    expect(res.status).toBe(200)
    expect(w.deletes).toEqual([{ table: 'integrations', filters: [['provider', 'shopify'], ['metadata->>store_domain', SHOP]] }])
  })

  it('CRITICAL: a body not signed with our secret is a 401 and deletes nothing', async () => {
    await webhook(hookReq('app/uninstalled', UNINSTALLED))
    expect(w.deletes).toHaveLength(1) // witness
    w.deletes = []
    const forged = await webhook(hookReq('app/uninstalled', UNINSTALLED, 'another-secret'))
    expect(forged.status).toBe(401)
    const unsigned = await webhook(hookReq('app/uninstalled', UNINSTALLED, SECRET, ''))
    expect(unsigned.status).toBe(401)
    expect(w.deletes).toEqual([])
  })

  it('CRITICAL: a signed privacy body relabelled as app/uninstalled deletes nothing', async () => {
    // customers/redact carries `shop_domain`, never `myshopify_domain`: the topic header is
    // NOT signed, so the store is read only from the field an uninstall body has.
    const res = await webhook(hookReq('app/uninstalled', { shop_id: 1, shop_domain: SHOP, customer: { id: 2 } }))
    expect(res.status).toBe(200)
    expect(w.deletes).toEqual([])
  })

  it('the three privacy webhooks are acknowledged and change nothing', async () => {
    for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
      const res = await webhook(hookReq(topic, { shop_id: 1, shop_domain: SHOP }))
      expect(res.status, topic).toBe(200)
    }
    expect(w.deletes).toEqual([])
    const forged = await webhook(hookReq('shop/redact', { shop_id: 1, shop_domain: SHOP }, 'another-secret'))
    expect(forged.status).toBe(401)
  })

  it('without the app secret nothing can be verified: 401', async () => {
    process.env.SHOPIFY_API_SECRET = ''
    const res = await webhook(hookReq('app/uninstalled', UNINSTALLED))
    expect(res.status).toBe(401)
    expect(w.deletes).toEqual([])
  })

  it('a database failure is a 500, so Shopify tries again', async () => {
    expect((await webhook(hookReq('app/uninstalled', UNINSTALLED))).status).toBe(200) // witness
    w.deleteResult = { data: null, error: { message: 'down' } }
    const res = await webhook(hookReq('app/uninstalled', UNINSTALLED))
    expect(res.status).toBe(500)
  })
})
