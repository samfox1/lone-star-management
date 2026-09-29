/**
 * Every SERVER-side fetch of an address a manager (or a site's own documents) supplied goes
 * through lib/net-guard by DEFAULT (STRICT: security, AGENTS.md "Test depth").
 *
 * The finding (2026-09-29): the text guard `isPublicSiteUrl` never looked up where a name
 * points, and the production callers handed the name to the GLOBAL fetch, which resolves it
 * again, unchecked. A name like `169.254.169.254.nip.io` reached the metadata service.
 *
 * How these bite: DNS is mocked (node:dns/promises, the module net-guard's system resolver
 * and lib/og's pre-check both read) to answer PRIVATE, and the global fetch is replaced by a
 * spy. A caller still on the global fetch calls the spy; a caller on the guarded transport
 * asks the mocked DNS and is refused before any socket opens. No real network either way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { auditLiveSite, fetchGuarded } from '@/lib/seo-audit'
import { pingIndexNow } from '@/lib/indexnow'
import { fetchOpenGraph } from '@/lib/og'
import { gatherSiteEvidence } from '@/lib/seo-tests/evidence'
import { createSafeFetch } from '@/lib/net-guard'
import { fakeDns } from '@tests/helpers/fake-dns'

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

describe('fetchGuarded (lib/seo-audit)', () => {
  it('CRITICAL: with no fetcher, a name that resolves privately is not fetched', async () => {
    expect(await fetchGuarded(`${ORIGIN}/`)).toEqual({ status: null, body: null })
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toEqual([HOST])
  })

  it('CRITICAL: handed the global fetch itself, it still uses the guarded transport', async () => {
    expect(await fetchGuarded(`${ORIGIN}/`, globalThis.fetch)).toEqual({ status: null, body: null })
    expect(spy).not.toHaveBeenCalled()
  })

  it('CRITICAL: a redirect to a name that resolves privately is refused at connect (injected resolver)', async () => {
    const dns = fakeDns({ 'evil.example.com': ['10.0.0.5'] })
    const safe = createSafeFetch({ resolver: dns })
    const first = new Response('moved', { status: 302, headers: { location: 'https://evil.example.com/' } })
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => (String(input) === `${ORIGIN}/` ? Promise.resolve(first) : safe(input, init))) as typeof fetch
    expect(await fetchGuarded(`${ORIGIN}/`, fetcher)).toEqual({ status: null, body: null })
    expect(dns.calls).toEqual(['evil.example.com'])
  })

  it('the resolver option reaches the default transport', async () => {
    const dns = fakeDns({ [HOST]: ['93.184.216.34', '::1'] })
    expect(await fetchGuarded(`${ORIGIN}/`, undefined, { resolver: dns })).toEqual({ status: null, body: null })
    expect(dns.calls).toEqual([HOST])
    expect(dnsState.calls).toEqual([]) // the system resolver was not asked
  })

  it('a cloned redirect or non-2xx answer (a tee) does not hang it', async () => {
    const moved = new Response('moved', { status: 301, headers: { location: `${ORIGIN}/home` } })
    const missing = new Response('nope', { status: 404 })
    const fetcher = (async (input: string | URL | Request) => (String(input) === `${ORIGIN}/` ? moved.clone() : missing.clone())) as typeof fetch
    expect(await fetchGuarded(`${ORIGIN}/`, fetcher)).toMatchObject({ status: 404, body: null })
  }, 3000)

  it('lets go of the body of a redirect and of a non-2xx answer', async () => {
    const cancelled: string[] = []
    const res = (url: string, status: number, location?: string) =>
      new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array([120])), cancel: () => void cancelled.push(url) }), {
        status,
        headers: location ? { location } : {},
      })
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      return url === `${ORIGIN}/` ? res(url, 301, `${ORIGIN}/home`) : res(url, 404)
    }) as typeof fetch
    expect(await fetchGuarded(`${ORIGIN}/`, fetcher)).toMatchObject({ status: 404, body: null })
    expect(cancelled).toEqual([`${ORIGIN}/`, `${ORIGIN}/home`])
  })
})

describe('the production callers default to the guarded transport', () => {
  it('CRITICAL: the old live check (auditLiveSite), called the way the action calls it', async () => {
    // actions.ts passes `fetch` itself.
    const r = await auditLiveSite(ORIGIN, fetch)
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(r.ok).toBe(false)
  })

  it('CRITICAL: the IndexNow ping (key file + sitemap reads) with no fetcher', async () => {
    const r = await pingIndexNow({ site_kind: 'custom', custom_site_url: `${ORIGIN}/` }, '0123456789abcdef0123456789abcdef')
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(r).toMatchObject({ sent: false, reason: 'key-not-served' })
  })

  it('CRITICAL: the SEO tests’ site visit (gatherSiteEvidence) with no fetcher', async () => {
    const e = await gatherSiteEvidence(ORIGIN, { maxPaths: 1, timeoutMs: 500, budgetMs: 2000 })
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toContain(HOST)
    expect(e.plain[0]).toMatchObject({ path: '/', status: null, html: null })
    expect(e.plain[0].error).toMatch(/^not-public/)
  })

  it('CRITICAL: the Add modal’s link preview (fetchOpenGraph) closes DNS rebinding', async () => {
    // lib/og checks the name first (answer 1: public), then fetches. The fetch's own lookup
    // (answer 2: private) is the one a socket would use, and it is refused.
    dnsState.answers = { 'shop.example-artist.com': (n) => (n === 1 ? ['93.184.216.34'] : ['127.0.0.1']) }
    expect(await fetchOpenGraph('https://shop.example-artist.com/product')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(dnsState.calls).toEqual(['shop.example-artist.com', 'shop.example-artist.com'])
  })
})
