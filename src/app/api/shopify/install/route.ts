import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { isShopDomain, normalizeShopDomain } from '@/lib/merch/shop-domain'
import { CALLBACK_PATH, STATE_COOKIE, STATE_TTL_MS, authorizeUrl, createState, returnPath, shopifyAppConfig } from '@/lib/merch/shopify-oauth'

/**
 * CONNECT WITH SHOPIFY, step 1: `?artist=<id>&shop=<store>` from the Connections page.
 * See `src/lib/merch/shopify-oauth.ts` for the whole flow.
 *
 * Only a signed-in manager of THIS artist is sent on (`callerOwns`, RLS-scoped, the check
 * every dashboard route makes); anyone else gets a 404 that does not say whether the artist
 * exists. /api is not behind the proxy's login gate, so the session is checked here.
 *
 * The callback address is built from THIS request's origin rather than NEXT_PUBLIC_APP_URL:
 * the state cookie belongs to the origin that set it, so the trip has to come back to the
 * same one. Shopify's own allow-list of redirect URLs is what pins it to known origins.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const artistId = url.searchParams.get('artist')
  // Opened from Shopify's admin (the app's App URL): a store, no artist. Connecting is done
  // from the artist's Connections page, so the dashboard is where this goes.
  if (!artistId) return redirect(new URL('/', url))
  if (!UUID_RE.test(artistId)) return notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return redirect(new URL('/login', url))
  if (!(await callerOwns(supabase, artistId))) return notFound()

  const config = shopifyAppConfig()
  if (!config) return redirect(new URL(returnPath(artistId, { ok: false, reason: 'config' }), url))
  const shop = normalizeShopDomain(url.searchParams.get('shop') ?? '')
  if (!isShopDomain(shop)) return redirect(new URL(returnPath(artistId, { ok: false, reason: 'shop' }), url))

  const { nonce, cookie } = createState({ artistId, userId: user.id, shop }, config.apiSecret)
  const res = redirect(authorizeUrl({ shop, apiKey: config.apiKey, redirectUri: new URL(CALLBACK_PATH, url).toString(), nonce }))
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    // Lax, not Strict: Shopify → callback is a cross-site top-level GET, which Lax allows.
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: CALLBACK_PATH,
    maxAge: STATE_TTL_MS / 1000,
  })
  return res
}

function redirect(to: URL | string) {
  return NextResponse.redirect(to, { headers: NO_STORE })
}

function notFound() {
  return new NextResponse('Not found', { status: 404, headers: NO_STORE })
}
