/**
 * A fetch the guard allows behaves like a normal fetch: it sends the right name, headers and
 * body, hands back the answer (unzipped), and turns any failure into a value instead of a crash.
 *
 * Code:     src/lib/net-guard.ts (createSafeFetch: the bridge from node:http to a web Response),
 *           src/lib/seo-tests/guarded-fetch.ts (guardedFetch: what it sends and returns)
 * Feature:  safe fetching: the transport under every server fetch of an outside address
 * Tier:     STRICT (AGENTS.md "Test depth"): security code, and the SEO/GEO checks read their
 *           evidence (a bot's 403 page, a share picture's bytes) from exactly what this returns.
 * Covers:   • connects by NAME (the Host header is the name; the socket goes to the checked address)
 *           • unzips gzip, deflate and brotli; asks for compressed answers unless told otherwise
 *           • HEAD and 204 answers have no body; a Request object, form, byte and text bodies
 *             all work, and a stream body is refused before connecting
 *           • guardedFetch sends exactly the User-Agent it is given, keeps a non-2xx body as
 *             evidence, returns bytes when asked, and reports a dropped connection as `network`
 * Not here: refusals (blocked-before-connecting.test.ts, redirects.test.ts); caps and timeouts
 *           (size-and-time-limits.test.ts).
 * Fixtures: a real loopback server (_loopback-server.ts) reached through a fake DNS
 *           (tests/helpers/fake-dns.ts) with the tests-only `allowLoopback`; the fake web
 *           (tests/unit/seo-tests/fake-site.ts) for guardedFetch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSafeFetch } from '@/lib/net-guard'
import { TAPIR_CHECK_UA, guardedFetch } from '@/lib/seo-tests/guarded-fetch'
import { fakeDns } from '@tests/helpers/fake-dns'
import { fakeSite } from '@tests/unit/seo-tests/fake-site'
import { startLoopbackServer, type LoopbackServer } from '@tests/unit/safe-fetching/_loopback-server'

const SITE = 'https://www.example.com/'

describe('the safe transport (createSafeFetch), against a real server', () => {
  let server: LoopbackServer
  let base = ''
  beforeAll(async () => {
    server = await startLoopbackServer()
    base = `http://site.test:${server.port}`
  })
  afterAll(() => server.close())
  const local = () => createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true })

  // The request goes to the checked address but names the site in its Host header, so the right
  // site answers; status, headers, body and url come back as fetch would give them.
  it('connects by name: the Host header is the name, the socket is the checked address', async () => {
    const r = await local()(`${base}/page?q=1`, { headers: { 'user-agent': 'TapirSiteCheck/1.0' } })
    expect(r.status).toBe(200)
    expect(r.headers.get('x-thing')).toBe('yes')
    expect(await r.text()).toBe('<p>hi</p>')
    expect(r.url).toBe(`${base}/page?q=1`)
    expect(server.lastRequest()).toMatchObject({ method: 'GET', host: `site.test:${server.port}` })
    expect(server.lastRequest()?.headers['user-agent']).toBe('TapirSiteCheck/1.0')
  })

  // Compressed answers are unzipped as fetch does (the encoding header stays); an encoding it
  // does not know is passed through untouched rather than garbled.
  it('unzips gzip, deflate and brotli bodies; leaves an encoding it does not know alone', async () => {
    const gz = await local()(`${base}/gzip`)
    expect(await gz.text()).toBe('hello, unzipped')
    expect(gz.headers.get('content-encoding')).toBe('gzip')
    expect(await (await local()(`${base}/deflate`)).text()).toBe('hello, inflated')
    expect(await (await local()(`${base}/br`)).text()).toBe('hello, unbrotlied')
    expect(await (await local()(`${base}/weird-encoding`)).text()).toBe('left as it came')
  })

  // By default it accepts anything, compressed; a caller's own Accept headers win.
  it('asks for compressed answers and anything, unless the caller says otherwise', async () => {
    await (await local()(`${base}/`)).text()
    expect(server.lastRequest()?.headers).toMatchObject({ accept: '*/*', 'accept-encoding': 'gzip, deflate, br' })
    await (await local()(`${base}/`, { headers: { accept: 'text/html', 'accept-encoding': 'identity' } })).text()
    expect(server.lastRequest()?.headers).toMatchObject({ accept: 'text/html', 'accept-encoding': 'identity' })
  })

  // A HEAD answer and a 204 have no body at all (null), as fetch gives them.
  it('a HEAD answer and a 204 have no body', async () => {
    const head = await local()(`${base}/`, { method: 'head' })
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(server.lastRequest()?.method).toBe('HEAD')
    const empty = await local()(`${base}/empty`)
    expect(empty.status).toBe(204)
    expect(empty.body).toBeNull()
  })

  // A Request object works as the input: its url, method and headers are what is sent.
  it('takes a Request as input: its url, method and headers', async () => {
    const r = await local()(new Request(`${base}/from-request`, { method: 'DELETE', headers: { 'x-from': 'request' } }))
    await r.text()
    expect(server.lastRequest()).toMatchObject({ method: 'DELETE' })
    expect(server.lastRequest()?.headers['x-from']).toBe('request')
  })

  // Text, form, byte and ArrayBuffer bodies are sent with their length (a form gets its type);
  // a stream body is refused before any connection opens.
  it('sends text, form, byte and ArrayBuffer bodies with their length; refuses a stream body before connecting', async () => {
    await (await local()(`${base}/`, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })).text()
    expect(server.lastRequest()).toMatchObject({ method: 'POST', body: '{"a":1}' })
    expect(server.lastRequest()?.headers['content-length']).toBe('7')
    await (await local()(`${base}/`, { method: 'POST', body: new URLSearchParams({ a: '1', b: 'x y' }) })).text()
    expect(server.lastRequest()).toMatchObject({ body: 'a=1&b=x+y' })
    expect(server.lastRequest()?.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
    await (await local()(`${base}/`, { method: 'POST', body: new TextEncoder().encode('bytes!').subarray(1) })).text()
    expect(server.lastRequest()).toMatchObject({ body: 'ytes!' })
    expect(server.lastRequest()?.headers['content-length']).toBe('5')
    expect(server.lastRequest()?.headers['content-type']).toBeUndefined() // the form type is for form bodies only
    await (await local()(`${base}/`, { method: 'POST', body: new TextEncoder().encode('buf').buffer as ArrayBuffer })).text()
    expect(server.lastRequest()).toMatchObject({ body: 'buf' })
    const before = server.connections()
    const err = await local()(`${base}/`, { method: 'POST', body: new ReadableStream() }).catch((e) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(server.connections()).toBe(before)
  })

  // Something that is not an address at all is a TypeError, as fetch gives it.
  it('a nonsense address is a TypeError', async () => {
    expect(await local()('not a url').catch((e) => e)).toBeInstanceOf(TypeError)
  })
})

describe('what the SEO checks’ fetcher sends and returns (guardedFetch)', () => {
  // The bot tests visit as GPTBot, ClaudeBot and the rest: the exact User-Agent given is sent,
  // and Tapir's own check name when none is given.
  it('sends exactly the User-Agent it is given, and its own name by default', async () => {
    const f = fakeSite({ [SITE]: 'x' })
    await guardedFetch(SITE, { fetcher: f, userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4)' })
    await guardedFetch(SITE, { fetcher: f })
    expect(f.calls.map((c) => c.ua)).toEqual(['Mozilla/5.0 (compatible; GPTBot/1.4)', TAPIR_CHECK_UA])
  })

  // A 403 page is evidence (which firewall blocked the bot), so its body and headers are kept,
  // with header names in lower case.
  it('keeps the body of a non-2xx answer too (a 403 page is evidence), with lower-cased headers', async () => {
    const f = fakeSite({ [SITE]: { status: 403, body: 'Sorry, you have been blocked', headers: { 'CF-Mitigated': 'challenge', Server: 'cloudflare' } } })
    const r = await guardedFetch(SITE, { fetcher: f })
    expect(r).toMatchObject({ status: 403, text: 'Sorry, you have been blocked', truncated: false })
    expect(r.headers['cf-mitigated']).toBe('challenge')
    expect(r.headers.server).toBe('cloudflare')
  })

  // Asked for bytes (a share picture), it returns the bytes and no text.
  it('bytes mode returns bytes, not text', async () => {
    const f = fakeSite({ [SITE]: { body: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } } })
    const r = await guardedFetch(SITE, { fetcher: f, as: 'bytes' })
    expect(r.text).toBeNull()
    expect([...(r.bytes ?? [])]).toEqual([137, 80, 78, 71])
  })

  // A dropped connection, or a fetcher that throws something that is not even an Error, is
  // reported as `network`: guardedFetch never throws, so a check says "unknown", never crashes.
  it('a dropped connection, or anything a fetcher throws, is "network", not an exception', async () => {
    expect(await guardedFetch(SITE, { fetcher: fakeSite({ [SITE]: { fail: true } }) })).toMatchObject({ status: null, error: 'network' })
    const odd = (async () => {
      throw 'not even an Error'
    }) as unknown as typeof fetch
    expect(await guardedFetch(SITE, { fetcher: odd })).toMatchObject({ status: null, error: 'network' })
  })
})
