import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '@/app/artists/[id]/(dashboard)/_owns'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { syncEventbriteAction } from '@/app/artists/[id]/(dashboard)/tour/eventbrite-actions'
import { EventbriteApiError } from '@/lib/eventbrite'
import {
  STATE_COOKIE,
  CALLBACK_PATH,
  EventbriteOAuthError,
  allowedOrigin,
  checkCallbackState,
  eventbriteOAuthConfig,
  exchangeCode,
  findOrganizer,
  readState,
  returnPath,
  type OAuthFailure,
} from '@/lib/eventbrite-oauth'
import { EVENTBRITE_KEY } from '@/lib/manager-tools/connections/services/eventbrite'

/**
 * CONNECT WITH EVENTBRITE, step 2: Eventbrite sends the manager back here with a one-time
 * code, or with `error=access_denied` when they pressed Deny. See `src/lib/eventbrite-oauth.ts`.
 *
 * EVERY CHECK BEFORE ANY CALL. The origin, the state cookie (signed: which artist, which
 * manager, which nonce, which verifier, which organizer), the nonce Eventbrite hands back,
 * the signed-in manager and their ownership of the artist are all checked before a single
 * request goes to Eventbrite or a single row is written. A refusal goes back to the artist's
 * Connections page with a CODE (never text); with no trustworthy cookie there is no artist
 * to go back to, so it goes to the dashboard.
 *
 * THE TOKEN GOES TO VAULT AND NOWHERE ELSE. It finds the organizer page, then is handed to
 * `connect_eventbrite` (owner-gated, SECURITY DEFINER: the token is encrypted in Vault and
 * the integrations row holds only a pointer). It is never in a cookie, the link save, the
 * redirect or a log line; the later pull reads it back from Vault on the server. Nothing is
 * stored until the organizer page is found. The organizer link is saved through the SAME
 * door a pasted link takes (`connectOneAction`), then the shows are pulled. If that save
 * fails, the token is forgotten again, so "Nothing was saved" stays true.
 *
 * Failures are logged by step and a short code only, so one can be found without a token,
 * a code or the secret ever reaching a log.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const params = url.searchParams
  const config = eventbriteOAuthConfig()
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
    if (error !== 'access_denied') warn('authorize', error ? `Eventbrite returned an error (${sanitize(error)}).` : 'Eventbrite returned no code.')
    return back(url, state.artistId, error === 'access_denied' ? 'denied' : 'exchange')
  }
  if (!(await callerOwns(supabase, state.artistId))) return back(url, state.artistId, 'auth')

  let token: string
  try {
    token = await exchangeCode({ code, verifier: state.verifier, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: new URL(CALLBACK_PATH, url).toString() })
  } catch (e) {
    warn('exchange', e)
    return back(url, state.artistId, 'exchange')
  }

  // Which organizer page: the pasted link's, the only one, or the one named like the artist.
  const { data: artist } = await supabase.from('artists').select('name').eq('id', state.artistId).maybeSingle()
  let choice: Awaited<ReturnType<typeof findOrganizer>>
  try {
    choice = await findOrganizer(token, { hint: state.organizer, artistName: (artist?.name as string | undefined) ?? '' })
  } catch (e) {
    warn('organizer', e)
    return back(url, state.artistId, 'organizer')
  }
  if (!choice.ok) return back(url, state.artistId, choice.reason)
  const { organizer } = choice

  // Into Vault. The only place the token is ever written.
  const { error: vaultError } = await supabase.rpc('connect_eventbrite', {
    p_artist_id: state.artistId,
    p_organization_id: organizer.organizationId,
    p_organizer_id: organizer.id,
    p_token: token,
  })
  if (vaultError) {
    warn('vault', `The sign-in was not stored (${sanitize(vaultError.code ?? '')}).`)
    return back(url, state.artistId, 'connect')
  }

  // The organizer link, through the paste door: the same row a pasted link makes.
  try {
    const saved = await connectOneAction(state.artistId, EVENTBRITE_KEY, { url: organizer.url })
    if (!saved.ok) {
      await forget(supabase, state.artistId)
      warn('connect', 'The save door refused the organizer link.')
      return back(url, state.artistId, 'connect')
    }
  } catch (e) {
    await forget(supabase, state.artistId)
    warn('connect', e)
    return back(url, state.artistId, 'connect')
  }

  // The shows. A failed first pull keeps the connection: Pull now can try again.
  try {
    const pulled = await syncEventbriteAction(state.artistId)
    if (!pulled.ok) {
      warn('sync', 'The first pull of shows failed.')
      return back(url, state.artistId, 'sync')
    }
  } catch (e) {
    warn('sync', e)
    return back(url, state.artistId, 'sync')
  }
  return done(new URL(returnPath(state.artistId, { ok: true }), url))
}

/** Undo the Vault write when the connection could not be completed. Best effort: a failure
 *  here leaves a token the next Connect overwrites or Remove deletes. */
async function forget(supabase: Awaited<ReturnType<typeof createClient>>, artistId: string) {
  try {
    const { error } = await supabase.rpc('disconnect_eventbrite', { p_artist_id: artistId })
    if (error) warn('forget', `The stored sign-in could not be removed (${sanitize(error.code ?? '')}).`)
  } catch (e) {
    warn('forget', e)
  }
}

/** An error code as a log word: its own short code, or nothing. */
function sanitize(value: string): string {
  return /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : 'unrecognised'
}

/** One log line per failure: the step, and our own message (which never holds a secret) or
 *  just the error's NAME for anything else — a library message is not trusted to be clean. */
function warn(step: string, e: unknown) {
  const what =
    typeof e === 'string' ? e : e instanceof EventbriteOAuthError || e instanceof EventbriteApiError ? e.message : e instanceof Error ? e.name : 'unknown'
  console.warn(`[eventbrite connect] ${step}: ${what}`)
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
