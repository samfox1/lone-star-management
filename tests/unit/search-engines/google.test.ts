// Tapir's robot account signs in to Google and registers a site: the exact calls, and nothing leaked.
/**
 * Code:     src/lib/search-engines/google.ts (googleCredsFromEnv, googleClient)
 * Feature:  Add website · registering a site with Google (ADD_WEBSITE_PLAN.md step 4)
 * Tier:     STRICT (AGENTS.md "Test depth"): a service-account key that owns every client site in
 *           Search Console, and calls that make Tapir a site's verified owner. The request shapes
 *           are Google's own (Site Verification API v1, Search Console API v3); the key never
 *           appears in anything a caller can print or store.
 * Covers:   • the key from the env (base64 JSON), and nothing for a missing or broken one
 *           • sign-in: a JWT for the two scopes, signed with the key (checked with the public
 *             half), cached until it nearly expires; a refusal is `google_auth`
 *           • the META token: the right request, the code taken from a whole <meta> tag or a bare
 *             value, refused unless it is in the bridge's shape
 *           • verify (with the owner; a missing owner added by update), add the property, send the
 *             sitemap: method, URL (encoded), body; each failure its own reason code, a network
 *             failure (sign-in or the call itself) `google_network`; a 401 retried once; a time
 *             limit on every request; a key that can't sign fails before anything is sent
 * Not here: the order of the steps and what is stored (register.test.ts).
 * Fixtures: an RSA key pair made for this file, and a fake fetch that records every request.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { googleClient, googleCredsFromEnv, type GoogleCreds } from '@/lib/search-engines/google'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const CREDS: GoogleCreds = { client_email: 'tapir-search@digital-tapir.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
const SITE = 'https://www.skeenmusic.com/'
const CODE = 'ptl8bmwM1LyyV7c1h9f8Jkz9aQ-lsnRVg5ZlwCmG1ZI'

type Call = { url: string; method: string; headers: Record<string, string>; body: string }

/** A fake Google: `answer` decides each response; every request is recorded. */
function fakeGoogle(answer: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : ''
    const call = { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body }
    calls.push(call)
    return answer(call)
  }) as typeof fetch
  return { fetcher, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** A Google that signs in and then answers `rest`. */
const signedIn = (rest: (c: Call) => Response) => fakeGoogle((c) => (c.url === TOKEN_URL ? json({ access_token: 'ya29.test', expires_in: 3600 }) : rest(c)))

describe('googleCredsFromEnv', () => {
  // The env holds the JSON key base64-encoded (put there by Sam's one-line command).
  it('reads the base64 JSON key', () => {
    const b64 = Buffer.from(JSON.stringify({ type: 'service_account', ...CREDS })).toString('base64')
    // Compared field by field as booleans, so a failure prints no key material.
    const got = googleCredsFromEnv(b64)
    expect(got?.client_email).toBe(CREDS.client_email)
    expect(got?.private_key === CREDS.private_key).toBe(true)
  })

  // A missing or broken key is "not set up", never a crash. The check is a boolean on purpose:
  // a failing `toBeNull()` would PRINT whatever came back, and if that were ever a real key it
  // would land in the test output (it did once, 2026-09-30).
  it('is null for a missing or broken key', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
    for (const bad of [undefined, '', 'not base64 json', b64({ client_email: 'x' }), b64({ private_key: 'k' }), b64({ client_email: 1, private_key: 'k' }), b64('a string')]) {
      expect(googleCredsFromEnv(bad) === null, `input #${String(bad).length}`).toBe(true)
    }
  })
})

describe('signing in', () => {
  // A JWT-bearer grant for exactly the two scopes, signed with the robot's key, stamped in SECONDS.
  it('asks for a token with a signed JWT for Site Verification and Search Console', async () => {
    const t = 1_700_000_123_456
    const g = signedIn(() => new Response(null, { status: 204 }))
    await googleClient(CREDS, { fetcher: g.fetcher, now: () => t }).addSite(SITE)
    const call = g.calls[0]
    expect(call.url).toBe(TOKEN_URL)
    expect(call.method).toBe('POST')
    const form = new URLSearchParams(call.body)
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, c, sig] = form.get('assertion')!.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims.iss).toBe(CREDS.client_email)
    expect(claims.aud).toBe(TOKEN_URL)
    expect(claims.scope.split(' ').sort()).toEqual(['https://www.googleapis.com/auth/siteverification', 'https://www.googleapis.com/auth/webmasters'])
    expect(claims.iat).toBe(Math.floor(t / 1000))
    expect(claims.exp).toBe(claims.iat + 3600)
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
    // The token goes to the API in the header, and only there.
    expect(g.calls[1].headers.authorization).toBe('Bearer ya29.test')
  })

  // Exactly at the edge (a minute before expiry) a fresh token is fetched.
  it('fetches a fresh token exactly a minute before expiry, and assumes an hour when Google doesn’t say', async () => {
    let t = 0
    const g = fakeGoogle((x) => (x.url === TOKEN_URL ? json({ access_token: 'ya29.nolife' }) : new Response(null, { status: 204 })))
    const client = googleClient(CREDS, { fetcher: g.fetcher, now: () => t })
    await client.addSite(SITE)
    t = 3539_999
    await client.addSite(SITE)
    expect(g.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
    t = 3540_000
    await client.addSite(SITE)
    expect(g.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2)
  })

  // One sign-in serves every call until a minute before it expires, whatever Google said its life was.
  it('reuses the token until a minute before it expires', async () => {
    let t = 1_000_000
    const tokenCalls = (g: ReturnType<typeof fakeGoogle>) => g.calls.filter((x) => x.url === TOKEN_URL).length
    const g = signedIn(() => new Response(null, { status: 204 }))
    const client = googleClient(CREDS, { fetcher: g.fetcher, now: () => t })
    await client.addSite(SITE)
    t += 3539_000
    await client.addSite(SITE)
    expect(tokenCalls(g)).toBe(1)
    t += 2_000
    await client.addSite(SITE)
    expect(tokenCalls(g)).toBe(2)

    let u = 0
    const short = fakeGoogle((x) => (x.url === TOKEN_URL ? json({ access_token: 'ya29.short', expires_in: 120 }) : new Response(null, { status: 204 })))
    const c2 = googleClient(CREDS, { fetcher: short.fetcher, now: () => u })
    await c2.addSite(SITE)
    u += 59_000
    await c2.addSite(SITE)
    expect(tokenCalls(short)).toBe(1)
    u += 2_000
    await c2.addSite(SITE)
    expect(tokenCalls(short)).toBe(2)
  })

  // A token Google stops accepting (revoked, clock skew) is dropped and the call tried once more.
  it('signs in again once when Google answers 401', async () => {
    let apiCalls = 0
    const g = signedIn(() => (++apiCalls === 1 ? json({ error: { message: 'Invalid Credentials' } }, 401) : new Response(null, { status: 204 })))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toEqual({ ok: true, value: true })
    expect(g.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2)
  })

  // Only ONE retry: a Google that keeps saying 401 gets two tries, then the step's own reason.
  it('retries a 401 only once', async () => {
    const g = signedIn(() => json({ error: { message: 'Invalid Credentials' } }, 401))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toMatchObject({ ok: false, reason: 'google_add', status: 401 })
    expect(g.calls.filter((c) => c.url !== TOKEN_URL)).toHaveLength(2)
  })

  // A refused sign-in is its own reason, and the key never rides along in it.
  it('says google_auth when Google refuses the sign-in', async () => {
    const g = fakeGoogle(() => json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400))
    const r = await googleClient(CREDS, { fetcher: g.fetcher }).getMetaToken(SITE)
    expect(r).toMatchObject({ ok: false, reason: 'google_auth', status: 400, detail: 'Invalid JWT Signature.' })
    expect(JSON.stringify(r)).not.toContain('PRIVATE KEY')
    // Nothing is sent to the API after a refused sign-in.
    expect(g.calls).toHaveLength(1)
  })

  // A sign-in answer with no token is a refusal too, and nothing more is sent.
  it('says google_auth when the sign-in answer has no token', async () => {
    const g = fakeGoogle(() => json({ token_type: 'Bearer' }))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toMatchObject({ ok: false, reason: 'google_auth' })
    expect(g.calls).toHaveLength(1)
  })

  // No answer from the sign-in: google_network, and the API is never called with no token.
  it('says google_network and sends nothing more when sign-in gets no answer', async () => {
    const g = fakeGoogle(() => {
      throw new TypeError('fetch failed')
    })
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toMatchObject({ ok: false, reason: 'google_network' })
    expect(g.calls).toHaveLength(1)
  })

  // The sign-in is a form post.
  it('posts the sign-in as a form', async () => {
    const g = signedIn(() => new Response(null, { status: 204 }))
    await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)
    expect(g.calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded')
  })

  // Google's message is passed on clean and short: no control characters, at most 200 characters.
  it('passes Google’s message on without control characters, cut to 200', async () => {
    const g = signedIn(() => json({ error: { message: `bad\u001b[31m${'x'.repeat(300)}` } }, 400))
    const r = await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)
    expect(r.ok).toBe(false)
    const detail = r.ok ? '' : (r.detail ?? '')
    expect(detail.startsWith('bad [31m')).toBe(true)
    expect(detail).toHaveLength(200)
  })

  // A key that can't sign fails as google_auth before anything is sent, and never throws.
  it('says google_auth without a request when the key can’t sign', async () => {
    const g = signedIn(() => json({}))
    const r = await googleClient({ ...CREDS, private_key: 'not a key' }, { fetcher: g.fetcher }).addSite(SITE)
    expect(r).toMatchObject({ ok: false, reason: 'google_auth' })
    expect(g.calls).toHaveLength(0)
  })

  // Every request has a time limit, so a hung Google can't hang a registration.
  it('puts a time limit on every request', async () => {
    const signals: unknown[] = []
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal)
      const url = typeof input === 'string' ? input : String(input)
      return url === TOKEN_URL ? json({ access_token: 'ya29.test', expires_in: 3600 }) : new Response(null, { status: 204 })
    }) as typeof fetch
    await googleClient(CREDS, { fetcher }).addSite(SITE)
    expect(signals).toHaveLength(2)
    for (const sgn of signals) expect(sgn).toBeInstanceOf(AbortSignal)
  })
})

describe('the META token', () => {
  // Google's documented request for a site's meta-tag token.
  it('asks for a META token for the SITE', async () => {
    const g = signedIn(() => json({ method: 'META', token: `<meta name="google-site-verification" content="${CODE}" />` }))
    const r = await googleClient(CREDS, { fetcher: g.fetcher }).getMetaToken(SITE)
    expect(r).toEqual({ ok: true, value: CODE })
    const call = g.calls[1]
    expect(call.method).toBe('POST')
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.url).toBe('https://www.googleapis.com/siteVerification/v1/token')
    expect(call.headers.authorization).toBe('Bearer ya29.test')
    expect(JSON.parse(call.body)).toEqual({ site: { type: 'SITE', identifier: SITE }, verificationMethod: 'META' })
  })

  // Google's docs don't say whether `token` is the whole tag or only its value: both work, as do
  // single quotes, spaces around "=", and whitespace around a bare value.
  it('takes a bare value, single quotes and loose spacing too', async () => {
    for (const token of [CODE, ` ${CODE}\n`, `<meta name="google-site-verification" content = "${CODE}" />`, `<meta name='google-site-verification' content='${CODE}'>`, `<meta content =  '${CODE}' name="x">`]) {
      const g = signedIn(() => json({ method: 'META', token }))
      expect(await googleClient(CREDS, { fetcher: g.fetcher }).getMetaToken(SITE), token).toEqual({ ok: true, value: CODE })
    }
  })

  // Google refusing to give a token is its own reason.
  it('says google_token when Google refuses the token', async () => {
    const g = signedIn(() => json({ error: { message: 'no' } }, 403))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).getMetaToken(SITE)).toMatchObject({ ok: false, reason: 'google_token', status: 403 })
  })

  // Only a value the bridge would render is kept: anything else never reaches the database.
  it('refuses a token that is not in the bridge’s shape', async () => {
    for (const token of ['<meta name="google-site-verification" content="x" />', '"><script>', '', 42]) {
      const g = signedIn(() => json({ method: 'META', token }))
      expect(await googleClient(CREDS, { fetcher: g.fetcher }).getMetaToken(SITE), String(token)).toMatchObject({ ok: false, reason: 'google_token' })
    }
  })
})

describe('verify, add, sitemap', () => {
  // Verifying with the owner in the same call makes Sam a (delegated) owner at once.
  it('verifies the site by META with the owner', async () => {
    const g = signedIn(() => json({ id: SITE, owners: ['tapir-search@digital-tapir.iam.gserviceaccount.com', 'sam@example.com'] }))
    const r = await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])
    expect(r).toEqual({ ok: true, value: true })
    const call = g.calls[1]
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META')
    expect(JSON.parse(call.body)).toEqual({ site: { type: 'SITE', identifier: SITE }, owners: ['sam@example.com'] })
  })

  // If Google's answer doesn't list the owner, they're added with an update: Google's list plus them.
  it('adds a missing owner with an update', async () => {
    const id = 'https://www.skeenmusic.com/'
    const g = signedIn((c) => (c.method === 'POST' ? json({ id, owners: ['tapir-search@digital-tapir.iam.gserviceaccount.com'] }) : json({ id, owners: [] })))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['Sam@Example.com'])).toEqual({ ok: true, value: true })
    const put = g.calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe(`https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(id)}`)
    expect(JSON.parse(put.body)).toEqual({ site: { type: 'SITE', identifier: SITE }, owners: ['tapir-search@digital-tapir.iam.gserviceaccount.com', 'Sam@Example.com'] })
  })

  // Google may give the id already encoded: it is encoded once in the path, never twice.
  it('encodes an already-encoded resource id only once', async () => {
    const encoded = encodeURIComponent(SITE)
    const g = signedIn((c) => (c.method === 'POST' ? json({ id: encoded, owners: [] }) : json({ id: encoded })))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])).toEqual({ ok: true, value: true })
    expect(g.calls.find((c) => c.method === 'PUT')!.url).toBe(`https://www.googleapis.com/siteVerification/v1/webResource/${encoded}`)
  })

  // Already listed (any case): no update is sent.
  it('sends no update when the owner is already listed', async () => {
    const g = signedIn(() => json({ id: SITE, owners: ['sam@example.com'] }))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['SAM@example.com'])).toEqual({ ok: true, value: true })
    expect(g.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  // Only real email strings in Google's list count; junk entries are dropped from the update.
  it('ignores non-text entries in Google’s owner list', async () => {
    const g = signedIn((c) => (c.method === 'POST' ? json({ id: SITE, owners: [null, 42, 'robot@x.iam.gserviceaccount.com'] }) : json({ id: SITE })))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])).toEqual({ ok: true, value: true })
    expect(JSON.parse(g.calls.find((c) => c.method === 'PUT')!.body).owners).toEqual(['robot@x.iam.gserviceaccount.com', 'sam@example.com'])
  })

  // No owner list at all in Google's answer: the owner is added.
  it('adds the owner when Google’s answer has no owner list', async () => {
    const g = signedIn((c) => (c.method === 'POST' ? json({ id: SITE }) : json({ id: SITE })))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])).toEqual({ ok: true, value: true })
    expect(JSON.parse(g.calls.find((c) => c.method === 'PUT')!.body).owners).toEqual(['sam@example.com'])
  })

  // Verified but no resource id to add the owner to: said as google_owner, nothing more sent.
  it('says google_owner when Google gives no resource id', async () => {
    const g = signedIn(() => json({ owners: [] }))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])).toMatchObject({ ok: false, reason: 'google_owner', detail: expect.stringContaining('no resource id') })
    expect(g.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  // The owner update refused: its own reason, so the run says the owner is missing.
  it('says google_owner when the owner can’t be added', async () => {
    const g = signedIn((c) => (c.method === 'POST' ? json({ id: SITE, owners: [] }) : json({ error: { message: 'nope' } }, 403)))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).verify(SITE, ['sam@example.com'])).toMatchObject({ ok: false, reason: 'google_owner', status: 403 })
  })

  // The property goes in the robot's Search Console: the site URL is a path segment, encoded.
  it('adds the property', async () => {
    const g = signedIn(() => new Response(null, { status: 204 }))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toEqual({ ok: true, value: true })
    expect(g.calls[1]).toMatchObject({ method: 'PUT', url: 'https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.skeenmusic.com%2F' })
  })

  // The sitemap URL is its own encoded segment.
  it('sends the sitemap', async () => {
    const g = signedIn(() => new Response(null, { status: 204 }))
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).submitSitemap(SITE, `${SITE}sitemap.xml`)).toEqual({ ok: true, value: true })
    expect(g.calls[1]).toMatchObject({
      method: 'PUT',
      url: 'https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.skeenmusic.com%2F/sitemaps/https%3A%2F%2Fwww.skeenmusic.com%2Fsitemap.xml',
    })
  })

  // Each step fails with its own reason, and Google's short message for the operator.
  it('gives each step’s failure its own reason', async () => {
    const refuse = signedIn(() => json({ error: { code: 400, message: 'The necessary verification token could not be found on your site.' } }, 400))
    const client = googleClient(CREDS, { fetcher: refuse.fetcher })
    expect(await client.verify(SITE, [])).toMatchObject({ ok: false, reason: 'google_verify', status: 400, detail: expect.stringContaining('verification token') })
    expect(await client.addSite(SITE)).toMatchObject({ ok: false, reason: 'google_add', status: 400 })
    expect(await client.submitSitemap(SITE, `${SITE}sitemap.xml`)).toMatchObject({ ok: false, reason: 'google_sitemap', status: 400 })
  })

  // Signed in, then the API call itself times out: still google_network, not a refusal.
  it('says google_network when the API call times out after sign-in', async () => {
    const g = signedIn(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    expect(await googleClient(CREDS, { fetcher: g.fetcher }).addSite(SITE)).toMatchObject({ ok: false, reason: 'google_network' })
  })

  // No answer at all is not Google refusing.
  it('says google_network when Google can’t be reached', async () => {
    const down = fakeGoogle(() => {
      throw new TypeError('fetch failed')
    })
    expect(await googleClient(CREDS, { fetcher: down.fetcher }).addSite(SITE)).toMatchObject({ ok: false, reason: 'google_network' })
  })
})
