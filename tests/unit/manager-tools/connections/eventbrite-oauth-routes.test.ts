// Connect with Eventbrite, the two routes: start sends a manager to Eventbrite, the callback
//   keeps the token in Vault, saves the organizer link through the paste door, and pulls.
/**
 * /api/eventbrite/start and /api/eventbrite/callback (Sam, 2026-09-28). The pure rules are
 * pinned in eventbrite-oauth.test.ts; what only the routes can get wrong is the ORDER and
 * the consequences:
 *
 *   - start: only a signed-in manager of THIS artist is sent to Eventbrite, with a signed,
 *     HttpOnly state cookie scoped to the callback; only https or http://localhost;
 *   - callback: a bad state, another manager, a non-owner, or "cancel" at Eventbrite saves
 *     NOTHING and asks Eventbrite for NOTHING. Every refusal first runs the untouched trip and
 *     sees it save (the planted witness), so a refusal can never pass because the save path
 *     was broken all along;
 *   - the happy path: the token goes to Vault (`connect_eventbrite`) and NOWHERE else — not a
 *     cookie, not the link save, not the pull's arguments, not the redirect, not a log line;
 *     the organizer link is saved through `connectOneAction(artist, 'eventbrite', …)`, the
 *     paste path; then the shows are pulled;
 *   - a save that fails after the token was stored forgets the token again on a FIRST connect,
 *     and puts the previous sign-in back on a RE-connect (never deletes a working one).
 *
 * Supabase, the save door and the pull are faked; Eventbrite is a stubbed global fetch.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STATE_COOKIE, STATE_TTL_MS, createState, readState } from '@/lib/eventbrite-oauth'

const CLIENT_ID = 'EB-APP-KEY'
const SECRET = 'EB-client-secret-route'
const ORIGIN = 'https://app.test'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const USER = 'user-1'
const TOKEN = 'EB-ARTIST-TOKEN-only-in-vault'
const CODE = 'eb-one-time-code'
const ORGANIZER_URL = 'https://www.eventbrite.com/o/skeen-222'

const w = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  owns: true,
  tables: [] as string[],
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: {} as Record<string, { code: string; message: string } | undefined>,
  /** What an RPC answers (the sign-in already stored, for eventbrite_credentials). */
  rpcData: {} as Record<string, unknown>,
  /** Fail one particular call, by what it was sent. */
  rpcFailWhen: null as ((fn: string, args: Record<string, unknown>) => boolean) | null,
  /** The RPCs made before the pull ran: the token must already be in Vault by then. */
  rpcBeforePull: null as string[] | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: w.user } }) },
    from: (table: string) => {
      w.tables.push(table)
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: table === 'artists' && w.owns ? { id, name: 'Skeen' } : null }) }),
        }),
      }
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      w.rpc.push({ fn, args })
      if (w.rpcFailWhen?.(fn, args)) return { data: null, error: { code: 'XX000', message: 'refused' } }
      return { data: w.rpcData[fn] ?? null, error: w.rpcError[fn] ?? null }
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/tour/eventbrite-actions', () => ({
  syncEventbriteAction: vi.fn(async () => {
    w.rpcBeforePull = w.rpc.map((r) => r.fn)
    return { ok: true, message: '3 added', notes: [] }
  }),
}))

import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { syncEventbriteAction } from '@/app/artists/[id]/(dashboard)/tour/eventbrite-actions'
import { GET as start } from '@/app/api/eventbrite/start/route'
import { GET as callback } from '@/app/api/eventbrite/callback/route'

// ── Eventbrite, stubbed ─────────────────────────────────────────────────────────────────

type Eventbrite = { token: () => Response; organizations: () => Response; organizers: () => Response }
let eventbrite: Eventbrite
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url === 'https://www.eventbrite.com/oauth/token') return eventbrite.token()
  if (url.startsWith('https://www.eventbriteapi.com/v3/users/me/organizations/')) return eventbrite.organizations()
  if (url.startsWith('https://www.eventbriteapi.com/v3/organizations/111/organizers/')) return eventbrite.organizers()
  return new Response('not found', { status: 404 })
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const HAPPY: Eventbrite = {
  token: () => json({ access_token: TOKEN, token_type: 'bearer' }),
  organizations: () => json({ organizations: [{ id: '111', name: 'Skeen Music' }], pagination: { has_more_items: false } }),
  organizers: () => json({ organizers: [{ id: '222', name: 'Skeen', url: ORGANIZER_URL }], pagination: { has_more_items: false } }),
}
const calledTo = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(url))

let logs: ReturnType<typeof vi.spyOn>[] = []
const logged = () => JSON.stringify(logs.flatMap((s) => s.mock.calls))

const ENV = { id: process.env.EVENTBRITE_CLIENT_ID, secret: process.env.EVENTBRITE_CLIENT_SECRET }
beforeEach(() => {
  process.env.EVENTBRITE_CLIENT_ID = CLIENT_ID
  process.env.EVENTBRITE_CLIENT_SECRET = SECRET
  w.user = { id: USER }
  w.owns = true
  w.tables = []
  w.rpc = []
  w.rpcError = {}
  w.rpcData = {}
  w.rpcFailWhen = null
  w.rpcBeforePull = null
  eventbrite = { ...HAPPY }
  vi.stubGlobal('fetch', fetchMock)
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env.EVENTBRITE_CLIENT_ID = ENV.id
  process.env.EVENTBRITE_CLIENT_SECRET = ENV.secret
})

const location = (res: Response) => res.headers.get('location') ?? ''
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''
const back = (reason: string, origin = ORIGIN) => `${origin}/artists/${ARTIST}/connections?eventbrite=failed&reason=${reason}`
const rpcs = (fn: string) => w.rpc.filter((r) => r.fn === fn)

// ── start ───────────────────────────────────────────────────────────────────────────────

function startReq(query: Record<string, string>, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/eventbrite/start?${new URLSearchParams(query)}`)
}

async function startGoesToEventbrite(query: Record<string, string> = { artist: ARTIST }) {
  const res = await start(startReq(query))
  expect(new URL(location(res)).origin).toBe('https://www.eventbrite.com')
  return res
}

describe('start', () => {
  it('CRITICAL: an owner is sent to Eventbrite’s authorize page, with a signed state cookie for the callback only', async () => {
    const res = await start(startReq({ artist: ARTIST }))
    expect([302, 303, 307]).toContain(res.status)
    const to = new URL(location(res))
    expect(`${to.origin}${to.pathname}`).toBe('https://www.eventbrite.com/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(to.searchParams.get('response_type')).toBe('code')
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/eventbrite/callback`)
    expect(to.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location(res)).not.toContain(SECRET)

    const cookie = setCookie(res)
    expect(cookie).toMatch(new RegExp(`^${STATE_COOKIE}=`))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/Path=\/api\/eventbrite\/callback/i)
    expect(cookie).toMatch(new RegExp(`Max-Age=${STATE_TTL_MS / 1000}`))
    const read = readState(res.cookies.get(STATE_COOKIE)!.value, SECRET)
    expect(read).toMatchObject({ ok: true, state: { artistId: ARTIST, userId: USER, organizer: null, nonce: to.searchParams.get('state') } })
    if (!read.ok) throw new Error('unreachable')
    expect(to.searchParams.get('code_challenge')).toBe(createHash('sha256').update(read.state.verifier).digest('base64url'))
  })

  it('a pasted link’s organizer id travels in the signed state; anything else is dropped', async () => {
    const res = await start(startReq({ artist: ARTIST, organizer: '222' }))
    expect(readState(res.cookies.get(STATE_COOKIE)!.value, SECRET)).toMatchObject({ ok: true, state: { organizer: '222' } })
    const junk = await start(startReq({ artist: ARTIST, organizer: '2/../x' }))
    expect(readState(junk.cookies.get(STATE_COOKIE)!.value, SECRET)).toMatchObject({ ok: true, state: { organizer: null } })
  })

  it('http://localhost is allowed (dev), and its cookie is not Secure', async () => {
    const res = await start(startReq({ artist: ARTIST }, 'http://localhost:3000'))
    expect(new URL(location(res)).searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/eventbrite/callback')
    expect(setCookie(res)).not.toMatch(/Secure/i)
  })

  it('CRITICAL: any other http origin is never sent to Eventbrite', async () => {
    await startGoesToEventbrite()
    const res = await start(startReq({ artist: ARTIST }, 'http://app.test'))
    expect(location(res)).not.toContain('eventbrite.com')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: nobody signed in goes to /login, not to Eventbrite', async () => {
    await startGoesToEventbrite()
    w.user = null
    const res = await start(startReq({ artist: ARTIST }))
    expect(new URL(location(res)).pathname).toBe('/login')
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('CRITICAL: a manager of another artist gets a 404 and no cookie', async () => {
    await startGoesToEventbrite()
    w.owns = false
    const res = await start(startReq({ artist: ARTIST }))
    expect(res.status).toBe(404)
    expect(setCookie(res)).not.toContain(STATE_COOKIE)
  })

  it('an artist id that is not an id is a 404', async () => {
    await startGoesToEventbrite()
    expect((await start(startReq({ artist: '../../admin' }))).status).toBe(404)
    expect((await start(startReq({}))).status).toBe(404)
  })

  it('without the two credentials, it goes back and says so', async () => {
    await startGoesToEventbrite()
    process.env.EVENTBRITE_CLIENT_SECRET = ''
    expect(location(await start(startReq({ artist: ARTIST })))).toBe(back('config'))
  })
})

// ── callback ────────────────────────────────────────────────────────────────────────────

type Trip = { userId?: string; organizer?: string | null; now?: number }
function trip(t: Trip = {}) {
  return createState({ artistId: ARTIST, userId: t.userId ?? USER, organizer: t.organizer ?? null }, SECRET, t.now)
}
function callbackReq(query: Record<string, string>, cookie: string | null, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/eventbrite/callback?${new URLSearchParams(query)}`, { headers: cookie ? { cookie: `${STATE_COOKIE}=${cookie}` } : {} })
}
const returnFor = (t: { nonce: string }, over: Record<string, string> = {}) => ({ code: CODE, state: t.nonce, ...over })

/** The planted witness: the untouched trip saves exactly once. Then everything is reset. */
async function witnessSaves() {
  const t = trip()
  const res = await callback(callbackReq(returnFor(t), t.cookie))
  expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?eventbrite=connected`)
  expect(connectOneAction).toHaveBeenCalledTimes(1)
  expect(rpcs('connect_eventbrite')).toHaveLength(1)
  vi.mocked(connectOneAction).mockClear()
  vi.mocked(syncEventbriteAction).mockClear()
  fetchMock.mockClear()
  w.rpc = []
}

function expectNothingHappened() {
  expect(connectOneAction).not.toHaveBeenCalled()
  expect(syncEventbriteAction).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(w.rpc).toEqual([])
}

/** The token went to Vault and nowhere else we control. */
function expectTokenOnlyInVault(res: Response) {
  const kept = [
    location(res),
    setCookie(res),
    JSON.stringify(vi.mocked(connectOneAction).mock.calls),
    JSON.stringify(vi.mocked(syncEventbriteAction).mock.calls),
    JSON.stringify(w.rpc.filter((r) => r.fn !== 'connect_eventbrite')),
    logged(),
  ].join('\n')
  for (const secret of [TOKEN, CODE, SECRET]) expect(kept).not.toContain(secret)
  // No table write of any kind from the route: the reads are the ownership check and the name.
  expect(w.tables.every((t) => t === 'artists')).toBe(true)
}

describe('callback — the happy path', () => {
  it('CRITICAL: the token goes to Vault, the organizer link through the paste door, then the shows are pulled', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))

    expect(rpcs('connect_eventbrite')).toEqual([
      { fn: 'connect_eventbrite', args: { p_artist_id: ARTIST, p_organization_id: '111', p_organizer_id: '222', p_token: TOKEN } },
    ])
    expect(connectOneAction).toHaveBeenCalledTimes(1)
    expect(connectOneAction).toHaveBeenCalledWith(ARTIST, 'eventbrite', { url: ORGANIZER_URL })
    expect(syncEventbriteAction).toHaveBeenCalledWith(ARTIST)
    // In that order: the token is stored, the link saved, then the pull that reads both.
    expect(w.rpcBeforePull).toEqual(['eventbrite_credentials', 'connect_eventbrite'])
    expect(vi.mocked(connectOneAction).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(syncEventbriteAction).mock.invocationCallOrder[0])
    expect(location(res)).toBe(`${ORIGIN}/artists/${ARTIST}/connections?eventbrite=connected`)

    // The code was traded at this origin, with the verifier whose challenge went to Eventbrite.
    const [, init] = calledTo('https://www.eventbrite.com/oauth/token')[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(String(init.body))
    expect(body.get('code')).toBe(CODE)
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/api/eventbrite/callback`)
    const read = readState(t.cookie, SECRET)
    if (!read.ok) throw new Error('unreachable')
    expect(body.get('code_verifier')).toBe(read.state.verifier)
  })

  it('CRITICAL: the token is kept in Vault and nowhere else — no cookie, no save, no redirect, no log', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toContain('eventbrite=connected')
    // Only ever in the Authorization header on the way to Eventbrite.
    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(TOKEN)
    expectTokenOnlyInVault(res)
  })

  it('CRITICAL: the state cookie is spent — cleared on the way out', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(setCookie(res)).toMatch(new RegExp(`${STATE_COOKIE}=;`))
    expect(setCookie(res)).toMatch(/Max-Age=0/)
  })

  it('the pasted link’s organizer is the one connected, among several', async () => {
    eventbrite.organizers = () =>
      json({ organizers: [{ id: '222', name: 'Skeen', url: ORGANIZER_URL }, { id: '333', name: 'Gulf Static', url: 'https://www.eventbrite.com/o/gulf-333' }] })
    const t = trip({ organizer: '333' })
    await callback(callbackReq(returnFor(t), t.cookie))
    expect(rpcs('connect_eventbrite')[0].args).toMatchObject({ p_organizer_id: '333' })
    expect(connectOneAction).toHaveBeenCalledWith(ARTIST, 'eventbrite', { url: 'https://www.eventbrite.com/o/gulf-333' })
  })

  it('works on http://localhost (dev)', async () => {
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie, 'http://localhost:3000'))
    expect(location(res)).toBe(`http://localhost:3000/artists/${ARTIST}/connections?eventbrite=connected`)
  })
})

describe('callback — refusals save nothing and ask Eventbrite for nothing', () => {
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

  it('CRITICAL: finished in another manager’s session, or signed out', async () => {
    await witnessSaves()
    const t = trip()
    w.user = { id: 'user-2' }
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('auth'))
    w.user = null
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('auth'))
    expectNothingHappened()
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
    expect(location(await callback(callbackReq(returnFor(t), null)))).toBe(`${ORIGIN}/`)
    const [body, sig] = t.cookie.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), a: '22222222-2222-4222-8222-222222222222' })).toString('base64url')
    expect(location(await callback(callbackReq(returnFor(t), `${forged}.${sig}`)))).toBe(`${ORIGIN}/`)
    expectNothingHappened()
  })

  it('CRITICAL: an http origin that is not localhost', async () => {
    await witnessSaves()
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie, 'http://app.test'))
    expectNothingHappened()
    expect(location(res)).toBe('http://app.test/')
  })

  it('CRITICAL: Cancel at Eventbrite (error=access_denied) → cancelled; nothing exchanged', async () => {
    await witnessSaves()
    const t = trip()
    const res = await callback(callbackReq({ error: 'access_denied', state: t.nonce }, t.cookie))
    expectNothingHappened()
    expect(location(res)).toBe(back('denied'))
  })

  it('any other error, or no code at all, saves nothing', async () => {
    await witnessSaves()
    const t = trip()
    expect(location(await callback(callbackReq({ error: 'server_error', state: t.nonce }, t.cookie)))).toBe(back('exchange'))
    const t2 = trip()
    expect(location(await callback(callbackReq({ state: t2.nonce }, t2.cookie)))).toBe(back('exchange'))
    expectNothingHappened()
  })

  it('without the credentials nothing can be checked: back to the dashboard', async () => {
    await witnessSaves()
    const t = trip()
    process.env.EVENTBRITE_CLIENT_ID = ''
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(`${ORIGIN}/`)
    expectNothingHappened()
  })
})

describe('callback — Eventbrite says no partway', () => {
  it('CRITICAL: the code is refused → exchange; nothing read, nothing stored, nothing saved', async () => {
    eventbrite.token = () => json({ error: 'invalid_grant', error_description: `bad ${CODE}` }, 400)
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('exchange'))
    expect(calledTo('https://www.eventbriteapi.com')).toHaveLength(0)
    expect(w.rpc).toEqual([])
    expect(connectOneAction).not.toHaveBeenCalled()
    expect(logged()).toContain('invalid_grant')
    expectTokenOnlyInVault(res)
  })

  it('CRITICAL: no organizer page on the account → none; the token is NOT stored', async () => {
    eventbrite.organizers = () => json({ organizers: [] })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('none'))
    expect(rpcs('connect_eventbrite')).toHaveLength(0)
    expect(connectOneAction).not.toHaveBeenCalled()
    expectTokenOnlyInVault(res)
  })

  it('CRITICAL: several pages and none named like the artist → ask; the token is NOT stored', async () => {
    eventbrite.organizers = () =>
      json({ organizers: [{ id: '222', name: 'Lone Pine', url: ORGANIZER_URL }, { id: '333', name: 'Gulf Static', url: 'https://www.eventbrite.com/o/gulf-333' }] })
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('several'))
    expect(rpcs('connect_eventbrite')).toHaveLength(0)
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('a pasted link whose organizer is not on the account → elsewhere; nothing stored', async () => {
    const t = trip({ organizer: '999' })
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('elsewhere'))
    expect(w.rpc).toEqual([])
  })

  it('the account cannot be read → organizer; nothing stored', async () => {
    eventbrite.organizations = () => json({ error: 'INTERNAL_ERROR' }, 500)
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('organizer'))
    expect(w.rpc).toEqual([])
    expectTokenOnlyInVault(res)
  })

  it('CRITICAL: Vault refuses the token → connect; no link saved, nothing pulled, no code in the log but its own', async () => {
    // A database message is not trusted to be clean: this one echoes its input.
    w.rpcError.connect_eventbrite = { code: 'P0001', message: `invalid eventbrite token ${TOKEN}` }
    const t = trip()
    const res = await callback(callbackReq(returnFor(t), t.cookie))
    expect(location(res)).toBe(back('connect'))
    expect(connectOneAction).not.toHaveBeenCalled()
    expect(syncEventbriteAction).not.toHaveBeenCalled()
    expectTokenOnlyInVault(res)
  })

  it('CRITICAL: the link save refused (or thrown) after the token was stored → the token is forgotten again', async () => {
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('connect'))
    expect(rpcs('disconnect_eventbrite')).toEqual([{ fn: 'disconnect_eventbrite', args: { p_artist_id: ARTIST } }])
    expect(syncEventbriteAction).not.toHaveBeenCalled()

    w.rpc = []
    vi.mocked(connectOneAction).mockRejectedValueOnce(new Error('db down'))
    const t2 = trip()
    expect(location(await callback(callbackReq(returnFor(t2), t2.cookie)))).toBe(back('connect'))
    expect(rpcs('disconnect_eventbrite')).toHaveLength(1)
  })

  const PREVIOUS = { organization_id: '70', organizer_id: '71', token: 'EB-PREVIOUS-token-still-good' }

  it('CRITICAL: on a RE-connect, a refused (or thrown) link save puts the previous sign-in back and never deletes it', async () => {
    // connect_eventbrite renews the secret IN PLACE, so forgetting after a failed re-connect
    // would destroy the sign-in that was working before (security review 2026-09-29, L6).
    for (const fail of [() => vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' }), () => vi.mocked(connectOneAction).mockRejectedValueOnce(new Error('db down'))]) {
      w.rpc = []
      w.rpcData = { eventbrite_credentials: [PREVIOUS] }
      fail()
      const t = trip()
      const res = await callback(callbackReq(returnFor(t), t.cookie))
      expect(location(res)).toBe(back('connect'))
      expect(rpcs('disconnect_eventbrite')).toEqual([])
      const connects = rpcs('connect_eventbrite').map((r) => r.args)
      expect(connects).toHaveLength(2)
      expect(connects[0]).toMatchObject({ p_artist_id: ARTIST, p_token: TOKEN })
      expect(connects[1]).toEqual({ p_artist_id: ARTIST, p_organization_id: '70', p_organizer_id: '71', p_token: PREVIOUS.token })
      expect(syncEventbriteAction).not.toHaveBeenCalled()
      expect(logged()).not.toContain(PREVIOUS.token)
      expect(setCookie(res) + location(res)).not.toContain(PREVIOUS.token)
    }
  })

  it('CRITICAL: the previous sign-in is read BEFORE the new token is stored', async () => {
    w.rpcData = { eventbrite_credentials: [PREVIOUS] }
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    await callback(callbackReq(returnFor(t), t.cookie))
    const order = w.rpc.map((r) => r.fn)
    expect(order.indexOf('eventbrite_credentials')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('eventbrite_credentials')).toBeLessThan(order.indexOf('connect_eventbrite'))
  })

  it('a restore that fails still deletes nothing: the new token stays, a working sign-in all the same', async () => {
    w.rpcData = { eventbrite_credentials: [PREVIOUS] }
    w.rpcFailWhen = (fn, args) => fn === 'connect_eventbrite' && args.p_token === PREVIOUS.token
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('connect'))
    expect(rpcs('disconnect_eventbrite')).toEqual([])
    expect(logged()).not.toContain(PREVIOUS.token)
  })

  it('when the previous sign-in cannot be READ, a failed save deletes nothing either (unknown is not "none")', async () => {
    w.rpcError.eventbrite_credentials = { code: 'XX000', message: 'down' }
    vi.mocked(connectOneAction).mockResolvedValueOnce({ ok: false, error: 'boom' })
    const t = trip()
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('connect'))
    expect(rpcs('disconnect_eventbrite')).toEqual([])
  })

  it('the first pull fails → sync; the connection stays (Pull now can retry)', async () => {
    vi.mocked(syncEventbriteAction).mockResolvedValueOnce({ ok: false, error: 'Eventbrite is busy', notes: [] })
    const t = trip()
    expect(location(await callback(callbackReq(returnFor(t), t.cookie)))).toBe(back('sync'))
    expect(rpcs('disconnect_eventbrite')).toHaveLength(0)
  })
})
