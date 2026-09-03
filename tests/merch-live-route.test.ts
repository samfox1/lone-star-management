/**
 * `/api/merch/[slug]` — the live price lane's public door.
 *
 * The pure reduction it serves is pinned by merch-live.test.ts and the SQL door by
 * merch-live-door.test.ts. What NEITHER of them can see is the route's own two
 * decisions, both of which are load-bearing under load:
 *
 *  - a FAILURE has to be cached (REVIEW_2026-09-03 H3). `unstable_cache` stores
 *    nothing when the cached function rejects, so a throwing lane means every single
 *    visitor re-runs the service-role RPC plus up to four Shopify POSTs. The moment a
 *    store's Storefront cost bucket empties, 1k req/min becomes ~4k upstream calls/min
 *    and holds the bucket empty — the route turns a blip into an outage it is itself
 *    sustaining.
 *  - the slug is the CACHE KEY and an RPC argument (M1), so an unvalidated one is a
 *    guaranteed cache miss per distinct string: one service-role round trip each and
 *    an unbounded number of Next data-cache entries, from anyone with curl.
 *
 * The `unstable_cache` fake below is the premise of the whole file, and it is
 * deliberately faithful on the one behaviour that matters: it stores a RESOLVED value
 * for `revalidate` seconds and stores NOTHING when the function rejects. If the route
 * ever goes back to throwing, these tests go red for exactly that reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { slugify } from '@/lib/slug'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getProducts: vi.fn(),
  /** Test-controlled clock for the cache TTL. */
  now: 0,
  /** Every key the data cache was actually asked for — an invalid slug must reach none. */
  keys: [] as string[],
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: never[]) => Promise<unknown>,
    keyParts: string[],
    opts: { revalidate?: number },
  ) => {
    const store = new Map<string, { value: unknown; at: number }>()
    return async (...args: never[]) => {
      const key = JSON.stringify([keyParts, args])
      mocks.keys.push(key)
      const hit = store.get(key)
      if (hit && mocks.now - hit.at < (opts.revalidate ?? 0) * 1000) return hit.value
      // A rejection propagates and stores NOTHING. That is real `unstable_cache`
      // behaviour and the entire reason H3 exists.
      const value = await fn(...args)
      store.set(key, { value, at: mocks.now })
      return value
    }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

vi.mock('@/lib/merch', () => ({
  createShopifyClient: () => ({ getProducts: mocks.getProducts }),
}))

const CREDS = [{ store_domain: 'lone-pine.myshopify.com', token: 'tok' }]

function shopifyProduct(id: string, available: boolean) {
  return {
    shopify_product_id: id,
    handle: 'tee',
    title: 'Tee',
    description: null,
    image_url: null,
    images: [],
    price: '45.00',
    url: null,
    variants: [{ id: 'gid://v-m', title: 'm', available, price: '45.00', currency: 'USD' }],
    shippingEstimate: null,
    preorderNote: null,
    recordLabel: null,
    shippingDays: null,
  }
}

/** A fresh route module (and therefore a fresh data cache) per test. */
async function loadRoute() {
  vi.resetModules()
  const mod = await import('@/app/api/merch/[slug]/route')
  return (slug: string) =>
    mod.GET(new Request('http://x/'), { params: Promise.resolve({ slug }) })
}

beforeEach(() => {
  mocks.now = 0
  mocks.keys.length = 0
  mocks.rpc.mockReset()
  mocks.getProducts.mockReset()
  mocks.rpc.mockResolvedValue({ data: CREDS, error: null })
  mocks.getProducts.mockResolvedValue([shopifyProduct('gid://p1', true)])
})

describe('the happy path still holds', () => {
  it('serves the reduced live products and caches them', async () => {
    const get = await loadRoute()
    const first = await get('lone-pine')
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      products: [
        {
          shopify_product_id: 'gid://p1',
          price: '45.00',
          currency: 'USD',
          available: true,
          variants: [{ id: 'gid://v-m', title: 'm', available: true, price: '45.00', currency: 'USD' }],
        },
      ],
    })

    await get('lone-pine')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.getProducts).toHaveBeenCalledTimes(1)
  })

  it('404s an artist with no store connected, and does not call Shopify', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const get = await loadRoute()
    const res = await get('lone-pine')
    expect(res.status).toBe(404)
    expect(mocks.getProducts).not.toHaveBeenCalled()
  })
})

/**
 * H3. Every assertion here is about the SECOND request: the first one is allowed to
 * cost an upstream call, and the bug is that the second one costs another.
 */
describe('a Shopify outage is rate-limited, not amplified', () => {
  it('CRITICAL: a throttled store is called ONCE per window, not once per visitor', async () => {
    mocks.getProducts.mockRejectedValue(new Error('Shopify API rate-limited after 3 retries'))
    const get = await loadRoute()

    const results = [await get('lone-pine'), await get('lone-pine'), await get('lone-pine')]

    // Still a correct answer to every caller: 503 means "use your published fallback".
    expect(results.map((r) => r.status)).toEqual([503, 503, 503])
    // And the store was asked exactly once. Without a cached negative this is 3 — and
    // in production 3 × (1 RPC + up to 4 POSTs), which is what empties the bucket.
    expect(mocks.getProducts).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: an RPC failure is cached too, so the service-role door is not hammered', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db unavailable' } })
    const get = await loadRoute()

    expect((await get('lone-pine')).status).toBe(503)
    expect((await get('lone-pine')).status).toBe(503)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('tells a caller not to cache the 503 itself — the retry budget lives here', async () => {
    mocks.getProducts.mockRejectedValue(new Error('down'))
    const get = await loadRoute()
    expect((await get('lone-pine')).headers.get('Cache-Control')).toBe('no-store')
  })

  it('recovers on its own: the negative entry expires with the window', async () => {
    mocks.getProducts.mockRejectedValue(new Error('down'))
    const get = await loadRoute()
    expect((await get('lone-pine')).status).toBe(503)

    mocks.getProducts.mockResolvedValue([shopifyProduct('gid://p1', true)])
    // Inside the window the failure still stands — that is the rate limit doing its job.
    expect((await get('lone-pine')).status).toBe(503)

    mocks.now = 61_000
    expect((await get('lone-pine')).status).toBe(200)
    expect(mocks.getProducts).toHaveBeenCalledTimes(2)
  })

  it('does not let one store’s outage answer for another store', async () => {
    mocks.getProducts.mockRejectedValueOnce(new Error('down'))
    const get = await loadRoute()
    expect((await get('lone-pine')).status).toBe(503)
    expect((await get('other-band')).status).toBe(200)
  })
})

/**
 * M1. The slug is the cache key AND the RPC argument, so the guard has to run BEFORE
 * either. Asserting only the status code would still pass if a refactor validated
 * after the work was done, so every case pairs the response with "nothing upstream
 * was reached".
 */
describe('slug validation runs before the cache key and the RPC', () => {
  const BAD: [string, string][] = [
    ['empty', ''],
    ['uppercase', 'Lone-Pine'],
    ['underscore', 'lone_pine'],
    ['space', 'lone pine'],
    ['path traversal', '../../etc/passwd'],
    ['slash', 'lone/pine'],
    ['percent-encoded', 'lone%2Fpine'],
    ['sql-ish', "lone'; drop table artists;--"],
    ['leading hyphen', '-lone-pine'],
    ['trailing hyphen', 'lone-pine-'],
    ['double hyphen', 'lone--pine'],
    ['unicode', 'lone-pineé'],
    ['trailing space', 'lone-pine '],
    ['null byte', 'lone-pine\0'],
    ['newline', 'lone-pine\n'],
    ['over 60 chars', 'a'.repeat(61)],
  ]

  it.each(BAD)('rejects a %s slug without an RPC or a cache entry', async (_name, slug) => {
    const get = await loadRoute()
    const res = await get(slug)
    expect(res.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.getProducts).not.toHaveBeenCalled()
    // The unbounded-cache half of the finding: a rejected slug must never become a key.
    expect(mocks.keys).toEqual([])
  })

  /**
   * Derived from the PRODUCER, not hand-listed (AGENTS.md rule 4): whatever shape
   * `slugify` can emit is a shape a real artist slug can have, so a guard that
   * rejects one of these locks a real artist out of the live lane. Hand-listing the
   * accepted set is exactly how a future slug rule would slip past this file.
   */
  const NAMES = [
    'Lone Pine',
    'The 45s',
    "Sam's Band",
    'Ø Ø Ø',
    'Æther/Wolves',
    'a',
    '2026',
    'A Very Long Artist Name That Runs Well Past The Sixty Character Cap Somehow',
  ]

  it.each(NAMES.map((n) => [n, slugify(n)] as const).filter(([, s]) => s.length > 0))(
    'accepts %s → %s, the slug the app itself would mint',
    async (_name, slug) => {
      const get = await loadRoute()
      const res = await get(slug)
      expect(res.status).toBe(200)
      expect(mocks.rpc).toHaveBeenCalledWith('shopify_store_for_slug', { p_slug: slug })
    },
  )
})
