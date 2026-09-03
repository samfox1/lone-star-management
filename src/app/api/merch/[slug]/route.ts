import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createShopifyClient } from '@/lib/merch'
import { isPublicSlug, toLiveProducts, type LiveProduct } from '@/lib/merch/live'

/**
 * The live merch lane (MERCH_PLAN step 2): current price, availability and variants
 * for one artist's Shopify store, by public slug.
 *
 * A site renders its merch from the PUBLISHED snapshot — that is the editorial record
 * and it must not change because someone opened Shopify — and overlays this on top,
 * keyed by `shopify_product_id`. When this route is unreachable the page still renders
 * on published values, one publish behind, which is the correct degradation.
 *
 * Uses the service role only to REACH the token: authorization is the
 * `shopify_store_for_slug` door (slug-scoped, published-merch-only, service_role-only),
 * exactly as /api/audio leans on `audio_path_for_play`. The token is read server-side
 * and never appears in the response — the whole reason this lookup lives here rather
 * than on the artist's own site.
 */

/**
 * Shopify is rate-limited per store and this route is public, so an uncached one would
 * hand anyone a way to burn an artist's API budget. The cache is keyed by slug and
 * collapses every visitor into at most one upstream attempt per minute per store —
 * ATTEMPT, not success. See `CachedLive` for why that word carries the weight.
 *
 * `unstable_cache` rather than `use cache`: the latter needs `cacheComponents: true`,
 * which this app has not opted into. Swap when it does.
 */
const REVALIDATE_SECONDS = 60

/**
 * The cached value is a RESULT, never an exception.
 *
 * `unstable_cache` stores nothing when the function it wraps rejects, so a lane that
 * threw on a Shopify outage was cached only on the happy path: the moment a store's
 * Storefront cost bucket emptied, every visitor re-ran the service-role RPC plus up to
 * four Shopify POSTs (`maxRetries: 3`, 1s backoff). 1k req/min became ~4k upstream
 * calls/min and held the bucket empty — the route sustaining the outage it was
 * reporting (REVIEW_2026-09-03 H3).
 *
 * Returning a tagged failure instead means the FAILURE is cached too, on the same
 * one-per-minute-per-store budget as a success. The cost is bounded and stated: for up
 * to `REVALIDATE_SECONDS` after Shopify recovers, callers still get a 503 and render
 * their published fallback — the same staleness window the success path already
 * accepts, and a correct page one publish behind either way.
 */
type CachedLive =
  | { status: 'ok'; products: LiveProduct[] }
  | { status: 'none' }
  | { status: 'error' }

const liveMerchForSlug = unstable_cache(
  async (slug: string): Promise<CachedLive> => {
    try {
      const admin = createAdminClient()
      const { data, error } = await admin.rpc('shopify_store_for_slug', { p_slug: slug })
      if (error) throw new Error(error.message)
      const creds = (data ?? [])[0] as { store_domain: string; token: string } | undefined
      if (!creds) return { status: 'none' }

      const client = createShopifyClient({ domain: creds.store_domain, token: creds.token })
      return { status: 'ok', products: toLiveProducts(await client.getProducts()) }
    } catch {
      return { status: 'error' }
    }
  },
  ['merch-live'],
  { revalidate: REVALIDATE_SECONDS, tags: ['merch-live'] },
)

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // BEFORE the cache key and before the RPC. The slug is both, so an unvalidated one
  // is a guaranteed miss per distinct string: a service-role round trip and a data-cache
  // entry each, unbounded, from anyone with curl. Answered as 404 rather than 400 so a
  // malformed slug is indistinguishable from an artist without a live lane.
  if (!isPublicSlug(slug)) return Response.json({ error: 'not found' }, { status: 404 })

  const result = await liveMerchForSlug(slug)

  if (result.status === 'error') {
    // Shopify being down, throttled, or the token having been rotated away must not
    // take the artist's merch page with it. 503 tells the caller "use your published
    // fallback", which is a correct page one publish behind rather than a broken one.
    // `no-store` on purpose: the retry budget is the server-side cache above, and
    // letting a CDN pin the 503 would outlive the negative entry that recovers on its own.
    return Response.json(
      { error: 'live merch unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // 404 = this artist has no live lane (no store connected, or nothing published).
  // Distinct from 503 so a site can tell "never had one" from "temporarily broken".
  if (result.status === 'none') return Response.json({ error: 'not found' }, { status: 404 })

  return Response.json(
    { products: result.products },
    // Match the server cache so a CDN or browser cannot serve a price older than the
    // window we already accept, while still absorbing bursts.
    { headers: { 'Cache-Control': `public, max-age=0, s-maxage=${REVALIDATE_SECONDS}` } },
  )
}
