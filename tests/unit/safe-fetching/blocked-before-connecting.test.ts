/**
 * A fetch to a private address is refused before any connection opens, whichever server code
 * sends it, including a name that looked public a moment earlier (DNS rebinding).
 *
 * Code:     src/lib/net-guard.ts (createSafeFetch, pickTransport), src/lib/seo-tests/guarded-fetch.ts
 *           (guardedFetch), src/lib/seo-audit.ts (fetchGuarded, auditLiveSite), src/lib/indexnow.ts
 *           (pingIndexNow), src/lib/seo-tests/evidence.ts (gatherSiteEvidence), src/lib/og.ts
 *           (fetchOpenGraph)
 * Feature:  safe fetching: the SEO/GEO checks' site visit, the old live check, the IndexNow ping,
 *           and the Add modal's link preview
 * Tier:     STRICT (AGENTS.md "Test depth"): security. The text check alone let
 *           `169.254.169.254.nip.io` reach the cloud metadata service (security review
 *           2026-09-29), because callers handed the name to the global fetch, which resolves it
 *           again, unchecked.
 * Covers:   • the safe transport looks the name up itself and refuses a private answer before a
 *             socket opens, a private IP typed as the host too, and a name that answers public
 *             first and private at connect
 *           • it sends nothing for a name that does not resolve, a non-web scheme, or a
 *             user:password@ address
 *           • the SEO checks' fetcher refuses a private address as `not-public`, and never
 *             trusts the global fetch handed to it
 *           • every production caller (old live check, IndexNow, the SEO site visit, link
 *             previews) uses the safe transport by default
 * Not here: which addresses count as private (private-addresses.test.ts); redirects to a private
 *           address (redirects.test.ts); what a fetch that IS allowed sends and brings back
 *           (requests-and-answers.test.ts).
 * Fixtures: no real network. A real loopback server counts connections (_loopback-server.ts), so
 *           "refused" means no socket reached it. Names resolve through a fake DNS
 *           (tests/helpers/fake-dns.ts); for the callers that use the system resolver,
 *           node:dns/promises is mocked to answer PRIVATE, and the global fetch is a spy that
 *           must never be called.
 */
import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dnsState = vi.hoisted(() => ({
  answers: {} as Record<string, string[] | ((n: number) => string[])>,
  calls: [] as string[],
}))

vi.mock('node:dns/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:dns/promises')>()
  const lookup = async (host: string, opts?: { all?: boolean }) => {
    // The guard judges EVERY address, so it must ask for all of them.
    if (opts?.all !== true) throw new Error('net-guard must look up with { all: true }')
    dnsState.calls.push(host)
    const v = dnsState.answers[host]
    if (!v) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    const list = typeof v === 'function' ? v(dnsState.calls.filter((c) => c === host).length) : v
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  return { ...real, lookup, default: { ...real, lookup } }
})

import { createSafeFetch, isBlockedAddressError, resolvePublic } from '@/lib/net-guard'
import { guardedFetch } from '@/lib/seo-tests/guarded-fetch'
import { auditLiveSite, fetchGuarded } from '@/lib/seo-audit'
import { pingIndexNow } from '@/lib/indexnow'
import { fetchOpenGraph } from '@/lib/og'
import { gatherSiteEvidence } from '@/lib/seo-tests/evidence'
import { fakeDns } from '@tests/helpers/fake-dns'
import { fakeSite } from '@tests/unit/seo-tests/fake-site'
import { startLoopbackServer, type LoopbackServer } from '@tests/unit/safe-fetching/_loopback-server'

const SITE = 'https://www.example.com/'

describe('the safe transport (createSafeFetch)', () => {
  let server: LoopbackServer
  beforeAll(async () => {
    server = await startLoopbackServer()
  })
  afterAll(() => server.close())

  // The loopback server really is reachable, so "no connection" in the tests below means the
  // guard stopped it, not that the server was never there.
  it('witness: the loopback server really is reachable', async () => {
    const before = server.connections()
    await new Promise<void>((resolve, reject) => http.get(`http://127.0.0.1:${server.port}/`, (res) => res.resume().on('end', resolve)).on('error', reject))
    expect(server.connections()).toBe(before + 1)
  })

  // A name that resolves to a private address is refused after one lookup, with no socket opened.
  it('CRITICAL: a name that resolves to a private address is refused before any socket opens', async () => {
    const before = server.connections()
    const dns = fakeDns({ 'site.test': ['127.0.0.1'] })
    const err = await createSafeFetch({ resolver: dns })(`http://site.test:${server.port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['site.test'])
    expect(server.connections()).toBe(before)
  })

  // DNS rebinding: a name answers PUBLIC to an earlier check and PRIVATE when the socket asks.
  // Only the check the socket itself uses sees the second answer, and it refuses.
  it('CRITICAL: a name that answered public to an earlier check and private at connect is refused', async () => {
    const before = server.connections()
    const dns = fakeDns({ 'rebind.test': (n) => (n === 1 ? ['93.184.216.34'] : ['127.0.0.1']) })
    // The first answer is what a check-then-fetch caller (lib/og) sees; the second is the one
    // the socket would use.
    expect(await resolvePublic('rebind.test', dns)).toEqual([{ address: '93.184.216.34', family: 4 }])
    const err = await createSafeFetch({ resolver: dns })(`http://rebind.test:${server.port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['rebind.test', 'rebind.test'])
    expect(server.connections()).toBe(before)
  })

  // A private IP written as the host (in any spelling Node accepts) never reaches a lookup, so
  // the transport judges it itself before connecting.
  it('CRITICAL: a private IP typed as the host is refused before any socket opens, with no lookup', async () => {
    const before = server.connections()
    const dns = fakeDns({})
    for (const url of [`http://127.0.0.1:${server.port}/`, `http://[::ffff:127.0.0.1]:${server.port}/`, `http://2130706433:${server.port}/`, `http://0x7f.1:${server.port}/`]) {
      const err = await createSafeFetch({ resolver: dns })(url).catch((e) => e)
      expect(isBlockedAddressError(err), url).toBe(true)
    }
    expect(dns.calls).toEqual([])
    expect(server.connections()).toBe(before)
  })

  // A name that does not resolve sends nothing, and the caller gets the DNS error.
  it('a lookup that fails sends nothing and rejects with the DNS error', async () => {
    const before = server.connections()
    const err = await createSafeFetch({ resolver: fakeDns({}) })(`http://localhost:${server.port}/`).catch((e) => e)
    expect((err as { code?: string }).code).toBe('ENOTFOUND')
    expect(server.connections()).toBe(before)
  })

  // An international name (bücher.test) is looked up in its ASCII form (xn--…), and judged like
  // any other name.
  it('an international name is looked up in its punycode form, and judged like any other', async () => {
    const dns = fakeDns({ 'xn--bcher-kva.test': ['127.0.0.1'] })
    const err = await createSafeFetch({ resolver: dns })(`http://bücher.test:${server.port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['xn--bcher-kva.test'])
  })

  // Only http(s) is fetched, and never an address carrying a user name or password.
  it('refuses anything but http(s), and credentials in the address', async () => {
    const f = createSafeFetch({ resolver: fakeDns({}) })
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'http://user:pw@example.com/', 'http://user@example.com/', 'http://:pw@example.com/']) {
      expect(await f(url).catch((e) => e), url).toBeInstanceOf(TypeError)
    }
  })

  // The tests-only loopback hatch opens loopback and nothing else: the metadata address and
  // private ranges stay refused even with it on.
  it('allowLoopback (tests only) opens loopback and nothing else', async () => {
    for (const ip of ['10.0.0.1', '169.254.169.254', '::ffff:10.0.0.1']) {
      const f = createSafeFetch({ resolver: fakeDns({ 'x.test': [ip] }), allowLoopback: true })
      expect(isBlockedAddressError(await f(`http://x.test:${server.port}/`).catch((e) => e)), ip).toBe(true)
    }
  })
})

/* Without an injected fetcher, guardedFetch sends through the safe transport, which judges the
   address the socket is about to use. A short timeout keeps a BROKEN guard's run short: it would
   try to connect and fail as 'timeout' or 'network', never 'not-public'. */
describe('the SEO checks’ fetcher (guardedFetch)', () => {
  // A private first address (by its text: the metadata IP, localhost, an odd port, a file) is
  // answered `not-public` and nothing is sent at all.
  it('refuses a private first address without sending anything', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://localhost/', 'http://[::1]/', 'https://example.com:8443/', 'file:///etc/passwd']) {
      const f = fakeSite({})
      const r = await guardedFetch(url, { fetcher: f })
      expect([url, r.status, r.error]).toEqual([url, null, 'not-public'])
      expect(f.calls).toHaveLength(0)
    }
  })

  // The nip.io trick through the whole SEO fetcher: `not-public`, after exactly one lookup.
  it('CRITICAL: refuses a name that resolves to the metadata address (the nip.io trick)', async () => {
    const dns = fakeDns({ '169.254.169.254.nip.io': ['169.254.169.254'] })
    const r = await guardedFetch('http://169.254.169.254.nip.io/latest/meta-data/', { resolver: dns, timeoutMs: 500 })
    expect(r).toMatchObject({ status: null, error: 'not-public', hops: 0, text: null })
    expect(dns.calls).toEqual(['169.254.169.254.nip.io'])
  })

  // Every private family a DNS record can name (IPv4, IPv6, IPv4 inside IPv6, carrier NAT,
  // link-local), alone or next to a public address, comes back `not-public` through the real
  // transport.
  it('CRITICAL: refuses a name whose record names any private address, alone or among public ones', async () => {
    for (const list of [
      ['127.0.0.1'], ['10.1.2.3'], ['100.64.0.1'], ['169.254.1.1'], ['::1'], ['fe80::1'], ['fd00::1'],
      ['::ffff:127.0.0.1'], ['::ffff:a9fe:a9fe'], ['64:ff9b::a9fe:a9fe'],
      ['93.184.216.34', '10.0.0.8'],
    ]) {
      const r = await guardedFetch(SITE, { resolver: fakeDns({ 'www.example.com': list }), timeoutMs: 500 })
      expect([list.join(' '), r.error]).toEqual([list.join(' '), 'not-public'])
    }
  })

  // A name that does not resolve is a plain `network` failure (the check then says "unknown"),
  // and nothing is sent.
  it('a name that does not resolve is "network": nothing is sent', async () => {
    const dns = fakeDns({})
    expect(await guardedFetch('https://gone.example.com/', { resolver: dns, timeoutMs: 500 })).toMatchObject({ status: null, error: 'network' })
    expect(dns.calls).toEqual(['gone.example.com'])
  })

  // A caller that passes the global `fetch` (the old live check did) would resolve the name
  // again, unchecked: it is treated as "no fetcher" and the safe transport is used instead.
  it('CRITICAL: the global fetch handed in is not trusted: the safe transport is used instead', async () => {
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

  // Hosts that are really 127.0.0.1 in disguise (decimal, hex, octal, full-width digits,
  // mapped IPv6) are refused by their text, before any lookup.
  it('numeric-looking hosts are private addresses, refused before any lookup', async () => {
    const dns = fakeDns({})
    for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://１２７.０.０.１/', 'http://[::ffff:7f00:1]/']) {
      expect([url, (await guardedFetch(url, { resolver: dns })).error]).toEqual([url, 'not-public'])
    }
    expect(dns.calls).toEqual([])
  })
})

describe('every server caller uses the safe transport by default', () => {
  const HOST = 'www.example-artist.com'
  const ORIGIN = `https://${HOST}`
  let spy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    dnsState.answers = { [HOST]: ['169.254.169.254'] }
    dnsState.calls = []
    spy = vi.fn(async () => new Response('<html>the global fetch was used</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', spy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // fetchGuarded with no fetcher asks the system DNS (all addresses) and, told "private",
  // fetches nothing.
  it('CRITICAL: fetchGuarded with no fetcher does not fetch a name that resolves privately', async () => {
    expect(await fetchGuarded(`${ORIGIN}/`)).toEqual({ status: null, body: null })
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toEqual([HOST])
  })

  // A resolver handed to fetchGuarded reaches the safe transport (and the system DNS is not asked).
  it('fetchGuarded passes its resolver option to the safe transport', async () => {
    const dns = fakeDns({ [HOST]: ['93.184.216.34', '::1'] })
    expect(await fetchGuarded(`${ORIGIN}/`, undefined, { resolver: dns })).toEqual({ status: null, body: null })
    expect(dns.calls).toEqual([HOST])
    expect(dnsState.calls).toEqual([])
  })

  // The old live check, called exactly as its action calls it (with `fetch` itself), still
  // goes through the safe transport.
  it('CRITICAL: the old live check (auditLiveSite), called the way the action calls it', async () => {
    const r = await auditLiveSite(ORIGIN, fetch)
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(r.ok).toBe(false)
  })

  // The IndexNow ping reads the site's key file and sitemap: both go through the safe transport.
  it('CRITICAL: the IndexNow ping (key file + sitemap reads) with no fetcher', async () => {
    const r = await pingIndexNow({ site_kind: 'custom', custom_site_url: `${ORIGIN}/` }, '0123456789abcdef0123456789abcdef')
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(r).toMatchObject({ sent: false, reason: 'key-not-served' })
  })

  // The SEO checks' site visit records the page as not fetched, with the `not-public` reason.
  it('CRITICAL: the SEO checks’ site visit (gatherSiteEvidence) with no fetcher', async () => {
    const e = await gatherSiteEvidence(ORIGIN, { maxPaths: 1, timeoutMs: 500, budgetMs: 2000 })
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(e.plain[0]).toMatchObject({ path: '/', status: null, html: null })
    expect(e.plain[0].error).toMatch(/^not-public/)
  })

  // The Add modal's link preview checks the name first (answer 1: public), then fetches; the
  // fetch's own lookup (answer 2: private) is the one a socket would use, and it is refused.
  it('CRITICAL: the Add modal’s link preview (fetchOpenGraph) closes DNS rebinding', async () => {
    dnsState.answers = { 'shop.example-artist.com': (n) => (n === 1 ? ['93.184.216.34'] : ['127.0.0.1']) }
    expect(await fetchOpenGraph('https://shop.example-artist.com/product')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toEqual(['shop.example-artist.com', 'shop.example-artist.com'])
  })
})
