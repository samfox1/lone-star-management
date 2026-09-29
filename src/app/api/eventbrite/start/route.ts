import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { CALLBACK_PATH, STATE_COOKIE, STATE_TTL_MS, allowedOrigin, authorizeUrl, createState, eventbriteOAuthConfig, returnPath } from '@/lib/eventbrite-oauth'

/**
 * CONNECT WITH EVENTBRITE, step 1: `?artist=<id>` (and `&organizer=<id>` when the manager
 * pasted an organizer link first) from the Connect window. See `src/lib/eventbrite-oauth.ts`.
 *
 * Only a signed-in manager of THIS artist is sent on (`callerOwns`, RLS-scoped); anyone
 * else gets a 404 that does not say whether the artist exists. /api is not behind the
 * proxy's login gate, so the session is checked here.
 *
 * The callback address is built from THIS request's origin (the YouTube and Shopify rule):
 * the state cookie belongs to the origin that set it, and Eventbrite's own registered
 * redirect URI is what pins the trip to a known origin. Only https or http://localhost.
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

  const config = eventbriteOAuthConfig()
  if (!config || !allowedOrigin(url)) return redirect(new URL(returnPath(artistId, { ok: false, reason: 'config' }), url))

  // A hint that is not digits is dropped inside createState: only an id can ride along.
  const organizer = url.searchParams.get('organizer')
  const { nonce, challenge, cookie } = createState({ artistId, userId: user.id, organizer }, config.clientSecret)
  const res = redirect(authorizeUrl({ clientId: config.clientId, redirectUri: new URL(CALLBACK_PATH, url).toString(), nonce, challenge }))
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    // Lax, not Strict: Eventbrite → callback is a cross-site top-level GET, which Lax allows.
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
