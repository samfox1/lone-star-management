/**
 * shopifyClient — reads a store's products via the Storefront GraphQL API. A
 * per-store storefront access token authenticates (passed in from the Vault-
 * backed integration, never hardcoded). Owns the request, cursor pagination,
 * 429 throttle retry, and error shaping, and maps products to the merch input
 * the sync consumes.
 *
 * A factory with injectable fetch/sleep for deterministic tests.
 */

const API_VERSION = '2024-01'

/** The shape the merch sync consumes (one Shopify product). */
export type ShopifyMerch = {
  shopify_product_id: string
  title: string
  image_url: string | null
  price: string | null
  url: string | null
}

type ProductNode = {
  id: string
  title: string
  onlineStoreUrl?: string | null
  featuredImage?: { url?: string } | null
  priceRange?: { minVariantPrice?: { amount?: string } } | null
}

type ProductsResponse = {
  data?: { products?: { edges: { node: ProductNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
  errors?: { message: string }[]
}

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      edges { node { id title onlineStoreUrl featuredImage { url } priceRange { minVariantPrice { amount } } } }
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
        const retryAfter = Number(res.headers.get('retry-after') ?? '1')
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`Shopify API error ${res.status} for ${domain}`)
      const body = (await res.json()) as ProductsResponse
      if (body.errors?.length) {
        throw new Error(`Shopify GraphQL error: ${body.errors[0].message}`)
      }
      return body
    }
    throw new Error(`Shopify API rate-limited after ${maxRetries} retries: ${domain}`)
  }

  function mapNode(node: ProductNode): ShopifyMerch {
    return {
      shopify_product_id: node.id,
      title: node.title,
      image_url: node.featuredImage?.url ?? null,
      price: node.priceRange?.minVariantPrice?.amount ?? null,
      url: node.onlineStoreUrl ?? null,
    }
  }

  /** Every product in the store, following Storefront pagination cursors. */
  async function getProducts(): Promise<ShopifyMerch[]> {
    const out: ShopifyMerch[] = []
    let cursor: string | null = null
    // hasNextPage guards the loop; the cap is a safety net against a bad cursor.
    for (let guard = 0; guard < 1000; guard++) {
      const body: ProductsResponse = await graphql(cursor)
      const products = body.data?.products
      if (!products) break
      for (const edge of products.edges) out.push(mapNode(edge.node))
      if (!products.pageInfo.hasNextPage) break
      cursor = products.pageInfo.endCursor
    }
    return out
  }

  return { getProducts }
}

export type ShopifyClient = ReturnType<typeof createShopifyClient>
