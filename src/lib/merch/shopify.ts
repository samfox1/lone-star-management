/**
 * shopifyClient — reads a store's products via the Storefront GraphQL API. A
 * per-store storefront access token authenticates (passed in from the Vault-
 * backed integration, never hardcoded). Owns the request, cursor pagination,
 * throttle retry (HTTP 429 AND Storefront's in-body THROTTLED, which arrives with
 * HTTP 200), and error shaping, and maps products to the merch input the sync
 * consumes.
 *
 * A factory with injectable fetch/sleep for deterministic tests.
 */

const API_VERSION = '2024-01'

// A storefront's Storefront API host is always {shop}.myshopify.com — custom
// primary domains front only the online store, never the GraphQL endpoint.
// Validating here keeps a bad manager-supplied domain from redirecting the
// request (and its storefront token) to an attacker host. connect_shopify
// validates authoritatively in SQL; this is defense in depth.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

function assertShopDomain(domain: string): void {
  if (domain !== domain.trim() || !SHOP_DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid Shopify store domain: ${JSON.stringify(domain)}`)
  }
}

/** One purchasable option of a product (a size, a colour). */
export type ShopifyVariant = {
  /** A ProductVariant gid. A cart line is created from THIS, never from the product
   *  id, so the whole buy flow depends on it. */
  id: string
  title: string
  available: boolean
  price: string | null
  currency: string | null
}

/** The shape the merch sync consumes (one Shopify product). */
export type ShopifyMerch = {
  shopify_product_id: string
  /** Shopify's URL slug. The per-product route is /merch/[handle] because
   *  shopify_product_id is a gid://shopify/Product/… and is not URL-shaped. */
  handle: string | null
  title: string
  description: string | null
  image_url: string | null
  /** Gallery for the product page; image_url stays the grid's single card image. */
  images: string[]
  price: string | null
  url: string | null
  variants: ShopifyVariant[]
}

type VariantNode = {
  id: string
  title: string
  availableForSale?: boolean | null
  price?: { amount?: string; currencyCode?: string } | null
}

type ProductNode = {
  id: string
  handle?: string | null
  title: string
  description?: string | null
  onlineStoreUrl?: string | null
  featuredImage?: { url?: string } | null
  images?: { edges: { node: { url?: string } }[] } | null
  priceRange?: { minVariantPrice?: { amount?: string } } | null
  variants?: { edges: { node: VariantNode }[] } | null
}

type ProductsResponse = {
  data?: { products?: { edges: { node: ProductNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
  errors?: { message: string; extensions?: { code?: string } }[]
}

/**
 * The Storefront API does NOT throttle with HTTP 429: it answers 200 with
 * errors[].extensions.code === 'THROTTLED' (the cost bucket is empty). Any store
 * big enough to page would otherwise fail its whole merch sync on the first
 * throttle, because every `errors[]` entry reads as a hard query error.
 */
function isThrottled(body: ProductsResponse): boolean {
  return body.errors?.some((e) => e.extensions?.code === 'THROTTLED') ?? false
}

/** Cost-bucket refill wait for an in-body throttle: a 200 carries no Retry-After. */
const THROTTLE_BACKOFF_MS = 1000

/**
 * Retry-After is allowed to be an HTTP-date, not seconds. Number() then gives NaN
 * and sleep(NaN) returns immediately, turning the backoff into a hot retry loop
 * that burns every attempt in milliseconds. Same guard as lib/http.ts, replicated
 * because Shopify is a GraphQL POST and keeps its own request path.
 */
function retryAfterMs(header: string | null): number {
  const parsed = Number(header ?? '1')
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 1) * 1000
}

/**
 * Connection sizes, exported because they are a BUDGET, not a preference.
 *
 * Storefront rejects any query costing over 1000 points outright
 * (MAX_COST_EXCEEDED), and nested connections multiply: this query costs roughly
 * products × (1 + variants + images). The original 50 products, once variants were
 * added at Shopify's 100-per-product ceiling, would have been ~5000 — every sync
 * failing on its first call, for every store. 10 × (1 + 50 + 10) = 610 leaves real
 * headroom against Shopify's own costing, which is only approximated here.
 *
 * Paging 10 at a time is more round trips than 50, but a merch catalogue is tens of
 * products and this is a background pull. Truncation is the worse failure: a product
 * with more than `variants` options would silently lose sizes, so that number stays
 * generous and `products` absorbs the cost. `tests/shopify.test.ts` fails if the
 * arithmetic ever crosses the cap.
 */
export const PAGE_SIZES = { products: 10, variants: 50, images: 10 } as const

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: ${PAGE_SIZES.products}, after: $cursor) {
      edges { node {
        id
        handle
        title
        description
        onlineStoreUrl
        featuredImage { url }
        images(first: ${PAGE_SIZES.images}) { edges { node { url } } }
        priceRange { minVariantPrice { amount } }
        variants(first: ${PAGE_SIZES.variants}) {
          edges { node { id title availableForSale price { amount currencyCode } } }
        }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`

type Options = {
  domain?: string
  token?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

export function createShopifyClient(opts: Options = {}) {
  const domain = opts.domain
  const token = opts.token
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3

  async function graphql(cursor: string | null): Promise<ProductsResponse> {
    if (!domain || !token) {
      throw new Error('Shopify store not configured (missing domain or token).')
    }
    assertShopDomain(domain)
    const url = `https://${domain}/api/${API_VERSION}/graphql.json`
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': token,
        },
        body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
      })
      if (res.status === 429) {
        await sleep(retryAfterMs(res.headers.get('retry-after')))
        continue
      }
      if (!res.ok) throw new Error(`Shopify API error ${res.status} for ${domain}`)
      const body = (await res.json()) as ProductsResponse
      if (isThrottled(body)) {
        await sleep(THROTTLE_BACKOFF_MS)
        continue
      }
      if (body.errors?.length) {
        throw new Error(`Shopify GraphQL error: ${body.errors[0].message}`)
      }
      return body
    }
    throw new Error(`Shopify API rate-limited after ${maxRetries} retries: ${domain}`)
  }

  /**
   * A sold-out variant is KEPT, never filtered: the picker greys "xl" out, which tells
   * a buyer the size exists and is gone. Dropping it would render as "we never made
   * that size", and would also let a product with every variant sold out arrive as an
   * empty picker with nothing to explain it.
   *
   * `availableForSale` is read with `=== true` rather than a truthy check so a missing
   * field reads as unavailable. Wrongly showing sold-out is a lost sale; wrongly
   * showing buyable is an order Shopify then refuses at checkout.
   */
  function mapVariant(node: VariantNode): ShopifyVariant {
    return {
      id: node.id,
      title: node.title,
      available: node.availableForSale === true,
      price: node.price?.amount ?? null,
      currency: node.price?.currencyCode ?? null,
    }
  }

  function mapNode(node: ProductNode): ShopifyMerch {
    return {
      shopify_product_id: node.id,
      handle: node.handle ?? null,
      title: node.title,
      description: node.description ?? null,
      image_url: node.featuredImage?.url ?? null,
      images: (node.images?.edges ?? []).map((e) => e.node.url).filter((u): u is string => Boolean(u)),
      price: node.priceRange?.minVariantPrice?.amount ?? null,
      url: node.onlineStoreUrl ?? null,
      variants: (node.variants?.edges ?? []).map((e) => mapVariant(e.node)),
    }
  }

  /** Every product in the store, following Storefront pagination cursors. */
  async function getProducts(): Promise<ShopifyMerch[]> {
    const out: ShopifyMerch[] = []
    let cursor: string | null = null
    // hasNextPage drives the loop; break if the cursor can't advance (null or
    // unchanged) so a misbehaving hasNextPage:true response can't spin and
    // accumulate duplicates. The equality break guarantees termination.
    while (true) {
      const body: ProductsResponse = await graphql(cursor)
      const products = body.data?.products
      if (!products) break
      for (const edge of products.edges) out.push(mapNode(edge.node))
      if (!products.pageInfo.hasNextPage) break
      const next = products.pageInfo.endCursor
      if (next === null || next === cursor) break
      cursor = next
    }
    return out
  }

  return { getProducts }
}

export type ShopifyClient = ReturnType<typeof createShopifyClient>
