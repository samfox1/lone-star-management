/**
 * The pure rules of "Connect with YouTube": the signed note that ties a Google sign-in trip to
 * one manager and one artist, the links and code exchange with Google, reading the channel, and
 * the words shown on the way back.
 *
 * Code:     src/lib/youtube-oauth.ts, src/lib/manager-tools/connections/services/youtube
 *           (youtubeStartPath)
 * Feature:  Connections page: Connect with YouTube (Sam, 2026-09-28: sign in to Google, press
 *           Allow, and we find the channel ourselves)
 * Tier:     STRICT (AGENTS.md "Test depth"): security. Everything that decides whether a sign-in
 *           return is TRUSTED lives here, and the channel id ends up in a link.
 * Covers:   • the app is "on" only with both credentials set; only https, or http on localhost
 *           • the state cookie is signed (separately from Shopify's), carries the artist, the
 *             manager, the Sync choice and the PKCE verifier, and expires; an edited, foreign,
 *             late or garbage cookie is refused without throwing
 *           • the return must match the trip's nonce and the signed-in manager, in constant time
 *           • Google is asked for read-only YouTube access and nothing more; PKCE is S256
 *           • the exchange and the channel read never put the code, secret, verifier or token in
 *             an error; a channel id must be a real UC… id; the token revoke never throws
 *           • the channel found becomes the SAME input a pasted handle or channel link is
 *           • only codes travel back in the URL, and each becomes plain words
 * Not here: the two routes that use these rules (youtube-oauth-routes.test.ts); saving the
 *           channel and importing videos (connections-actions.test.ts).
 * Fixtures: no route, database or network: Google is a mocked fetch. node:crypto's
 *           timingSafeEqual is wrapped (still real) to count its calls.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Spy on timingSafeEqual while keeping the real one: "compare in constant time" is an
// implementation property, and this is the only way to see it.
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
  YOUTUBE_SCOPE,
  allowedOrigin,
  authorizeUrl,
  channelConnectInput,
  checkCallbackState,
  createState,
  exchangeCode,
  googleOAuthConfig,
  grantedYouTube,
  readMyChannel,
  readState,
  returnPath,
  revokeToken,
  youtubeReturnNotice,
} from '@/lib/youtube-oauth'
import { createState as createShopifyState } from '@/lib/merch/shopify-oauth'
import { connectInputError, connectionByKey, profileLink } from '@/lib/connections'
import { youtubeStartPath } from '@/lib/manager-tools/connections/services/youtube'

const SECRET = 'google-client-secret-test'
const ARTIST = '11111111-1111-4111-8111-111111111111'
const OTHER_ARTIST = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'
const CHANNEL = 'UC' + 'a'.repeat(22)
const TOKEN = 'ya29.access-token-never-kept'
const T0 = 1_000_000

afterEach(() => {
  crypto.calls = 0
})

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the app credentials', () => {
  // The Google app counts as set up only when both credentials are present (spaces trimmed).
  it('both set → the config; either blank or missing → off', () => {
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: ' id ', GOOGLE_OAUTH_CLIENT_SECRET: ' s ' })).toEqual({ clientId: 'id', clientSecret: 's' })
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: '' })).toBeNull()
    expect(googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: '  ', GOOGLE_OAUTH_CLIENT_SECRET: 's' })).toBeNull()
    expect(googleOAuthConfig({})).toBeNull()
  })
})

describe('allowedOrigin — only https, or http on localhost', () => {
  // A trip may start only over https, or plain http on localhost; any other http (a look-alike
  // localhost host, a local network address) is refused.
  it('CRITICAL: https anywhere and http://localhost pass; any other http is refused', () => {
    expect(allowedOrigin(new URL('https://app.tapirwebsites.com/api/youtube/start'))).toBe(true)
    expect(allowedOrigin(new URL('http://localhost:3000/api/youtube/start'))).toBe(true)
    expect(allowedOrigin(new URL('http://app.tapirwebsites.com/api/youtube/start'))).toBe(false)
    expect(allowedOrigin(new URL('http://localhost.evil.com/api/youtube/start'))).toBe(false)
    expect(allowedOrigin(new URL('http://192.168.1.4:3000/api/youtube/start'))).toBe(false)
  })
})

describe('the state cookie', () => {
  const trip = (over: Partial<{ artistId: string; userId: string; sync: boolean }> = {}, secret = SECRET, now = T0) =>
    createState({ artistId: ARTIST, userId: USER, sync: true, ...over }, secret, now)

  // The cookie carries the artist, the manager, the Sync choice, the nonce and the verifier back
  // intact, and the challenge Google gets is S256 of that verifier.
  it('CRITICAL: round-trips the artist, the manager, the Sync choice, the nonce and the verifier', () => {
    const { nonce, challenge, cookie } = trip({ sync: false })
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    const read = readState(cookie, SECRET, T0 + 1000)
    expect(read).toMatchObject({ ok: true, state: { nonce, artistId: ARTIST, userId: USER, sync: false, expiresAt: T0 + STATE_TTL_MS } })
    if (!read.ok) throw new Error('unreachable')
    // PKCE: the challenge Google gets is S256 of the verifier the cookie keeps.
    expect(read.state.verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    expect(challenge).toBe(s256(read.state.verifier))
  })

  // Two trips never share a nonce or a verifier, so one trip's return cannot finish another.
  it('two trips never share a nonce or a verifier', () => {
    const a = readState(trip().cookie, SECRET, T0)
    const b = readState(trip().cookie, SECRET, T0)
    if (!a.ok || !b.ok) throw new Error('unreachable')
    expect(a.state.nonce).not.toBe(b.state.nonce)
    expect(a.state.verifier).not.toBe(b.state.verifier)
  })

  // A cookie edited to name another artist fails its signature.
  it('CRITICAL: a cookie edited to point at another artist is refused', () => {
    const { cookie } = trip()
    const [body, sig] = cookie.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const forged = Buffer.from(JSON.stringify({ ...payload, a: OTHER_ARTIST })).toString('base64url')
    expect(readState(cookie, SECRET, T0).ok).toBe(true) // witness
    expect(readState(`${forged}.${sig}`, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  // A cookie signed with a different secret is refused.
  it('CRITICAL: a cookie signed with another secret is refused', () => {
    const { cookie } = trip({}, 'another-secret')
    expect(readState(cookie, 'another-secret', T0).ok).toBe(true) // witness
    expect(readState(cookie, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  // A Shopify cookie signed with the same secret is not a YouTube one: the signature is tied
  // to its purpose.
  it('CRITICAL: a Shopify state cookie signed with the SAME secret is not a YouTube one (domain separation)', () => {
    const shopify = createShopifyState({ artistId: ARTIST, userId: USER, shop: 'skeen.myshopify.com' }, SECRET, T0)
    expect(readState(shopify.cookie, SECRET, T0)).toEqual({ ok: false, reason: 'tampered' })
  })

  // A return after the time limit is refused, but still names its artist so the page can say so.
  it('CRITICAL: a late return is refused, but still names its artist so the page can say so', () => {
    const { cookie } = trip()
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS - 1).ok).toBe(true)
    expect(readState(cookie, SECRET, T0 + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired', artistId: ARTIST })
  })

  // The signature is compared in constant time, so its bytes cannot be guessed by timing.
  it('compares the signature in constant time', () => {
    expect(readState(trip().cookie, SECRET, T0).ok).toBe(true)
    expect(crypto.calls).toBeGreaterThan(0)
  })

  // No cookie, an empty one, or garbage is refused without throwing.
  it('no cookie, or garbage, is refused without throwing', () => {
    expect(readState(trip().cookie, SECRET, T0).ok).toBe(true) // witness
    expect(readState(undefined, SECRET, T0)).toEqual({ ok: false, reason: 'missing' })
    expect(readState('', SECRET, T0)).toEqual({ ok: false, reason: 'missing' })
    for (const junk of ['nodot', 'a.b.c', '.', '%%%.%%%', `${Buffer.from('not json').toString('base64url')}.x`]) {
      expect(() => readState(junk, SECRET, T0)).not.toThrow()
      expect(readState(junk, SECRET, T0).ok).toBe(false)
    }
  })

  describe('checkCallbackState — what the return must match', () => {
    const state = { nonce: 'n'.repeat(32), artistId: ARTIST, userId: USER, sync: true, verifier: 'v'.repeat(43), expiresAt: Infinity }
    const good = { nonce: state.nonce, userId: USER }

    // The matching return passes: the witness that makes each refusal below meaningful.
    it('the matching return passes (the witness for every refusal below)', () => {
      expect(checkCallbackState(state, good)).toBeNull()
    })
    // A return with another trip's nonce, none, or a short one is refused, compared in constant time.
    it('CRITICAL: another nonce, or none, is refused — compared in constant time', () => {
      crypto.calls = 0
      expect(checkCallbackState(state, { ...good, nonce: 'm'.repeat(32) })).toBe('state')
      expect(crypto.calls).toBeGreaterThan(0)
      expect(checkCallbackState(state, { ...good, nonce: null })).toBe('state')
      expect(checkCallbackState(state, { ...good, nonce: 'short' })).toBe('state')
    })
    // A return finished by another signed-in manager, or by nobody, is refused.
    it('CRITICAL: another signed-in manager (or nobody) is refused', () => {
      expect(checkCallbackState(state, { ...good, userId: 'user-2' })).toBe('auth')
      expect(checkCallbackState(state, { ...good, userId: null })).toBe('auth')
    })
  })
})

describe('the link to Google', () => {
  // The link to Google asks for read-only YouTube access only, for this sign-in only, lets the
  // manager pick the account, and carries our state and an S256 challenge.
  it('CRITICAL: asks for youtube.readonly ONLY, online access, the account picker, our state and an S256 challenge', () => {
    const url = new URL(authorizeUrl({ clientId: 'client-id', redirectUri: `http://localhost:3000${CALLBACK_PATH}`, nonce: 'nonce-1', challenge: 'chal' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'http://localhost:3000/api/youtube/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'online',
      include_granted_scopes: 'false',
      prompt: 'select_account',
      state: 'nonce-1',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
    })
    expect(YOUTUBE_SCOPE).toBe('https://www.googleapis.com/auth/youtube.readonly')
  })

  // The Connect button's address carries the artist, and says so only when Sync is off.
  it('the Connect button’s address: the artist, and Sync only when it is off', () => {
    expect(youtubeStartPath('a1', true)).toBe('/api/youtube/start?artist=a1')
    expect(youtubeStartPath('a1', false)).toBe('/api/youtube/start?artist=a1&sync=0')
  })
})

describe('exchangeCode — the one-time code for an access token', () => {
  const opts = { code: 'one-time-code', verifier: 'v'.repeat(43), clientId: 'client-id', clientSecret: SECRET, redirectUri: 'http://localhost:3000/api/youtube/callback' }

  // The code exchange posts the code, verifier, secret and exact redirect to Google, and does
  // not follow redirects (the secret is in the body); it returns the token and the scopes granted.
  it('CRITICAL: posts the code, the verifier and the exact redirect to Google’s token endpoint', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: TOKEN, expires_in: 3599, scope: YOUTUBE_SCOPE, token_type: 'Bearer' }))
    const out = await exchangeCode(opts, fetchImpl as unknown as typeof fetch)
    expect(out).toEqual({ accessToken: TOKEN, scopes: [YOUTUBE_SCOPE] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      code: 'one-time-code',
      client_id: 'client-id',
      client_secret: SECRET,
      redirect_uri: 'http://localhost:3000/api/youtube/callback',
      grant_type: 'authorization_code',
      code_verifier: 'v'.repeat(43),
    })
    // Never follow a redirect with the secret in the body.
    expect(init.redirect).toBe('manual')
  })

  // A refused exchange throws with Google's error code, but never the code, secret or verifier.
  it('CRITICAL: a refusal throws a message with no code, secret or verifier in it', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_grant', error_description: `Bad code one-time-code ${SECRET}` }, 400))
    const err = await exchangeCode(opts, fetchImpl as unknown as typeof fetch).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { step?: string }).step).toBe('exchange')
    expect((err as Error).message).toContain('invalid_grant')
    for (const secret of ['one-time-code', SECRET, 'v'.repeat(43)]) expect((err as Error).message).not.toContain(secret)
  })

  // A success answer with no token is a refusal too.
  it('a 200 with no token is a refusal too', async () => {
    const fetchImpl = vi.fn(async () => json({ scope: YOUTUBE_SCOPE }))
    await expect(exchangeCode(opts, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ step: 'exchange' })
  })

  // The read scope must be among what Google granted; another YouTube scope does not count.
  it('grantedYouTube: the read scope must be among what Google granted', () => {
    expect(grantedYouTube([YOUTUBE_SCOPE])).toBe(true)
    expect(grantedYouTube(['openid', YOUTUBE_SCOPE])).toBe(true)
    expect(grantedYouTube([])).toBe(false)
    expect(grantedYouTube(['https://www.googleapis.com/auth/youtube.upload'])).toBe(false)
  })
})

describe('readMyChannel — the signed-in account’s own channel', () => {
  const call = (res: Response) => {
    const fetchImpl = vi.fn(async () => res)
    return { fetchImpl, run: () => readMyChannel(TOKEN, fetchImpl as unknown as typeof fetch) }
  }

  // The channel read asks for the signed-in account's own channel, with the token in the
  // Authorization header, never in the URL.
  it('CRITICAL: reads channels?part=snippet&mine=true with the token as a Bearer header, never in the URL', async () => {
    const { fetchImpl, run } = call(json({ items: [{ id: CHANNEL, snippet: { title: 'Skeen', customUrl: '@skeenmusic' } }] }))
    expect(await run()).toEqual({ id: CHANNEL, handle: '@skeenmusic' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true')
    expect(url).not.toContain(TOKEN)
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  })

  // An old-style custom url (no @) is not mistaken for a handle.
  it('a legacy custom url (no @) is not taken for a handle', async () => {
    const { run } = call(json({ items: [{ id: CHANNEL, snippet: { customUrl: 'skeenmusic' } }] }))
    expect(await run()).toEqual({ id: CHANNEL, handle: null })
  })

  // An account with no channel (or one that must sign up first) is "no channel", not an error.
  it('CRITICAL: no channel on the account → null (not an error)', async () => {
    expect(await call(json({ kind: 'youtube#channelListResponse', pageInfo: { totalResults: 0 } })).run()).toBeNull()
    expect(await call(json({ items: [] })).run()).toBeNull()
    expect(await call(json({ error: { code: 401, errors: [{ reason: 'youtubeSignupRequired' }] } }, 401)).run()).toBeNull()
  })

  // A channel id that is not a UC… id is refused: it goes into a link on the site.
  it('CRITICAL: an id that is not a UC… channel id is refused — it goes into a link', async () => {
    await expect(call(json({ items: [{ id: 'UC"><script>', snippet: {} }] })).run()).rejects.toMatchObject({ step: 'channel' })
    await expect(call(json({ items: [{ id: 42 }] })).run()).rejects.toMatchObject({ step: 'channel' })
  })

  // A refused channel read throws, without the token in the message.
  it('a refusal throws, without the token in the message', async () => {
    const err = await call(json({ error: { code: 403, message: `bad ${TOKEN}` } }, 403)).run().catch((e: Error) => e)
    expect(err).toMatchObject({ step: 'channel' })
    expect((err as Error).message).not.toContain(TOKEN)
  })
})

describe('revokeToken — best effort, never a throw', () => {
  // Revoking posts the token to Google's revoke address, in the body.
  it('posts the token to Google’s revoke endpoint in the body', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }))
    expect(await revokeToken(TOKEN, fetchImpl as unknown as typeof fetch)).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/revoke')
    expect(init.method).toBe('POST')
    expect(new URLSearchParams(String(init.body)).get('token')).toBe(TOKEN)
  })

  // A refused revoke or a network failure is reported as false, never thrown.
  it('a refusal or a network failure is false, not a throw', async () => {
    expect(await revokeToken(TOKEN, (async () => new Response('', { status: 400 })) as unknown as typeof fetch)).toBe(false)
    expect(
      await revokeToken(TOKEN, (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch),
    ).toBe(false)
  })
})

describe('channelConnectInput — the found channel, as the paste path’s own input', () => {
  const youtube = connectionByKey('youtube')!

  // A channel with a handle saves exactly the link typing that handle would, plus the real id.
  it('CRITICAL: a channel with a handle saves the same link as typing that handle, plus the real id', () => {
    const input = channelConnectInput({ id: CHANNEL, handle: '@skeenmusic' }, true)
    expect(input).toEqual({ handle: 'skeenmusic', id: CHANNEL, sync: true })
    expect(connectInputError(youtube, input)).toBeNull()
    expect(profileLink(youtube, input)).toEqual(profileLink(youtube, { handle: 'skeenmusic' }))
    expect(profileLink(youtube, input)).toEqual({ url: 'https://youtube.com/@skeenmusic' })
  })

  // A channel with no handle, or one the handle rule refuses, saves its channel link, kept whole.
  it('CRITICAL: no handle (or one the handle rule refuses) → the channel link, kept whole', () => {
    for (const handle of [null, '@日本語チャンネル', '@x']) {
      const input = channelConnectInput({ id: CHANNEL, handle }, false)
      expect(input).toEqual({ handle: `https://youtube.com/channel/${CHANNEL}`, id: CHANNEL, sync: false })
      expect(connectInputError(youtube, input)).toBeNull()
      expect(profileLink(youtube, input)).toEqual({ url: `https://youtube.com/channel/${CHANNEL}` })
    }
  })
})

describe('back to the Connections page', () => {
  // Only short codes travel back in the URL, never a message.
  it('only CODES travel in the URL', () => {
    expect(returnPath(ARTIST, { ok: true })).toBe(`/artists/${ARTIST}/connections?youtube=connected`)
    expect(returnPath(ARTIST, { ok: false, reason: 'none' })).toBe(`/artists/${ARTIST}/connections?youtube=failed&reason=none`)
  })

  // Every failure code has plain words; success reads "YouTube connected." and "no channel"
  // says so plainly.
  it('CRITICAL: every code has plain words; the four outcomes read as asked', () => {
    for (const reason of OAUTH_FAILURES) {
      const notice = youtubeReturnNotice({ youtube: 'failed', reason })
      expect(notice?.kind, reason).toBe('error')
      expect(notice?.message, reason).toMatch(/\S/)
    }
    expect(youtubeReturnNotice({ youtube: 'connected' })).toEqual({ kind: 'success', message: 'YouTube connected.' })
    expect(youtubeReturnNotice({ youtube: 'failed', reason: 'none' })?.message).toMatch(/^No YouTube channel on that Google account/)
    expect(youtubeReturnNotice({ youtube: 'failed', reason: 'denied' })?.message).toMatch(/cancel/i)
  })

  // An unknown code reads as a generic failure, never as its own text (anyone can write the URL).
  it('CRITICAL: an unknown reason reads as a generic failure, never as its own text', () => {
    const notice = youtubeReturnNotice({ youtube: 'failed', reason: '<b>pwned</b>' })
    expect(notice?.kind).toBe('error')
    expect(notice?.message).not.toContain('pwned')
    expect(youtubeReturnNotice({})).toBeNull()
    expect(youtubeReturnNotice({ shopify: 'connected' })).toBeNull()
  })
})
