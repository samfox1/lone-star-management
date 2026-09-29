// Connect with YouTube, the two routes: start sends a manager to Google, the callback saves
//   the channel only when every check passes, through the same door a pasted link uses.
/**
 * /api/youtube/start and /api/youtube/callback (Sam, 2026-09-28). The pure rules are pinned
 * in youtube-oauth.test.ts; what only the routes can get wrong is the ORDER and the
 * consequences:
 *
 *   - start: only a signed-in manager of THIS artist is sent to Google, with a signed,
 *     HttpOnly state cookie scoped to the callback; only https or http://localhost;
 *   - callback: a bad state, another manager, a non-owner, or "cancel" at Google saves
 *     NOTHING and asks Google for NOTHING. Every refusal first runs the untouched trip and
 *     sees it save (the planted witness), so a refusal can never pass because the save path
 *     was broken all along;
 *   - the happy path saves through `connectOneAction(artist, 'youtube', …)` — the paste
 *     path — with the channel Google named;
 *   - the access token is used for ONE read, then revoked: it is never in a cookie, the
 *     save, the redirect, or a log line.
 *
 * Supabase and the connect action are faked; Google is a stubbed global fetch.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STATE_COOKIE, STATE_TTL_MS, createState, readState } from '@/lib/youtube-oauth'

const CLIENT_ID = 'client-id.apps.googleusercontent.com'
const SECRET = 'GOCSPX-route-secret'
const ORIGIN = 'https://app.test'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const USER = 'user-1'
const CHANNEL = 'UC' + 'b'.repeat(22)
const TOKEN = 'ya29.route-access-token'
const CODE = '4/0-one-time-code'

const w = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  owns: true,
  tables: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: w.user } }) },
    from: (table: string) => {
      w.tables.push(table)
      return { select: () => ({ eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: table === 'artists' && w.owns ? { id } : null }) }) }) }
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: '12 videos imported' })),
}))

import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { GET as start } from '@/app/api/youtube/start/route'
import { GET as callback } from '@/app/api/youtube/callback/route'

// ── Google, stubbed ─────────────────────────────────────────────────────────────────────

type Google = { token: () => Response; channels: () => Response; revoke: () => Response }
let google: Google
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url === 'https://oauth2.googleapis.com/token') return google.token()
  if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) return google.channels()
  if (url === 'https://oauth2.googleapis.com/revoke') return google.revoke()
  return new Response('not found', { status: 404 })
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const HAPPY: Google = {
  token: () => json({ access_token: TOKEN, expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.readonly', token_type: 'Bearer' }),
  channels: () => json({ items: [{ id: CHANNEL, snippet: { title: 'Skeen', customUrl: '@skeenmusic' } }] }),
  revoke: () => new Response('', { status: 200 }),
}
const calledTo = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(url))

/** Every console line the routes wrote, as one string: a token must never be in it. */
let logs: ReturnType<typeof vi.spyOn>[] = []
const logged = () => JSON.stringify(logs.flatMap((s) => s.mock.calls))

const ENV = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }
beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = SECRET
  w.user = { id: USER }
  w.owns = true
  w.tables = []
  google = { ...HAPPY }
  vi.stubGlobal('fetch', fetchMock)
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env.GOOGLE_OAUTH_CLIENT_ID = ENV.id
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = ENV.secret
})

const location = (res: Response) => res.headers.get('location') ?? ''
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''
const back = (reason: string, origin = ORIGIN) => `${origin}/artists/${ARTIST}/connections?youtube=failed&reason=${reason}`

// ── start ───────────────────────────────────────────────────────────────────────────────

function startReq(query: Record<string, string>, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/youtube/start?${new URLSearchParams(query)}`)
}

/** The witness for start refusals: the same request, as an owner, goes to Google. */
async function startGoesToGoogle(query: Record<string, string> = { artist: ARTIST }) {
  const res = await start(startReq(query))
  expect(new URL(location(res)).origin).toBe('https://accounts.google.com')
  return res
}

describe('start', () => {
  it('CRITICAL: an owner is sent to Google’s sign-in, with a signed state cookie for the callback only', async () => {
    const res = await start(startReq({ artist: ARTIST }))
    expect([302, 303, 307]).toContain(res.status)
    const to = new URL(location(res))
    expect(`${to.origin}${to.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(to.searchParams.get('client_id')).toBe(CLIENT_ID)
    // Built from THIS request's origin, so a production address only needs registering.
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/youtube/callback`)
    expect(to.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly')
    expect(to.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location(res)).not.toContain(SECRET)

    const cookie = setCookie(res)
    expect(cookie).toMatch(new RegExp(`^${STATE_COOKIE}=`))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/Path=\/api\/youtube\/callback/i)
    expect(cookie).toMatch(new RegExp(`Max-Age=${STATE_TTL_MS / 1000}`))
    const read = readState(res.cookies.get(STATE_COOKIE)!.value, SECRET)
    expect(read).toMatchObject({ ok: true, state: { artistId: ARTIST, userId: USER, sync: true, nonce: to.searchParams.get('state') } })
    if (!read.ok) throw new Error('unreachable')
    // The challenge Google got is S256 of the verifier the cookie keeps.
    expect(to.searchParams.get('code_challenge')).toBe(createHash('sha256').update(read.state.verifier).digest('base64url'))
  })

  it('Sync off travels in the signed state', async () => {
    const res = await start(startReq({ artist: ARTIST, sync: '0' }))
    expect(readState(res.cookies.get(STATE_COOKIE)!.value, SECRET)).toMatchObject({ ok: true, state: { sync: false } })
  })

  it('http://localhost is allowed (dev), and its cookie is not Secure', async () => {
    const res = await start(startReq({ artist: ARTIST }, 'http://localhost:3000'))
    expect(new URL(location(res)).searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/youtube/callback')
    expect(setCookie(res)).not.toMatch(/Secure/i)
  })

  it('CRITICAL: any other http origin is never sent to Google', async () => {
    await startGoesToGoogle()
    const res = await start(startReq({ artist: ARTIST }, 'http://app.test'))
    expect(location(res)).not.toContain('accounts.google.com')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: nobody signed in goes to /login, not to Google', async () => {
    await startGoesToGoogle()
    w.user = null
    const res = await start(startReq({ artist: ARTIST }))
    expect(new URL(location(res)).pathname).toBe('/login')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: a manager of another artist gets a 404 and no cookie', async () => {
    await startGoesToGoogle()
    w.owns = false
    const res = await start(startReq({ artist: ARTIST }))
    expect(res.status).toBe(404)
    expect(location(res)).toBe('')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('an artist id that is not an id is a 404', async () => {
    await startGoesToGoogle()
    expect((await start(startReq({ artist: '../../admin' }))).status).toBe(404)
    expect((await start(startReq({}))).status).toBe(404)
  })

  it('without the two credentials, it goes back and says so', async () => {
    await startGoesToGoogle()
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
    const res = await start(startReq({ artist: ARTIST }))
    expect(location(res)).toBe(back('config'))
  })
})

// ── callback ────────────────────────────────────────────────────────────────────────────

type Trip = { userId?: string; sync?: boolean; now?: number }
function trip(t: Trip = {}) {
  return createState({ artistId: ARTIST, userId: t.userId ?? USER, sync: t.sync ?? true }, SECRET, t.now)
}
function callbackReq(query: Record<string, string>, cookie: string | null, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/youtube/callback?${new URLSearchParams(query)}`, { headers: cookie ? { cookie: `${STATE_COOKIE}=${cookie}` } : {} })
}
const returnFor = (t: { nonce: string }, over: Record<string, string> = {}) => ({
  code: CODE,
  scope: 'https://www.googleapis.com/auth/youtube.readonly',
  state: t.nonce,
  ...over,
})

/** The planted witness: the untouched trip saves exactly once. Then everything is reset. */
async function witnessSaves() {
  const t = trip()
  const res = await callback(callbackReq(returnFor(t), t.cookie))
  expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?youtube=connected`)
  expect(connectOneAction).toHaveBeenCalledTimes(1)
  vi.mocked(connectOneAction).mockClear()
  fetchMock.mockClear()
}

function expectNothingHappened() {
  expect(connectOneAction).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
}

/** Nothing about the token (or the code, or the secret) left the request. */
function expectTokenNowhere(res: Response) {
  const kept = [location(res), setCookie(res), JSON.stringify(vi.mocked(connectOneAction).mock.calls), logged()].join('\n')
  for (const secret of [TOKEN, CODE, SECRET]) expect(kept).not.toContain(secret)
  // No database write of any kind: the one read is the ownership check.
  expect(w.tables.every((t) => t === 'artists')).toBe(true)
}

describe('callback — the happy path', () => {
  it('CRITICAL: saves the channel through the paste path, and goes back saying so', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))

    expect(connectOneAction).toHaveBeenCalledTimes(1)
    expect(connectOneAction).toHaveBeenCalledWith(ARTIST, 'youtube', { handle: 'skeenmusic', id: CHANNEL, sync: true })
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?youtube=connected`)

    // The code was traded with the verifier whose challenge went to Google, at this origin.
    const [, init] = calledTo('https://oauth2.googleapis.com/token')[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(String(init.body))
    expect(body.get('code')).toBe(CODE)
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/api/youtube/callback`)
    const read = readState(t.cookie, SECRET)
    if (!read.ok) throw new Error('unreachable')
    expect(body.get('code_verifier')).toBe(read.state.verifier)
    expect(t.challenge).toBe(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'))
  })

  it('CRITICAL: the token reads the channel ONCE, is revoked, and is kept nowhere', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(calledTo('https://www.googleapis.com/youtube/v3/channels')).toHaveLength(1)
    const revoked = calledTo('https://oauth2.googleapis.com/revoke')
    expect(revoked).toHaveLength(1)
    expect(new URLSearchParams(String((revoked[0] as unknown as [string, RequestInit])[1].body)).get('token')).toBe(TOKEN)
    // Revoked BEFORE the save (the save can take a while pulling videos).
    const revokeOrder = fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.findIndex(([u]) => String(u) === 'https://oauth2.googleapis.com/revoke')]
    expect(revokeOrder).toBeLessThan(vi.mocked(connectOneAction).mock.invocationCallOrder[0])
    expectTokenNowhere(res)
  })

  it('a failed revoke does not undo the connection', async () => {
    google.revoke = () => new Response('', { status: 400 })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('youtube=connected')
  })

  it('CRITICAL: the state cookie is spent — cleared on the way out', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(setCookie(res)).toMatch(new RegExp(`${STATE_COOKIE}=;`))
    expect(setCookie(res)).toMatch(/Max-Age=0/)
  })

  it('a channel with no handle saves its channel link; Sync off is passed on', async () => {
    google.channels = () => json({ items: [{ id: CHANNEL, snippet: { title: 'Skeen' } }] })
    const t = trip({ sync: false })
    await callback(callbackReq(returnFor(t), t.cookie))
    expect(connectOneAction).toHaveBeenCalledWith(ARTIST, 'youtube', { handle: `https://youtube.com/channel/${CHANNEL}`, id: CHANNEL, sync: false })
  })

  it('works on http://localhost (dev)', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie, 'http://localhost:3000'))
    expect(location(res)).toBe(`http://localhost:3000/artists/${ARTIST}/connections?youtube=connected`)
  })
})

describe('callback — refusals save nothing and ask Google for nothing', () => {
  it('CRITICAL: another trip’s nonce (state)', async () => {
    await witnessSaves()
    const mine = trip()
    const theirs = trip()
    const res = await callback(callbackReq(returnFor(theirs), mine.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('state'))
  })

  it('CRITICAL: a late return (state expired)', async () => {
    await witnessSaves()
    const t = trip({ now: Date.now() - STATE_TTL_MS - 1000 })
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('state'))
  })

  it('CRITICAL: finished in another manager’s session', async () => {
    await witnessSaves()
    const t = trip()
    w.user = { id: 'user-2' }
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('auth'))
  })

  it('CRITICAL: signed out in between', async () => {
    await witnessSaves()
    const t = trip()
    w.user = null
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('auth'))
  })

  it('CRITICAL: a manager who no longer manages the artist', async () => {
    await witnessSaves()
    const t = trip()
    w.owns = false
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('auth'))
  })

  it('CRITICAL: no state cookie, or one edited to another artist — back to the dashboard, not to any artist', async () => {
    await witnessSaves()
    const t = trip()
    const none = await callback(callbackReq(returnFor(t), null))
    expect(location(none)).toBe(`${ORIGIN}/`)
    const [body, sig] = t.cookie.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), a: '22222222-2222-4222-8222-222222222222' })).toString('base64url')
    const edited = await callback(callbackReq(returnFor(t), `${forged}.${sig}`))
    expect(location(edited)).toBe(`${ORIGIN}/`)
    expectNothingHappened()
  })

  it('CRITICAL: an http origin that is not localhost', async () => {
    await witnessSaves()
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie, 'http://app.test'))
    expectNothingHappened()
    expect(location(res)).toBe('http://app.test/')
  })

  it('CRITICAL: Cancel at Google (error=access_denied) → cancelled; nothing exchanged', async () => {
    await witnessSaves()
    const t = trip()
    const res = await callback(callbackReq({ error: 'access_denied', state: t.nonce }, t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('denied'))
  })

  it('any other error from Google, or no code at all, saves nothing', async () => {
    await witnessSaves()
    const t = trip()
    const other = await callback(callbackReq({ error: 'admin_policy_enforced', state: t.nonce }, t.cookie))
    expect(location(other)).toBe(back('exchange'))
    const t2 = trip()
    const noCode = await callback(callbackReq({ state: t2.nonce }, t2.cookie))
    expect(location(noCode)).toBe(back('exchange'))
    expectNothingHappened()
  })

  it('without the credentials nothing can be checked: back to the dashboard', async () => {
    await witnessSaves()
    const t = trip()
    process.env.GOOGLE_OAUTH_CLIENT_ID = ''
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(`${ORIGIN}/`)
    expectNothingHappened()
  })
})

describe('callback — Google says no partway', () => {
  it('CRITICAL: the code is refused → exchange; no channel read, nothing saved, no token logged', async () => {
    google.token = () => json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('exchange'))
    expect(calledTo('https://www.googleapis.com/youtube/v3/channels')).toHaveLength(0)
    expect(connectOneAction).not.toHaveBeenCalled()
    // Logged server-side (so a failure can be found), without a secret in it.
    expect(logged()).toContain('invalid_grant')
    expectTokenNowhere(res)
  })

  it('CRITICAL: the read scope not granted → scope; the token is still revoked, nothing saved', async () => {
    google.token = () => json({ access_token: TOKEN, scope: 'openid' })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('scope'))
    expect(calledTo('https://www.googleapis.com/youtube/v3/channels')).toHaveLength(0)
    expect(calledTo('https://oauth2.googleapis.com/revoke')).toHaveLength(1)
    expect(connectOneAction).not.toHaveBeenCalled()
    expectTokenNowhere(res)
  })

  it('CRITICAL: no channel on that Google account → none; revoked, nothing saved', async () => {
    google.channels = () => json({ pageInfo: { totalResults: 0 } })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('none'))
    expect(calledTo('https://oauth2.googleapis.com/revoke')).toHaveLength(1)
    expect(connectOneAction).not.toHaveBeenCalled()
    expectTokenNowhere(res)
  })

  it('the channel read fails → channel; revoked, nothing saved', async () => {
    google.channels = () => json({ error: { code: 500 } }, 500)
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('channel'))
    expect(calledTo('https://oauth2.googleapis.com/revoke')).toHaveLength(1)
    expect(connectOneAction).not.toHaveBeenCalled()
    expectTokenNowhere(res)
  })

  it('the save refused → connect; the link saved but the first import failed → sync', async () => {
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('connect'))
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'YouTube didn’t answer.', reason: 'sync' })
    const t2 = trip()
    expect(location(await callback(callbackReq(returnFor(t2), t2.cookie)))).toBe(back('sync'))
  })

  it('a thrown save is a connect failure, not a 500', async () => {
    vi.mocked(connectOneAction).mockRejectedValueOnce(new Error('db down'))
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('connect'))
  })
})
