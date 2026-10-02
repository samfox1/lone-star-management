/**
 * Redirects are followed by hand, one hop at a time, so every hop is checked like the first
 * address; a redirect loop ends, and each redirect's body is let go.
 *
 * Code:     src/lib/net-guard.ts (createSafeFetch never follows), src/lib/guarded-fetch.ts
 *           (guardedFetch walks the hops)
 * Feature:  safe fetching: every server fetch of an outside address (SEO/GEO checks, IndexNow)
 * Tier:     STRICT (AGENTS.md "Test depth"): security. A public site can answer 302 to
 *           `http://169.254.169.254/`, so a fetcher that follows redirects on its own undoes
 *           every check on the first address.
 * Covers:   • the safe transport hands a 3xx back instead of following it
 *           • a redirect to a private address, or to a name that resolves privately, is refused
 *             and never asked
 *           • the caller's own rule (same site only, say) applies to every hop
 *           • at most 3 hops, then "too many redirects"; a redirect with no usable Location is
 *             an answer, not a crash
 *           • the body of every redirect walked past is cancelled, and a cloned response does
 *             not hang the walk
 * Not here: the refusal of a private FIRST address (blocked-before-connecting.test.ts); the
 *           time limit on a slow chain of hops (size-and-time-limits.test.ts).
 * Fixtures: a fake web (tests/helpers/seo/fake-site.ts) that follows redirects itself unless
 *           told `redirect: 'manual'`, so dropping that option fails a test; hand-made responses
 *           whose bodies record being cancelled; a fake DNS (tests/helpers/fake-dns.ts); a real
 *           loopback server for the transport (_loopback-server.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSafeFetch } from '@/lib/net-guard'
import { guardedFetch } from '@/lib/guarded-fetch'
import { fakeDns } from '@tests/helpers/fake-dns'
import { fakeSite } from '@tests/helpers/seo/fake-site'
import { startLoopbackServer, type LoopbackServer } from '@tests/unit/safe-fetching/_loopback-server'

const SITE = 'https://www.example.com/'

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

describe('the safe transport never follows a redirect itself', () => {
  let server: LoopbackServer
  beforeAll(async () => {
    server = await startLoopbackServer()
  })
  afterAll(() => server.close())

  // Even asked to follow, it hands the 3xx and its Location back, so the caller checks the next hop.
  it('returns the 3xx with its Location, even when asked to follow', async () => {
    const f = createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true })
    const r = await f(`http://site.test:${server.port}/redirect`, { redirect: 'follow' })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('http://evil.example/')
    await r.body?.cancel()
  })
})

describe('every hop is checked (guardedFetch)', () => {
  // A public page that redirects to the metadata address: refused, and the metadata address is
  // never asked.
  it('CRITICAL: refuses a redirect to a private address, and never asks it', async () => {
    const f = fakeSite({ [SITE]: { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } })
    const r = await guardedFetch(SITE, { fetcher: f })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 1, text: null })
    expect(f.calls.map((c) => c.url)).toEqual([SITE])
  })

  // A redirect to a NAME that resolves privately is refused when the transport connects: the
  // first hop comes from the fake web, the second goes through the real safe transport.
  it('CRITICAL: a redirect to a name that resolves privately is refused at connect', async () => {
    const dns = fakeDns({ 'evil.example.com': ['10.0.0.5'] })
    const safe = createSafeFetch({ resolver: dns })
    const site = fakeSite({ [SITE]: { status: 302, location: 'https://evil.example.com/admin' } })
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => (String(input) === SITE ? site(input, init) : safe(input, init))) as typeof fetch
    const r = await guardedFetch(SITE, { fetcher, timeoutMs: 500 })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 1 })
    expect(dns.calls).toEqual(['evil.example.com'])
  })

  // Every request is sent with `redirect: 'manual'`, and a normal chain (http → https → /home)
  // still arrives, two hops later.
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

  // Two pages redirecting to each other stop after 3 hops (4 requests), with a reason.
  it('stops a redirect loop after 3 hops (4 requests) and says so', async () => {
    const f = fakeSite({
      'https://a.example.com/': { status: 302, location: 'https://b.example.com/' },
      'https://b.example.com/': { status: 302, location: 'https://a.example.com/' },
    })
    const r = await guardedFetch('https://a.example.com/', { fetcher: f })
    expect(r).toMatchObject({ status: null, error: 'too-many-redirects' })
    expect(f.calls).toHaveLength(4)
  })

  // The caller's own rule (here: example.com only) is applied to the first address and to
  // every redirect target, before anything is sent to it.
  it("applies the caller's own rule to the first address and to every hop", async () => {
    const onlyExample = (u: string) => new URL(u).hostname.endsWith('example.com')
    const f = fakeSite({ [SITE]: { status: 302, location: 'https://evil.test/' } })
    const r = await guardedFetch(SITE, { fetcher: f, allow: onlyExample })
    expect(r).toMatchObject({ status: null, error: 'not-allowed', hops: 1 })
    expect(f.calls.map((c) => c.url)).toEqual([SITE])
    const g = fakeSite({})
    expect((await guardedFetch('https://evil.test/', { fetcher: g, allow: onlyExample })).error).toBe('not-allowed')
    expect(g.calls).toHaveLength(0)
  })

  // A 3xx with no Location to follow is reported as that answer (`bad-redirect`), not a crash.
  it('a redirect with no usable Location is an answer (the 3xx), not a crash', async () => {
    const f = fakeSite({ [SITE]: { status: 302 } })
    expect(await guardedFetch(SITE, { fetcher: f })).toMatchObject({ status: 302, error: 'bad-redirect', text: null })
  })
})

describe('redirect bodies are let go', () => {
  // Each redirect's body is cancelled as the walk moves on, so no connection is left half-read,
  // including a redirect with no Location.
  it('cancels the body of every redirect it walks past, and of a redirect with no Location', async () => {
    const { fetcher, cancelled } = recording({
      'https://a.example.com/': { status: 301, location: 'https://b.example.com/' },
      'https://b.example.com/': { status: 302 },
    })
    expect((await guardedFetch('https://a.example.com/', { fetcher })).error).toBe('bad-redirect')
    expect(cancelled).toEqual(['https://a.example.com/', 'https://b.example.com/'])
  })

  // Cancelling one copy of a cloned response only settles once the other copy is cancelled too,
  // so a walker that WAITS for the cancel hangs forever on a clone (a caching fetch clones).
  it('a redirect that arrives as a clone does not hang the walk', async () => {
    const hop = new Response('moved', { status: 301, headers: { location: 'https://b.example.com/' } })
    const fetcher = (async (input: string | URL | Request) =>
      String(input) === 'https://a.example.com/' ? hop.clone() : new Response('end', { status: 200 })) as typeof fetch
    expect(await guardedFetch('https://a.example.com/', { fetcher })).toMatchObject({ status: 200, text: 'end', hops: 1 })
  }, 3000)

  // A redirect whose target is then refused still has its own body let go.
  it('cancels the body of a redirect whose target is then refused', async () => {
    const { fetcher, cancelled } = recording({ 'https://a.example.com/': { status: 302, location: 'http://169.254.169.254/' } })
    expect((await guardedFetch('https://a.example.com/', { fetcher })).error).toBe('not-public')
    expect(cancelled).toEqual(['https://a.example.com/'])
  })
})
