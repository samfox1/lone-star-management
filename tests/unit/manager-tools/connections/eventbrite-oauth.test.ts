/**
 * The pure rules of "Connect with Eventbrite": the signed note that ties a sign-in trip to one
 * manager and one artist, the links and code exchange with Eventbrite, choosing the artist's
 * organizer page, and the words shown on the way back.
 *
 * Code:     src/lib/eventbrite-oauth.ts, src/lib/manager-tools/connections/services/eventbrite
 *           (eventbriteStartPath)
 * Feature:  Connections page: Connect with Eventbrite (Sam, 2026-09-28: sign in, press Allow, we
 *           find the organizer page and pull the shows)
 * Tier:     STRICT (AGENTS.md "Test depth"): security. Everything that decides whether a sign-in
 *           return is TRUSTED lives here.
 * Covers:   • the app is "on" only with both credentials set
 *           • only https, or http on localhost, may start a trip
 *           • the state cookie is signed (separately from YouTube's and Shopify's), carries the
 *             artist, the manager, the PKCE verifier and an organizer hint, and expires; an
 *             edited, foreign, late, malformed or garbage cookie is refused without throwing
 *           • the return must match the trip's nonce and the signed-in manager, compared in
 *             constant time
 *           • PKCE is S256 (checked here with node's crypto, not the code under test); the code
 *             exchange never puts the code, secret or verifier in an error
 *           • the organizer: none → say so; one → it; several → the pasted link's, else the one
 *             named like the artist, else ASK
 *           • only codes travel back in the URL, and each becomes plain words
 * Not here: the two routes that use these rules (eventbrite-oauth-routes.test.ts); the stored
 *           token (tests/integration/sync/eventbrite-vault.test.ts); reading events
 *           (tests/unit/tour/eventbrite-events.test.ts).
 * Fixtures: no route, database or network: Eventbrite is a mocked fetch. node:crypto's
 *           timingSafeEqual is wrapped (still real) to count its calls.
 */
import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const crypto = vi.hoisted(() => ({ calls: 0 }))
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      crypto.calls++
      return real.timingSafeEqual(a, b)
    },
  }
})

import {
  CALLBACK_PATH,
  OAUTH_FAILURES,
  STATE_TTL_MS,
  allowedOrigin,
  authorizeUrl,
  checkCallbackState,
  chooseOrganizer,
  createState,
  eventbriteOAuthConfig,
  eventbriteReturnNotice,
  eventbriteSignedInState,
  exchangeCode,
  findOrganizer,
  readState,
  returnPath,
} from '@/lib/eventbrite-oauth'
import { createState as createYouTubeState } from '@/lib/youtube-oauth'
import { createEventbriteClient, type EventbriteOrganizer } from '@/lib/eventbrite'
import { connectionByKey, idFromProfileUrl } from '@/lib/connections'
import { eventbriteStartPath } from '@/lib/manager-tools/connections/services/eventbrite'

const SECRET = 'eventbrite-client-secret-test'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const OTHER_ARTIST = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'
const TOKEN = 'EVENTBRITE-TOKEN-never-logged'
const T0 = 1_000_000

afterEach(() => {
  crypto.calls = 0
})

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the app credentials', () => {
  // The app counts as set up only when both credentials are present (spaces trimmed); otherwise
  // the Connect button is hidden.
  it('both set → the config; either blank or missing → off (the button is hidden)', () => {
    expect(eventbriteOAuthConfig({ EVENTBRITE_CLIENT_ID: ' key ', EVENTBRITE_CLIENT_SECRET: ' s ' })).toEqual({ clientId: 'key', clientSecret: 's' })
    expect(eventbriteOAuthConfig({ EVENTBRITE_CLIENT_ID: 'key', EVENTBRITE_CLIENT_SECRET: '' })).toBeNull()
    expect(eventbriteOAuthConfig({ EVENTBRITE_CLIENT_ID: '  ', EVENTBRITE_CLIENT_SECRET: 's' })).toBeNull()
    expect(eventbriteOAuthConfig({})).toBeNull()
  })

  // What the pages are told: a stored sign-in is "signed in"; with the app set up and nothing
  // stored, "not yet"; with the app off and nothing stored, nothing at all.
  it('what the pages pass as the sign-in state: stored → true; else false with the app, absent without', () => {
    const env = { id: process.env.EVENTBRITE_CLIENT_ID, secret: process.env.EVENTBRITE_CLIENT_SECRET }
    try {
      process.env.EVENTBRITE_CLIENT_ID = 'key'
      process.env.EVENTBRITE_CLIENT_SECRET = 's'
      expect(eventbriteSignedInState(true)).toBe(true)
      expect(eventbriteSignedInState(false)).toBe(false)
      process.env.EVENTBRITE_CLIENT_SECRET = ''
      expect(eventbriteSignedInState(true)).toBe(true)
      expect(eventbriteSignedInState(false)).toBeUndefined()
    } finally {
      process.env.EVENTBRITE_CLIENT_ID = env.id
      process.env.EVENTBRITE_CLIENT_SECRET = env.secret
    }
  })
})

describe('allowedOrigin — only https, or http on localhost', () => {
  // A trip may start only over https, or plain http on localhost for development; any other
  // http (including a look-alike localhost host) is refused.
  it('CRITICAL: https anywhere and http://localhost pass; any other http is refused', () => {
    expect(allowedOrigin(new URL('https://digitaltapir.com/api/eventbrite/start'))).toBe(true)
    expect(allowedOrigin(new URL('http://localhost:3000/api/eventbrite/start'))).toBe(true)
    expect(allowedOrigin(new URL('http://digitaltapir.com/api/eventbrite/start'))).toBe(false)
    expect(allowedOrigin(new URL('http://localhost.evil.com/api/eventbrite/start'))).toBe(false)
    expect(allowedOrigin(new URL('ftp://localhost/api/eventbrite/start'))).toBe(false)
  })
})

describe('the state cookie', () => {
  const trip = (over: Partial<{ artistId: string; userId: string; organizer: string | null }> = {}, secret = SECRET, now = T0) =>
    createState({ artistId: ARTIST, userId: USER, organizer: null, ...over }, secret, now)

  // The cookie carries the artist, the manager, the organizer hint, the nonce and the verifier
  // back intact, and the challenge sent to Eventbrite is S256 of that verifier.
  it('CRITICAL: round-trips the artist, the manager, the organizer hint, the nonce and the verifier', () => {
    const { nonce, challenge, cookie } = trip({ organizer: '12345' })
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    const read = readState(cookie, SECRET, T0 + 1000)
    expect(read).toMatchObject({ ok: true, state: { nonce, artistId: ARTIST, userId: USER, organizer: '12345', expiresAt: T0 + STATE_TTL_MS } })
    if (!read.ok) throw new Error('unreachable')
    expect(read.state.verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    expect(challenge).toBe(s256(read.state.verifier))
  })

  // An organizer hint that is not digits is dropped rather than carried into the trip.
  it('an organizer hint that is not digits is dropped, never carried', () => {
    const read = readState(trip({ organizer: '12/../x' }).cookie, SECRET, T0)
    expect(read).toMatchObject({ ok: true, state: { organizer: null } })
  })

  // Two trips never share a nonce or a verifier, so one trip's return cannot finish another.
  it('two trips never share a nonce or a verifier', () => {
    const a = readState(trip().cookie, SECRET, T0)
    const b = readState(trip().cookie, SECRET, T0)
    if (!a.ok || !b.ok) throw new Error('unreachable')
    expect(a.state.nonce).not.toBe(b.state.nonce)
    expect(a.state.verifier).not.toBe(b.state.verifier)
  })

  // A cookie edited to name another artist or organizer fails its signature.
  it('CRITICAL: a cookie edited to point at another artist (or another organizer) is refused', () => {
    const { cookie } = trip()
    const [body, sig] = cookie.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    expect(readState(cookie, SECRET, T0).ok).toBe(true) // witness
    for (const edit of [{ a: OTHER_ARTIST }, { o: '999' }]) {
      const forged = Buffer.from(JSON.stringify({ ...payload, ...edit })).toString('base64url')
      expect(readState(`${forged}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
    }
  })

  // A cookie signed with a different secret is refused.
  it('CRITICAL: a cookie signed with another secret is refused', () => {
    const { cookie } = trip({}, 'another-secret')
    expect(readState(cookie, 'another-secret', T0).ok).toBe(true) // witness
    expect(readState(cookie, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  // A YouTube (or Shopify) cookie signed with the same secret is not an Eventbrite one: the
  // signature is tied to its purpose, not just to the payload's shape.
  it('CRITICAL: a YouTube state cookie signed with the SAME secret is not an Eventbrite one', () => {
    const youtube = createYouTubeState({ artistId: ARTIST, userId: USER, sync: true }, SECRET, T0)
    expect(readState(youtube.cookie, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
    // Nor is an Eventbrite-shaped body signed for any other use of the secret: the signature
    // is domain-separated, not just the payload shape.
    const body = trip().cookie.split('.')[0]
    for (const message of [body, `lone-star:youtube-oauth-state:${body}`, `lone-star:shopify-oauth-state:${body}`]) {
      const sig = createHmac('sha256', SECRET).update(message).digest('base64url')
      expect(readState(`${body}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
    }
  })

  // A return after the time limit is refused, but still names its artist so the page can say so.
  it('CRITICAL: a late return is refused, but still names its artist so the page can say so', () => {
    const { cookie } = trip()
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS - 1).ok).toBe(true)
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired', artistId: ARTIST })
  })

  // A correctly signed cookie with a wrong shape (any field missing, mistyped, or a verifier
  // outside the PKCE alphabet) is still refused.
  it('CRITICAL: a correctly SIGNED cookie with a wrong shape is still refused (every field, its type, the verifier alphabet)', () => {
    const sign = (payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      return `${body}.${createHmac('sha256', SECRET).update(`lone-star:eventbrite-oauth-state:${body}`).digest('base64url')}`
    }
    const good = { n: 'n'.repeat(32), a: ARTIST, u: USER, o: '', v: 'v'.repeat(43), e: T0 + 1000 }
    expect(readState(sign(good), SECRET, T0)).toMatchObject({ ok: true }) // witness: the signer is right
    const bad: Record<string, unknown>[] = [
      { n: 1 },
      { a: null },
      { u: 7 },
      { o: 12 },
      { o: '12/x' },
      { v: 'v'.repeat(42) },
      { v: `${'v'.repeat(43)}!` },
      { v: `!${'v'.repeat(43)}` },
      { v: 42 },
      { e: '2030' },
    ]
    for (const edit of bad) expect(readState(sign({ ...good, ...edit }), SECRET, T0), JSON.stringify(edit)).toEqual({ ok: false, reason: 'tampered' })
    expect(readState(sign(null), SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  // The signature is compared in constant time, so its bytes cannot be guessed by timing.
  it('compares the signature in constant time', () => {
    expect(readState(trip().cookie, SECRET, T0).ok).toBe(true)
    expect(crypto.calls).toBeGreaterThan(0)
  })

  // No cookie, or garbage, is refused without throwing.
  it('no cookie, or garbage, is refused without throwing', () => {
    expect(readState(trip().cookie, SECRET, T0).ok).toBe(true) // witness
    expect(readState(undefined, SECRET, T0)).toEqual({ ok: false, reason: 'missing' })
    for (const junk of ['nodot', 'a.b.c', '.', '%%%.%%%', `${Buffer.from('not json').toString('base64url')}.x`]) {
      expect(() => readState(junk, SECRET, T0)).not.toThrow()
      expect(readState(junk, SECRET, T0).ok).toBe(false)
    }
  })

  describe('checkCallbackState — what the return must match', () => {
    const state = { nonce: 'n'.repeat(32), artistId: ARTIST, userId: USER, organizer: null, verifier: 'v'.repeat(43), expiresAt: Infinity }
    const good = { nonce: state.nonce, userId: USER }

    // The matching return passes: the witness that makes each refusal below meaningful.
    it('the matching return passes (the witness for every refusal below)', () => {
      expect(checkCallbackState(state, good)).toBeNull()
    })
    // A return with another trip's nonce, or none, is refused, compared in constant time.
    it('CRITICAL: another nonce, or none, is refused — compared in constant time', () => {
      crypto.calls = 0
      expect(checkCallbackState(state, { ...good, nonce: 'm'.repeat(32) })).toBe('state')
      expect(crypto.calls).toBeGreaterThan(0)
      expect(checkCallbackState(state, { ...good, nonce: null })).toBe('state')
    })
    // A return finished by another signed-in manager, or by nobody, is refused.
    it('CRITICAL: another signed-in manager (or nobody) is refused', () => {
      expect(checkCallbackState(state, { ...good, userId: 'user-2' })).toBe('auth')
      expect(checkCallbackState(state, { ...good, userId: null })).toBe('auth')
    })
  })
})

describe('the link to Eventbrite', () => {
  // The link to Eventbrite carries exactly our app key, redirect, state and S256 challenge, and
  // never the secret.
  it('CRITICAL: the authorize page with our app key, the exact redirect, our state and an S256 challenge — no secret', () => {
    const url = new URL(authorizeUrl({ clientId: 'app-key', redirectUri: `http://localhost:3000${CALLBACK_PATH}`, nonce: 'nonce-1', challenge: 'chal' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://www.eventbrite.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'app-key',
      redirect_uri: 'http://localhost:3000/api/eventbrite/callback',
      state: 'nonce-1',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
    })
  })

  // The Connect button's address carries the artist, plus the organizer id from a pasted link
  // only when it is digits; the id comes out of the pasted link the same way it always has.
  it('the Connect button’s address: the artist, and the organizer id from a pasted link when there is one', () => {
    expect(eventbriteStartPath('a1')).toBe('/api/eventbrite/start?artist=a1')
    expect(eventbriteStartPath('a1', '12345')).toBe('/api/eventbrite/start?artist=a1&organizer=12345')
    expect(eventbriteStartPath('a1', 'x/../y')).toBe('/api/eventbrite/start?artist=a1')
    expect(eventbriteStartPath('a1', 'abc123')).toBe('/api/eventbrite/start?artist=a1')
    expect(eventbriteStartPath('a1', '123abc')).toBe('/api/eventbrite/start?artist=a1')
    expect(eventbriteStartPath('a1', null)).toBe('/api/eventbrite/start?artist=a1')
    // The id comes out of the pasted organizer link the same way it always has.
    const eb = connectionByKey('eventbrite')!
    expect(idFromProfileUrl(eb, 'https://www.eventbrite.com/o/skeen-12345')).toBe('12345')
    expect(idFromProfileUrl(eb, 'http://eventbrite.com/o/skeen-12345/')).toBe('12345')
    expect(idFromProfileUrl(eb, 'https://www.eventbrite.com/o/skeen-12345x')).toBeNull()
    expect(idFromProfileUrl(eb, 'see https://www.eventbrite.com/o/skeen-12345')).toBeNull()
  })
})

describe('exchangeCode — the one-time code for the artist’s token', () => {
  const opts = { code: 'one-time-code', verifier: 'v'.repeat(43), clientId: 'app-key', clientSecret: SECRET, redirectUri: 'http://localhost:3000/api/eventbrite/callback' }

  // The code exchange posts the code, app key, secret, redirect and verifier form-encoded, and
  // does not follow redirects (the secret is in the body).
  it('CRITICAL: posts the code, the app key, the secret, the exact redirect and the verifier, form-encoded', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: TOKEN, token_type: 'bearer' }))
    expect(await exchangeCode(opts, fetchImpl as unknown as typeof fetch)).toBe(TOKEN)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.eventbrite.com/oauth/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'one-time-code',
      client_id: 'app-key',
      client_secret: SECRET,
      redirect_uri: 'http://localhost:3000/api/eventbrite/callback',
      code_verifier: 'v'.repeat(43),
    })
    expect(init.redirect).toBe('manual')
  })

  // A refused exchange throws with Eventbrite's error code, but never the code, secret or verifier.
  it('CRITICAL: a refusal throws a message with no code, secret or verifier in it', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_grant', error_description: `bad one-time-code ${SECRET}` }, 400))
    const err = await exchangeCode(opts, fetchImpl as unknown as typeof fetch).catch((e: Error) => e)
    expect(err).toMatchObject({ step: 'exchange' })
    expect((err as Error).message).toContain('invalid_grant')
    for (const secret of ['one-time-code', SECRET, 'v'.repeat(43)]) expect((err as Error).message).not.toContain(secret)
  })

  // A success answer with no token, or a blank one, is a refusal too; spaces around a token are trimmed.
  it('a 200 with no token (or a blank one) is a refusal too', async () => {
    await expect(exchangeCode(opts, (async () => json({ token_type: 'bearer' })) as unknown as typeof fetch)).rejects.toMatchObject({ step: 'exchange' })
    await expect(exchangeCode(opts, (async () => json({ access_token: '   ' })) as unknown as typeof fetch)).rejects.toMatchObject({ step: 'exchange' })
    expect(await exchangeCode(opts, (async () => json({ access_token: ` ${TOKEN}\n` })) as unknown as typeof fetch)).toBe(TOKEN)
  })

  // An error field that is not a short snake_case code is not echoed into the message.
  it('an error field that is not a short snake_case code is not echoed', async () => {
    for (const error of ['Invalid <b>code</b>', 'x invalid_grant', 'invalid_grant x', 42]) {
      const err = await exchangeCode(opts, (async () => json({ error }, 400)) as unknown as typeof fetch).catch((e: Error) => e)
      expect((err as Error).message, String(error)).toBe('Eventbrite refused the code (HTTP 400).')
    }
  })
})

describe('chooseOrganizer — which organizer page is this artist', () => {
  const org = (id: string, name: string): EventbriteOrganizer => ({ organizationId: '111', id, name, url: `https://www.eventbrite.com/o/${id}` })
  const skeen = org('222', 'Skeen')
  const other = org('333', 'Gulf Static')

  // No organizer page on the account: say so.
  it('CRITICAL: none → say so', () => {
    expect(chooseOrganizer([], { hint: null, artistName: 'Skeen' })).toEqual({ ok: false, reason: 'none' })
  })

  // One organizer page: that one, whatever it is called.
  it('CRITICAL: one → that one, whatever it is called', () => {
    expect(chooseOrganizer([other], { hint: null, artistName: 'Skeen' })).toEqual({ ok: true, organizer: other })
  })

  // Several: the one named like the artist, ignoring case, spaces, dashes and accents.
  it('CRITICAL: several → the one named like the artist (case, spaces and accents aside)', () => {
    expect(chooseOrganizer([other, skeen], { hint: null, artistName: 'skeen' })).toEqual({ ok: true, organizer: skeen })
    expect(chooseOrganizer([other, org('444', 'Sk-eén')], { hint: null, artistName: 'SKEEN' })).toMatchObject({ ok: true, organizer: { id: '444' } })
  })

  // Several and no single name match (or two with the same name): ask for the organizer link,
  // never a coin toss.
  it('CRITICAL: several and no single name match → ask (paste the organizer link)', () => {
    expect(chooseOrganizer([other, skeen], { hint: null, artistName: 'Lone Pine' })).toEqual({ ok: false, reason: 'several' })
    // Two called the same is still a question, not a coin toss.
    expect(chooseOrganizer([skeen, org('555', 'Skeen')], { hint: null, artistName: 'Skeen' })).toEqual({ ok: false, reason: 'several' })
  })

  // A pasted link's organizer wins; one that is not on the account is refused, never swapped
  // for another.
  it('CRITICAL: a pasted link’s organizer wins; one not on the account is refused, never swapped for another', () => {
    expect(chooseOrganizer([other, skeen], { hint: '333', artistName: 'Skeen' })).toEqual({ ok: true, organizer: other })
    expect(chooseOrganizer([other, skeen], { hint: '999', artistName: 'Skeen' })).toEqual({ ok: false, reason: 'elsewhere' })
    expect(chooseOrganizer([skeen], { hint: '999', artistName: 'Skeen' })).toEqual({ ok: false, reason: 'elsewhere' })
  })
})

describe('findOrganizer — every organization on the account, then choose', () => {
  // It looks through every organization the account belongs to, not just the first.
  it('CRITICAL: looks through every organization the account belongs to', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/v3/users/me/organizations/') return json({ organizations: [{ id: '111', name: 'A' }, { id: '112', name: 'B' }] })
      if (path === '/v3/organizations/111/organizers/') return json({ organizers: [] })
      if (path === '/v3/organizations/112/organizers/') return json({ organizers: [{ id: '222', name: 'Skeen', url: 'https://www.eventbrite.com/o/skeen-222' }] })
      return json({}, 404)
    })
    const client = createEventbriteClient({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await findOrganizer(TOKEN, { hint: null, artistName: 'Skeen' }, client)).toEqual({
      ok: true,
      organizer: { organizationId: '112', id: '222', name: 'Skeen', url: 'https://www.eventbrite.com/o/skeen-222' },
    })
  })

  // An account with no organization at all has no organizer page.
  it('no organization at all → none', async () => {
    const client = createEventbriteClient({ fetchImpl: (async () => json({ organizations: [] })) as unknown as typeof fetch })
    expect(await findOrganizer(TOKEN, { hint: null, artistName: 'Skeen' }, client)).toEqual({ ok: false, reason: 'none' })
  })
})

describe('back to the Connections page', () => {
  // Only short codes travel back in the URL, never a message.
  it('only CODES travel in the URL', () => {
    expect(returnPath(ARTIST, { ok: true })).toBe(`/artists/${ARTIST}/connections?eventbrite=connected`)
    expect(returnPath(ARTIST, { ok: false, reason: 'several' })).toBe(`/artists/${ARTIST}/connections?eventbrite=failed&reason=several`)
  })

  // Every failure code has plain words, and the success reads "Eventbrite connected.".
  it('CRITICAL: every code has plain words; the asks read as asked', () => {
    for (const reason of OAUTH_FAILURES) {
      const notice = eventbriteReturnNotice({ eventbrite: 'failed', reason })
      expect(notice?.kind, reason).toBe('error')
      expect(notice?.message, reason).toMatch(/\S/)
    }
    expect(eventbriteReturnNotice({ eventbrite: 'connected' })).toEqual({ kind: 'success', message: 'Eventbrite connected.' })
    expect(eventbriteReturnNotice({ eventbrite: 'failed', reason: 'several' })?.message).toMatch(/organizer link/)
    expect(eventbriteReturnNotice({ eventbrite: 'failed', reason: 'denied' })?.message).toMatch(/cancel/i)
  })

  // An unknown or repeated code reads as a generic failure, never as its own text (it arrives
  // in the URL, so anyone can write it).
  it('CRITICAL: an unknown reason reads as a generic failure, never as its own text', () => {
    const notice = eventbriteReturnNotice({ eventbrite: 'failed', reason: '<b>pwned</b>' })
    expect(notice?.kind).toBe('error')
    expect(notice?.message).not.toContain('pwned')
    expect(eventbriteReturnNotice({})).toBeNull()
    expect(eventbriteReturnNotice({ youtube: 'connected' })).toBeNull()
    // A repeated param arrives as an array: never read as its own text.
    expect(eventbriteReturnNotice({ eventbrite: ['connected', 'connected'] })).toBeNull()
    expect(eventbriteReturnNotice({ eventbrite: 'failed', reason: ['several', 'x'] })?.message).toBe(eventbriteReturnNotice({ eventbrite: 'failed', reason: 'connect' })?.message)
  })
})
