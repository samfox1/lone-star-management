/**
 * guardedFetch: the ONE way the SEO / GEO tests fetch (STRICT: security, AGENTS.md). Every
 * address it is handed came from a manager or from a document a site served, so each hop is
 * checked before it leaves, and nothing it meets can hang the run, fill the memory, or throw.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSafeFetch } from '@/lib/net-guard'
import { TAPIR_CHECK_UA, guardedFetch } from '@/lib/seo-tests/guarded-fetch'
import { fakeDns } from '@tests/helpers/fake-dns'
import { fakeSite } from '@tests/unit/seo-tests/fake-site'

const SITE = 'https://www.example.com/'

describe('where it will go', () => {
  it('refuses a private first address without sending anything', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://localhost/', 'http://[::1]/', 'https://example.com:8443/', 'file:///etc/passwd']) {
      const f = fakeSite({})
      const r = await guardedFetch(url, { fetcher: f })
      expect([url, r.status, r.error]).toEqual([url, null, 'not-public'])
      expect(f.calls).toHaveLength(0)
    }
  })
  it('refuses a REDIRECT to a private address, and never asks it', async () => {
    const f = fakeSite({ [SITE]: { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } })
    const r = await guardedFetch(SITE, { fetcher: f })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 1, text: null })
    expect(f.calls.map((c) => c.url)).toEqual([SITE])
  })
  it('walks redirects itself (redirect: manual), so every hop is checked', async () => {
    const f = fakeSite({
      'http://example.com/': { status: 301, location: 'https://example.com/' },
      'https://example.com/': { status: 308, location: '/home' },
      'https://example.com/home': 'hello',
    })
    const r = await guardedFetch('http://example.com/', { fetcher: f })
    expect(r).toMatchObject({ status: 200, finalUrl: 'https://example.com/home', hops: 2, text: 'hello' })
    expect(f.calls.every((c) => c.init?.redirect === 'manual')).toBe(true)
  })
  it('stops a redirect loop after 3 hops (4 requests) and says so', async () => {
    const f = fakeSite({
      'https://a.example.com/': { status: 302, location: 'https://b.example.com/' },
      'https://b.example.com/': { status: 302, location: 'https://a.example.com/' },
    })
    const r = await guardedFetch('https://a.example.com/', { fetcher: f })
    expect(r).toMatchObject({ status: null, error: 'too-many-redirects' })
    expect(f.calls).toHaveLength(4)
  })
  it('applies the caller\'s own rule to the first address and to every hop', async () => {
    const onlyExample = (u: string) => new URL(u).hostname.endsWith('example.com')
    const f = fakeSite({ [SITE]: { status: 302, location: 'https://evil.test/' } })
    const r = await guardedFetch(SITE, { fetcher: f, allow: onlyExample })
    expect(r).toMatchObject({ status: null, error: 'not-allowed', hops: 1 })
    expect(f.calls.map((c) => c.url)).toEqual([SITE])
    const g = fakeSite({})
    expect((await guardedFetch('https://evil.test/', { fetcher: g, allow: onlyExample })).error).toBe('not-allowed')
    expect(g.calls).toHaveLength(0)
  })
  it('a redirect with no usable Location is an answer (the 3xx), not a crash', async () => {
    const f = fakeSite({ [SITE]: { status: 302 } })
    expect(await guardedFetch(SITE, { fetcher: f })).toMatchObject({ status: 302, error: 'bad-redirect', text: null })
  })
})

describe('what it sends', () => {
  it('sends exactly the User-Agent it is given, and its own name by default', async () => {
    const f = fakeSite({ [SITE]: 'x' })
    await guardedFetch(SITE, { fetcher: f, userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4)' })
    await guardedFetch(SITE, { fetcher: f })
    expect(f.calls.map((c) => c.ua)).toEqual(['Mozilla/5.0 (compatible; GPTBot/1.4)', TAPIR_CHECK_UA])
  })
})

describe('what it brings back', () => {
  it('keeps the body of a non-2xx answer too (a 403 page is evidence), with lower-cased headers', async () => {
    const f = fakeSite({ [SITE]: { status: 403, body: 'Sorry, you have been blocked', headers: { 'CF-Mitigated': 'challenge', Server: 'cloudflare' } } })
    const r = await guardedFetch(SITE, { fetcher: f })
    expect(r).toMatchObject({ status: 403, text: 'Sorry, you have been blocked', truncated: false })
    expect(r.headers['cf-mitigated']).toBe('challenge')
    expect(r.headers.server).toBe('cloudflare')
  })
  it('cuts an endless body at the cap instead of reading forever', async () => {
    const f = fakeSite({ [SITE]: { endless: true } })
    const t = Date.now()
    const r = await guardedFetch(SITE, { fetcher: f, maxBytes: 200_000 })
    expect(r.status).toBe(200)
    expect(r.truncated).toBe(true)
    expect(r.text).toHaveLength(200_000)
    expect(Date.now() - t).toBeLessThan(2000)
  })
  it('cuts a big (finite) streamed body at the cap', async () => {
    // Without the cap the endless test above never finishes; this one FAILS instead.
    const f = fakeSite({ [SITE]: 'z'.repeat(3_000_000) })
    const r = await guardedFetch(SITE, { fetcher: f, maxBytes: 200_000 })
    expect(r).toMatchObject({ status: 200, truncated: true })
    expect(r.text).toHaveLength(200_000)
  })
  it('caps a body that has no stream too', async () => {
    const big = 'y'.repeat(50_000)
    const fetcher = (async () => ({ status: 200, headers: new Headers(), body: null, arrayBuffer: async () => new TextEncoder().encode(big).buffer })) as unknown as typeof fetch
    const r = await guardedFetch(SITE, { fetcher, maxBytes: 1000 })
    expect(r).toMatchObject({ truncated: true })
    expect(r.text).toHaveLength(1000)
  })
  it('bytes mode returns bytes, not text', async () => {
    const f = fakeSite({ [SITE]: { body: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } } })
    const r = await guardedFetch(SITE, { fetcher: f, as: 'bytes' })
    expect(r.text).toBeNull()
    expect([...(r.bytes ?? [])]).toEqual([137, 80, 78, 71])
  })
})

describe('it never hangs and never throws', () => {
  it('gives up on a server that never answers, at the timeout', async () => {
    const f = fakeSite({ [SITE]: { hang: true } })
    const t = Date.now()
    const r = await guardedFetch(SITE, { fetcher: f, timeoutMs: 100 })
    expect(r).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(1500)
  })
  it('a dropped connection is "network", not an exception', async () => {
    const f = fakeSite({ [SITE]: { fail: true } })
    expect(await guardedFetch(SITE, { fetcher: f })).toMatchObject({ status: null, error: 'network' })
  })
  it('a fetcher that throws something odd is still "network"', async () => {
    const fetcher = (async () => {
      throw 'not even an Error'
    }) as unknown as typeof fetch
    expect(await guardedFetch(SITE, { fetcher })).toMatchObject({ status: null, error: 'network' })
  })
})

/* Where a NAME points (lib/net-guard). Without an injected fetcher, guardedFetch sends through
   net-guard's transport, which judges the address the socket is about to use. The resolver is
   injected so no test touches real DNS. A short timeout keeps a BROKEN guard's run short: it
   would try to connect, and fail as 'timeout' or 'network', never 'not-public'. */
describe('where the NAME points (checked at connect)', () => {
  it('CRITICAL: refuses a name that resolves to the metadata address (the nip.io trick)', async () => {
    const dns = fakeDns({ '169.254.169.254.nip.io': ['169.254.169.254'] })
    const r = await guardedFetch('http://169.254.169.254.nip.io/latest/meta-data/', { resolver: dns, timeoutMs: 500 })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 0, text: null })
    expect(dns.calls).toEqual(['169.254.169.254.nip.io'])
  })

  it('CRITICAL: refuses a name with several addresses when ONE is private', async () => {
    const dns = fakeDns({ 'www.example.com': ['93.184.216.34', '10.0.0.8'] })
    expect(await guardedFetch(SITE, { resolver: dns, timeoutMs: 500 })).toMatchObject({ status: null, error: 'not-public' })
  })

  it('CRITICAL: refuses every private family a record can name (v4, v6, IPv4-mapped, CGNAT, link-local)', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '100.64.0.1', '169.254.1.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe']) {
      const r = await guardedFetch(SITE, { resolver: fakeDns({ 'www.example.com': [ip] }), timeoutMs: 500 })
      expect([ip, r.error]).toEqual([ip, 'not-public'])
    }
  })

  it('CRITICAL: a REDIRECT to a name that resolves privately is refused at connect', async () => {
    const dns = fakeDns({ 'evil.example.com': ['10.0.0.5'] })
    const safe = createSafeFetch({ resolver: dns })
    // The first hop answers from the fake web; every later hop goes through the real transport.
    const site = fakeSite({ [SITE]: { status: 302, location: 'https://evil.example.com/admin' } })
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => (String(input) === SITE ? site(input, init) : safe(input, init))) as typeof fetch
    const r = await guardedFetch(SITE, { fetcher, timeoutMs: 500 })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 1 })
    expect(dns.calls).toEqual(['evil.example.com'])
  })

  it('a name that does not resolve is "network": nothing is sent', async () => {
    const dns = fakeDns({})
    expect(await guardedFetch('https://gone.example.com/', { resolver: dns, timeoutMs: 500 })).toMatchObject({ status: null, error: 'network' })
    expect(dns.calls).toEqual(['gone.example.com'])
  })

  it('CRITICAL: the GLOBAL fetch handed in is not trusted — the guarded transport is used instead', async () => {
    // A caller that passes `fetch` itself (the old live check did) would otherwise resolve the
    // name again, unchecked. It is treated as "no fetcher".
    const spy = vi.fn(async () => new Response('should never be asked'))
    vi.stubGlobal('fetch', spy)
    try {
      const dns = fakeDns({ 'www.example.com': ['169.254.169.254'] })
      const r = await guardedFetch(SITE, { fetcher: globalThis.fetch, resolver: dns, timeoutMs: 500 })
      expect(r.error).toBe('not-public')
      expect(spy).not.toHaveBeenCalled()
      expect(dns.calls).toEqual(['www.example.com'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('numeric-looking hosts are private addresses, refused before any lookup', async () => {
    const dns = fakeDns({})
    for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://１２７.０.０.１/', 'http://[::ffff:7f00:1]/']) {
      expect([url, (await guardedFetch(url, { resolver: dns })).error]).toEqual([url, 'not-public'])
    }
    expect(dns.calls).toEqual([])
  })

  it('IDN: the punycode name is what gets looked up, and judged', async () => {
    const dns = fakeDns({ 'xn--bcher-kva.example.com': ['192.168.1.20'] })
    expect((await guardedFetch('https://bücher.example.com/', { resolver: dns, timeoutMs: 500 })).error).toBe('not-public')
    expect(dns.calls).toEqual(['xn--bcher-kva.example.com'])
  })

  it('a trailing dot changes nothing: the text rule and the lookup both still apply', async () => {
    const dns = fakeDns({ 'evil.example.com.': ['10.9.8.7'] })
    expect((await guardedFetch('http://metadata.google.internal./', { resolver: dns })).error).toBe('not-public')
    expect((await guardedFetch('http://api.localhost./', { resolver: dns })).error).toBe('not-public')
    expect(dns.calls).toEqual([]) // both refused by the text rule, before DNS
    expect((await guardedFetch('https://evil.example.com./', { resolver: dns, timeoutMs: 500 })).error).toBe('not-public')
    expect(dns.calls).toEqual(['evil.example.com.'])
  })
})

describe('the whole call has a deadline', () => {
  const chain = () =>
    fakeSite({
      'https://a.example.com/': { status: 302, location: 'https://b.example.com/', delayMs: 150 },
      'https://b.example.com/': { status: 302, location: 'https://c.example.com/', delayMs: 150 },
      'https://c.example.com/': { body: 'end', delayMs: 150 },
    })

  it('per hop, a slow chain fits (each hop is under its own timeout)…', async () => {
    expect(await guardedFetch('https://a.example.com/', { fetcher: chain(), timeoutMs: 1000 })).toMatchObject({ status: 200, hops: 2, text: 'end' })
  })

  it('…but `deadlineMs` ends the WHOLE call, every hop together', async () => {
    const f = chain()
    const t = Date.now()
    const r = await guardedFetch('https://a.example.com/', { fetcher: f, timeoutMs: 1000, deadlineMs: 250 })
    expect(r).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(450)
    expect(f.calls.length).toBeLessThan(3)
  })

  it('`deadlineMs` also cuts a SINGLE slow hop short, not just the gaps between hops', async () => {
    const f = fakeSite({ [SITE]: { body: 'late', delayMs: 800 } })
    const t = Date.now()
    expect(await guardedFetch(SITE, { fetcher: f, timeoutMs: 2000, deadlineMs: 150 })).toMatchObject({ status: null, error: 'timeout' })
    expect(Date.now() - t).toBeLessThan(600)
  })

  it('a deadline already spent sends nothing', async () => {
    const f = chain()
    expect(await guardedFetch('https://a.example.com/', { fetcher: f, deadlineMs: 0 })).toMatchObject({ status: null, error: 'timeout' })
    expect(await guardedFetch('https://a.example.com/', { fetcher: f, deadlineMs: -5 })).toMatchObject({ status: null, error: 'timeout' })
    expect(f.calls).toHaveLength(0)
  })
})

describe('redirect bodies are let go', () => {
  /** A web whose every answer's body records being cancelled. */
  function recording(routes: Record<string, { status: number; location?: string }>) {
    const cancelled: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      const route = routes[url] ?? { status: 200 }
      const body = new ReadableStream<Uint8Array>({
        pull: (c) => c.enqueue(new TextEncoder().encode('x')),
        cancel: () => {
          cancelled.push(url)
        },
      })
      return new Response(body, { status: route.status, headers: route.location ? { location: route.location } : {} })
    }) as typeof fetch
    return { fetcher, cancelled }
  }

  it('cancels the body of every redirect it walks past, and of a redirect with no Location', async () => {
    const { fetcher, cancelled } = recording({
      'https://a.example.com/': { status: 301, location: 'https://b.example.com/' },
      'https://b.example.com/': { status: 302 },
    })
    expect((await guardedFetch('https://a.example.com/', { fetcher })).error).toBe('bad-redirect')
    expect(cancelled).toEqual(['https://a.example.com/', 'https://b.example.com/'])
  })

  it('a redirect that arrives as a CLONE (a tee) does not hang the walk', async () => {
    // Cancelling one branch of a tee settles only once the other branch is cancelled too, so a
    // walker that AWAITS the cancel waits forever on a cloned response (a caching fetch clones).
    const hop = new Response('moved', { status: 301, headers: { location: 'https://b.example.com/' } })
    const fetcher = (async (input: string | URL | Request) =>
      String(input) === 'https://a.example.com/' ? hop.clone() : new Response('end', { status: 200 })) as typeof fetch
    expect(await guardedFetch('https://a.example.com/', { fetcher })).toMatchObject({ status: 200, text: 'end', hops: 1 })
  }, 3000)

  it('cancels the body of a redirect whose target is then refused', async () => {
    const { fetcher, cancelled } = recording({ 'https://a.example.com/': { status: 302, location: 'http://169.254.169.254/' } })
    expect((await guardedFetch('https://a.example.com/', { fetcher })).error).toBe('not-public')
    expect(cancelled).toEqual(['https://a.example.com/'])
  })
})
