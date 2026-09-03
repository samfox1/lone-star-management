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
/**
 * The Shopify METAFIELDS this reads, and the only place their names are written down.
 *
 * Shopify has no column for "when does this pre-order actually ship" or "what must a
 * buyer acknowledge before ordering one", so both are custom fields the artist's team
 * fills in. Two consequences worth knowing at onboarding time:
 *  - a metafield must be PUBLISHED to the Storefront API (its definition has a
 *    visibility setting) or it simply is not in the response, with no error;
 *  - `preorder_note` doubles as the flag. A note means the product is a pre-order and
 *    the note is the sentence shown beside the tick box. No note, no pre-order — one
 *    field instead of a boolean that can disagree with its own text.
 */
export const METAFIELDS = {
  namespace: 'custom',
  shippingEstimate: 'shipping_estimate',
  preorderNote: 'preorder_note',
  recordLabel: 'record_label',
  shippingDays: 'shipping_days',
} as const

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
  /** When a pre-order actually ships, in the team's own words ("october 2026"). */
  shippingEstimate: string | null
  /** Non-null means PRE-ORDER: the sentence a buyer must tick before they can order. */
  preorderNote: string | null
  /** The record label behind the product ("r&r digital"). */
  recordLabel: string | null
  /** Days from order to shipping. The SITE turns this into a date on every render, so
   *  it never goes stale the way a typed-in month does. Null when not set, or when the
   *  team typed something that is not a sane number of days. */
  shippingDays: number | null
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
  /** Shopify pads this array to line up with the identifiers asked for, so a missing
   *  field is a null HOLE rather than a shorter list — read it by `key`, never by
   *  position, or one unset field silently shifts the other's value into it. */
  metafields?: ({ key?: string | null; value?: string | null } | null)[] | null
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
 * headroom against Shopify's own costing, which is only approximated here. `metafields`
 * is the COUNT of identifiers asked for, and must match the list in the query below.
 *
 * Paging 10 at a time is more round trips than 50, but a merch catalogue is tens of
 * products and this is a background pull. Truncation is the worse failure: a product
 * with more than `variants` options would silently lose sizes, so that number stays
 * generous and `products` absorbs the cost. `tests/shopify.test.ts` fails if the
 * arithmetic ever crosses the cap.
 */
export const PAGE_SIZES = { products: 10, variants: 50, images: 10, metafields: 4 } as const

/**
 * PNG, not Shopify's default.
 *
 * Merch renders cut-out on the site's near-black ground (Sam, 2026-09-03), which only
 * works if the image has an alpha channel. Shopify serves WEBP or JPG by default and a
 * JPG has no alpha at all, so a product shot would arrive with a white box baked around
 * it — on black, that is the whole design gone. `preferredContentType: PNG` preserves
 * the transparency the artist uploaded.
 *
 * It cannot CREATE transparency: if the artist's team uploads a flat JPG, the PNG that
 * comes back is that flat JPG in a PNG wrapper, white box and all. Cut-out PNGs are
 * therefore an onboarding rule for the store, not something this query can enforce —
 * see MERCH_PLAN.
 */
const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: ${PAGE_SIZES.products}, after: $cursor) {
      edges { node {
        id
        handle
        title
        description
        onlineStoreUrl
        featuredImage { url(transform: {preferredContentType: PNG}) }
        images(first: ${PAGE_SIZES.images}) { edges { node { url(transform: {preferredContentType: PNG}) } } }
        priceRange { minVariantPrice { amount } }
        variants(first: ${PAGE_SIZES.variants}) {
          edges { node { id title availableForSale price { amount currencyCode } } }
        }
        metafields(identifiers: [
          {namespace: "${METAFIELDS.namespace}", key: "${METAFIELDS.shippingEstimate}"},
          {namespace: "${METAFIELDS.namespace}", key: "${METAFIELDS.preorderNote}"},
          {namespace: "${METAFIELDS.namespace}", key: "${METAFIELDS.recordLabel}"},
          {namespace: "${METAFIELDS.namespace}", key: "${METAFIELDS.shippingDays}"}
        ]) { key value }
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

  /** One metafield's value by KEY, or null. Blank counts as absent: an empty custom
   *  field is a field the team has not filled in, not a product that ships on "". */
  function metafield(node: ProductNode, key: string): string | null {
    const hit = (node.metafields ?? []).find((m) => m?.key === key)
    const value = (hit?.value ?? '').trim()
    return value || null
  }

  /**
   * A metafield read as a whole number of days, or null.
   *
   * A metafield is free text even when its definition says integer, so "60 days", "" and
   * "soon" all reach here. Anything that is not a plain positive integer inside the
   * DB's own bounds is dropped rather than coerced: a bad value that becomes 0 would
   * render "ships today" on a product that ships in two months.
   */
  function metafieldDays(node: ProductNode, key: string): number | null {
    const raw = metafield(node, key)
    if (raw === null || !/^\d+$/.test(raw)) return null
    const n = Number(raw)
    return n > 0 && n <= 3650 ? n : null
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
      shippingEstimate: metafield(node, METAFIELDS.shippingEstimate),
      preorderNote: metafield(node, METAFIELDS.preorderNote),
      recordLabel: metafield(node, METAFIELDS.recordLabel),
      shippingDays: metafieldDays(node, METAFIELDS.shippingDays),
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
