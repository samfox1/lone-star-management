import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SHOPIFY_KEY } from '@/lib/connections'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import {
  CALLBACK_PATH,
  STATE_COOKIE,
  WEBHOOK_PATH,
  checkCallbackState,
  createStorefrontToken,
  exchangeCode,
  missingScopes,
  readState,
  registerUninstallWebhook,
  returnPath,
  shopifyAppConfig,
  verifyCallbackHmac,
  type ReturnReason,
} from '@/lib/merch/shopify-oauth'

/**
 * CONNECT WITH SHOPIFY, step 2: Shopify sends the store owner back here with a one-time code.
 * See `src/lib/merch/shopify-oauth.ts` for the whole flow.
 *
 * EVERY CHECK BEFORE ANY CALL. The state cookie (signed: which artist, which manager, which
 * store, which nonce), Shopify's signature over the query, the nonce, the store, the
 * signed-in manager and their ownership of the artist are all checked before a single
 * request goes to Shopify or a single row is written. A refusal goes back to the artist's
 * Connections page with a CODE (never text); with no trustworthy cookie there is no artist to
 * go back to, so it goes to the dashboard.
 *
 * THE ADMIN TOKEN LIVES FOR THIS REQUEST ONLY. It makes one Storefront token and registers
 * the uninstall webhook, then it is dropped: nothing stores it, nothing logs it, and it never
 * leaves this function. The Storefront token is saved through the SAME path a typed token
 * takes (`connectOneAction` → `connect_shopify` into Vault, the probe, the first pull), so a
 * store connected either way is the same store.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const params = url.searchParams
  const config = shopifyAppConfig()
  const read = config ? readState(request.cookies.get(STATE_COOKIE)?.value, config.apiSecret) : null
  if (!config || !read || (!read.ok && read.reason !== 'expired')) return done(new URL('/', url))
  if (!read.ok) return back(url, read.artistId, 'state')
  const { state } = read

  // No code: the owner turned it down (Shopify may send `error=access_denied`). Nothing
  // will be exchanged, so there is nothing to verify first.
  const code = params.get('code')
  if (!code) return back(url, state.artistId, 'denied')
  if (!verifyCallbackHmac(params, config.apiSecret)) return back(url, state.artistId, 'hmac')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const shop = params.get('shop')
  const mismatch = checkCallbackState(state, { nonce: params.get('state'), shop, userId: user?.id ?? null })
  if (mismatch) return back(url, state.artistId, mismatch)
  if (!(await callerOwns(supabase, state.artistId))) return back(url, state.artistId, 'auth')

  let admin: { accessToken: string; scopes: string[] }
  try {
    admin = await exchangeCode({ shop: state.shop, code, apiKey: config.apiKey, apiSecret: config.apiSecret })
  } catch {
    return back(url, state.artistId, 'exchange')
  }
  if (missingScopes(admin.scopes).length) return back(url, state.artistId, 'scope')

  let storefrontToken: string
  try {
    storefrontToken = await createStorefrontToken({ shop: state.shop, adminToken: admin.accessToken })
  } catch {
    return back(url, state.artistId, 'token')
  }
  // Shopify only delivers webhooks to https, so on local dev there is nothing to register.
  if (url.protocol === 'https:') {
    await registerUninstallWebhook({ shop: state.shop, adminToken: admin.accessToken, uri: new URL(WEBHOOK_PATH, url).toString() })
  }

  const saved = await connectOneAction(state.artistId, SHOPIFY_KEY, { domain: state.shop, token: storefrontToken })
  if (!saved.ok) return back(url, state.artistId, saved.reason ?? 'connect')
  return done(new URL(returnPath(state.artistId, { ok: true }), url))
}

function back(url: URL, artistId: string, reason: ReturnReason) {
  return done(new URL(returnPath(artistId, { ok: false, reason }), url))
}

/** Every way out spends the state cookie: one trip, one use. */
function done(to: URL) {
  const res = NextResponse.redirect(to, { headers: { 'cache-control': 'no-store' } })
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: CALLBACK_PATH, maxAge: 0 })
  return res
}
