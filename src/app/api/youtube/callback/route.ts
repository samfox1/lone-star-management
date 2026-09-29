import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import {
  CALLBACK_PATH,
  STATE_COOKIE,
  YouTubeOAuthError,
  allowedOrigin,
  channelConnectInput,
  checkCallbackState,
  exchangeCode,
  googleOAuthConfig,
  grantedYouTube,
  readMyChannel,
  readState,
  returnPath,
  revokeToken,
  type MyChannel,
  type OAuthFailure,
} from '@/lib/youtube-oauth'

/**
 * CONNECT WITH YOUTUBE, step 2: Google sends the manager back here with a one-time code, or
 * with `error=access_denied` when they pressed Cancel. See `src/lib/youtube-oauth.ts`.
 *
 * EVERY CHECK BEFORE ANY CALL. The origin, the state cookie (signed: which artist, which
 * manager, which nonce, which PKCE verifier), the nonce Google hands back, the signed-in
 * manager and their ownership of the artist are all checked before a single request goes to
 * Google or a single row is written. A refusal goes back to the artist's Connections page
 * with a CODE (never text); with no trustworthy cookie there is no artist to go back to, so
 * it goes to the dashboard.
 *
 * THE ACCESS TOKEN LIVES FOR THIS REQUEST ONLY. It reads the channel once, then it is
 * revoked: nothing stores it, nothing logs it, it never leaves this function. The channel is
 * saved through the SAME door a pasted link takes (`connectOneAction` → the profile link row
 * + `youtube_channel_id` + the first import), so a channel connected either way is the same.
 *
 * Failures are logged server-side by step and Google's short error code only, so one can be
 * found without a token, a code or the secret ever reaching a log.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const params = url.searchParams
  const config = googleOAuthConfig()
  if (!config || !allowedOrigin(url)) return done(new URL('/', url))
  const read = readState(request.cookies.get(STATE_COOKIE)?.value, config.clientSecret)
  if (!read.ok && read.reason !== 'expired') return done(new URL('/', url))
  if (!read.ok) return back(url, read.artistId, 'state')
  const { state } = read

  // The trip first: "cancelled" is only ever said about THIS manager's own trip.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const mismatch = checkCallbackState(state, { nonce: params.get('state'), userId: user?.id ?? null })
  if (mismatch) return back(url, state.artistId, mismatch)

  const error = params.get('error')
  const code = params.get('code')
  if (error || !code) {
    if (error !== 'access_denied') warn('authorize', error ? `Google returned an error (${sanitize(error)}).` : 'Google returned no code.')
    return back(url, state.artistId, error === 'access_denied' ? 'denied' : 'exchange')
  }
  if (!(await callerOwns(supabase, state.artistId))) return back(url, state.artistId, 'auth')

  const redirectUri = new URL(CALLBACK_PATH, url).toString()
  let token: { accessToken: string; scopes: string[] }
  try {
    token = await exchangeCode({ code, verifier: state.verifier, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri })
  } catch (e) {
    warn('exchange', e)
    return back(url, state.artistId, 'exchange')
  }

  // One read, then the token is revoked — whatever the read said.
  let channel: MyChannel | null
  try {
    if (!grantedYouTube(token.scopes)) return back(url, state.artistId, 'scope')
    channel = await readMyChannel(token.accessToken)
  } catch (e) {
    warn('channel', e)
    return back(url, state.artistId, 'channel')
  } finally {
    await revokeToken(token.accessToken)
  }
  if (!channel) return back(url, state.artistId, 'none')

  try {
    const saved = await connectOneAction(state.artistId, 'youtube', channelConnectInput(channel, state.sync))
    if (!saved.ok) {
      const reason = saved.reason === 'sync' ? 'sync' : 'connect'
      warn(reason, 'The save door refused the channel.')
      return back(url, state.artistId, reason)
    }
  } catch (e) {
    warn('connect', e)
    return back(url, state.artistId, 'connect')
  }
  return done(new URL(returnPath(state.artistId, { ok: true }), url))
}

/** Google's `error` value as a log word: its own snake_case code, or nothing. */
function sanitize(value: string): string {
  return /^[a-z_]{1,64}$/.test(value) ? value : 'unrecognised'
}

/** One log line per failure: the step, and our own message (which never holds a secret) or
 *  just the error's NAME for anything else — a library message is not trusted to be clean. */
function warn(step: string, e: unknown) {
  const what = typeof e === 'string' ? e : e instanceof YouTubeOAuthError ? e.message : e instanceof Error ? e.name : 'unknown'
  console.warn(`[youtube connect] ${step}: ${what}`)
}

function back(url: URL, artistId: string, reason: OAuthFailure) {
  return done(new URL(returnPath(artistId, { ok: false, reason }), url))
}

/** Every way out spends the state cookie: one trip, one use. */
function done(to: URL) {
  const res = NextResponse.redirect(to, { headers: { 'cache-control': 'no-store' } })
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: CALLBACK_PATH, maxAge: 0 })
  return res
}
