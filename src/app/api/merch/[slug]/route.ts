import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createShopifyClient } from '@/lib/merch'
import { toLiveProducts, type LiveProduct } from '@/lib/merch/live'

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
 * collapses every visitor into at most one upstream call per minute per store.
 *
 * `unstable_cache` rather than `use cache`: the latter needs `cacheComponents: true`,
 * which this app has not opted into. Swap when it does.
 */
const REVALIDATE_SECONDS = 60

const liveMerchForSlug = unstable_cache(
  async (slug: string): Promise<LiveProduct[] | null> => {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('shopify_store_for_slug', { p_slug: slug })
    if (error) throw new Error(error.message)
    const creds = (data ?? [])[0] as { store_domain: string; token: string } | undefined
    if (!creds) return null

    const client = createShopifyClient({ domain: creds.store_domain, token: creds.token })
    return toLiveProducts(await client.getProducts())
  },
  ['merch-live'],
  { revalidate: REVALIDATE_SECONDS, tags: ['merch-live'] },
)

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let products: LiveProduct[] | null
  try {
    products = await liveMerchForSlug(slug)
  } catch {
    // Shopify being down, throttled, or the token having been rotated away must not
    // take the artist's merch page with it. 503 tells the caller "use your published
    // fallback", which is a correct page one publish behind rather than a broken one.
    return Response.json(
      { error: 'live merch unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // 404 = this artist has no live lane (no store connected, or nothing published).
  // Distinct from 503 so a site can tell "never had one" from "temporarily broken".
  if (!products) return Response.json({ error: 'not found' }, { status: 404 })

  return Response.json(
    { products },
    // Match the server cache so a CDN or browser cannot serve a price older than the
    // window we already accept, while still absorbing bursts.
    { headers: { 'Cache-Control': `public, max-age=0, s-maxage=${REVALIDATE_SECONDS}` } },
  )
}
