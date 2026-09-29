import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { CALLBACK_PATH, STATE_COOKIE, STATE_TTL_MS, allowedOrigin, authorizeUrl, createState, googleOAuthConfig, returnPath } from '@/lib/youtube-oauth'

/**
 * CONNECT WITH YOUTUBE, step 1: `?artist=<id>` (and `&sync=0` when Sync is off) from the
 * Connect window. See `src/lib/youtube-oauth.ts` for the whole flow.
 *
 * Only a signed-in manager of THIS artist is sent on (`callerOwns`, RLS-scoped, the check
 * every dashboard route makes); anyone else gets a 404 that does not say whether the artist
 * exists. /api is not behind the proxy's login gate, so the session is checked here.
 *
 * The callback address is built from THIS request's origin (the Shopify install route's
 * rule): the state cookie belongs to the origin that set it, so the trip has to come back to
 * the same one, and Google's own list of redirect URIs is what pins it to known origins. A
 * new address (production) only needs registering there. Only https or http://localhost.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const artistId = url.searchParams.get('artist')
  if (!artistId || !UUID_RE.test(artistId)) return notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return redirect(new URL('/login', url))
  if (!(await callerOwns(supabase, artistId))) return notFound()

  const config = googleOAuthConfig()
  if (!config || !allowedOrigin(url)) return redirect(new URL(returnPath(artistId, { ok: false, reason: 'config' }), url))

  const sync = url.searchParams.get('sync') !== '0'
  const { nonce, challenge, cookie } = createState({ artistId, userId: user.id, sync }, config.clientSecret)
  const res = redirect(authorizeUrl({ clientId: config.clientId, redirectUri: new URL(CALLBACK_PATH, url).toString(), nonce, challenge }))
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    // Lax, not Strict: Google → callback is a cross-site top-level GET, which Lax allows.
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
