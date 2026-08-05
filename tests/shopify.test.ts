/**
 * MILESTONE 8 — shopifyClient (Storefront GraphQL), test-first. Mocked at the
 * fetch boundary. Covers: product mapping, cursor pagination, GraphQL + HTTP
 * error shaping, throttle (429) retry, and the missing-config guard.
 */
import { describe, expect, it, vi } from 'vitest'
import { createShopifyClient } from '@/lib/shopify'

function res({ status = 200, headers = {}, body }: { status?: number; headers?: Record<string, string>; body: unknown }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

type EdgeNode = {
  id: string
  title: string
  onlineStoreUrl: string | null
  featuredImage: { url: string } | null
  priceRange: { minVariantPrice: { amount: string } } | null
}

function productEdge(id: string, title: string, cursor: string, over: Partial<EdgeNode> = {}) {
  return {
    cursor,
    node: {
      id,
      title,
      onlineStoreUrl: `https://shop.example/${id}`,
      featuredImage: { url: `https://img.example/${id}.jpg` },
      priceRange: { minVariantPrice: { amount: '25.00' } },
      ...over,
    } as EdgeNode,
  }
}

function page(edges: ReturnType<typeof productEdge>[], hasNextPage: boolean, endCursor: string | null) {
  return res({ body: { data: { products: { edges, pageInfo: { hasNextPage, endCursor } } } } })
}

function client(fetchImpl: typeof fetch, opts: { domain?: string; token?: string } = {}) {
  return createShopifyClient({
    domain: opts.domain ?? 'store.myshopify.com',
    token: opts.token ?? 'tok',
    fetchImpl,
    sleep: () => Promise.resolve(),
  })
}

describe('getProducts', () => {
  it('maps products and follows the cursor across pages', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const cursor = JSON.parse(String(init?.body ?? '{}')).variables?.cursor ?? null
      if (cursor === null) {
        return page([productEdge('gid://p1', 'Tee', 'c1')], true, 'c1') as unknown as Response
      }
      return page([productEdge('gid://p2', 'Hoodie', 'c2')], false, null) as unknown as Response
    })

    const products = await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(products).toHaveLength(2)
    expect(products[0]).toEqual({
      shopify_product_id: 'gid://p1',
      title: 'Tee',
      image_url: 'https://img.example/gid://p1.jpg',
      price: '25.00',
      url: 'https://shop.example/gid://p1',
    })
    expect(products[1].title).toBe('Hoodie')
  })

  it('sends the storefront token header and posts to the store domain', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      page([], false, null) as unknown as Response,
    )
    await client(fetchImpl as unknown as typeof fetch, { domain: 'lonepine.myshopify.com', token: 'secret-tok' }).getProducts()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('lonepine.myshopify.com')
    expect((init?.headers as Record<string, string>)['X-Shopify-Storefront-Access-Token']).toBe('secret-tok')
  })

  it('throws a shaped error on GraphQL errors', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { errors: [{ message: 'bad query' }] } }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getProducts()).rejects.toThrow(/shopify/i)
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 401, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getProducts()).rejects.toThrow(/shopify/i)
  })

  it('retries after a 429 then succeeds', async () => {
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      hits++
      if (hits === 1) return res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response
      return page([], false, null) as unknown as Response
    })
    await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(hits).toBe(2)
  })

  it('maps a null featuredImage / onlineStoreUrl to null (Shopify sends both routinely)', async () => {
    const bare = productEdge('gid://p9', 'Draft Tee', 'c1', {
      onlineStoreUrl: null, // unpublished from the online store
      featuredImage: null, // no image uploaded
      priceRange: null,
    })
    const fetchImpl = vi.fn(async () => page([bare], false, null) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(out[0]).toEqual({
      shopify_product_id: 'gid://p9',
      title: 'Draft Tee',
      image_url: null,
      price: null,
      url: null,
    })
  })
})

/**
 * Storefront throttling is NOT an HTTP 429 — it answers 200 with
 * errors[].extensions.code === 'THROTTLED'. Treating that as a hard GraphQL error
 * failed the whole merch sync the first time a store hit its cost bucket, and made
 * the 429 branch these tests used to exercise unreachable in production.
 */
describe('throttling', () => {
  const throttled = () =>
    res({
      body: {
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: { cost: { requestedQueryCost: 52, throttleStatus: { currentlyAvailable: 0 } } },
      },
    })

  it('retries an in-body THROTTLED error (HTTP 200) then succeeds', async () => {
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      hits++
      if (hits === 1) return throttled() as unknown as Response
      return page([productEdge('gid://p1', 'Tee', 'c1')], false, null) as unknown as Response
    })
    const out = await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(hits).toBe(2)
    expect(out).toHaveLength(1) // the catalog survives a throttle, not dropped
  })

  it('still throws on a non-throttle GraphQL error instead of retrying', async () => {
    const fetchImpl = vi.fn(async () =>
      res({ body: { errors: [{ message: 'bad query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] } }) as unknown as Response,
    )
    await expect(client(fetchImpl as unknown as typeof fetch).getProducts()).rejects.toThrow(/bad query/)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // a bad query is not retryable
  })

  it('honours a numeric Retry-After on a 429', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      hits++
      if (hits === 1) return res({ status: 429, headers: { 'retry-after': '2' }, body: {} }) as unknown as Response
      return page([], false, null) as unknown as Response
    })
    await createShopifyClient({
      domain: 'store.myshopify.com',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    }).getProducts()
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('CRITICAL: a date-form Retry-After falls back to 1s, never sleep(NaN)', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      hits++
      if (hits === 1)
        return res({
          status: 429,
          headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
          body: {},
        }) as unknown as Response
      return page([], false, null) as unknown as Response
    })
    await createShopifyClient({
      domain: 'store.myshopify.com',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    }).getProducts()
    expect(sleep).toHaveBeenCalledWith(1000) // sleep(NaN) would hot-loop the retries
  })

  it('gives up after maxRetries and says so (429 never clears)', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 429, headers: { 'retry-after': '0' }, body: {} }) as unknown as Response)
    const c = createShopifyClient({
      domain: 'store.myshopify.com',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getProducts()).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // attempt + 2 retries, then stop
  })

  it('gives up after maxRetries when THROTTLED never clears', async () => {
    const fetchImpl = vi.fn(async () => throttled() as unknown as Response)
    const c = createShopifyClient({
      domain: 'store.myshopify.com',
      token: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      maxRetries: 2,
    })
    await expect(c.getProducts()).rejects.toThrow(/rate-limited after 2 retries/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('throws when domain or token is missing', async () => {
    const fetchImpl = vi.fn(async () => page([], false, null) as unknown as Response)
    const c = createShopifyClient({ domain: '', token: '', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(c.getProducts()).rejects.toThrow(/not configured/i)
  })
})

describe('store domain validation', () => {
  const BAD = [
    'evil.com',
    'evil.com/x#',
    'user@evil.com',
    'store.myshopify.com/path',
    'store.myshopify.com:1337',
    'store.myshopify.com ',
    ' store.myshopify.com',
    'store.myshopify.com.evil.com',
    'STORE.myshopify.com',
    '-bad.myshopify.com',
  ]

  it.each(BAD)('throws and never calls fetch for %s', async (domain) => {
    const fetchImpl = vi.fn()
    const c = createShopifyClient({ domain, token: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(c.getProducts()).rejects.toThrow(/invalid shopify store domain/i)
    expect(fetchImpl).not.toHaveBeenCalled() // token never left the process
  })

  it('accepts a valid *.myshopify.com host', async () => {
    const fetchImpl = vi.fn(async () => page([productEdge('p1', 'Tee', 'c1')], false, null) as unknown as Response)
    const c = createShopifyClient({ domain: 'lone-star.myshopify.com', token: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(c.getProducts()).resolves.toHaveLength(1)
  })
})

describe('pagination termination', () => {
  it('breaks when hasNextPage is true but endCursor is null (no dup spin)', async () => {
    const fetchImpl = vi.fn(async () => page([productEdge('p1', 'Tee', 'c1')], true, null) as unknown as Response)
    const products = await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(products).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // did not re-fetch page 1
  })

  // hasNextPage:true with an endCursor that never advances is the shape that spins:
  // without the equality break the loop re-fetches page 1 forever, accumulating the
  // same products until the process dies. Bounded here so the failure is a wrong
  // count, not a hung suite.
  it('breaks when endCursor repeats (hasNextPage lies) instead of looping', async () => {
    let hits = 0
    const fetchImpl = vi.fn(async () => {
      if (++hits > 20) throw new Error('pagination did not terminate')
      return page([productEdge('p1', 'Tee', 'c1')], true, 'SAME') as unknown as Response
    })
    const products = await client(fetchImpl as unknown as typeof fetch).getProducts()
    expect(fetchImpl).toHaveBeenCalledTimes(2) // page 1, then the repeat that stops it
    expect(products.map((p) => p.shopify_product_id)).toEqual(['p1', 'p1'])
  })
})
