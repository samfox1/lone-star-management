/**
 * guardedFetch: the ONE way the SEO / GEO tests fetch (STRICT: security, AGENTS.md). Every
 * address it is handed came from a manager or from a document a site served, so each hop is
 * checked before it leaves, and nothing it meets can hang the run, fill the memory, or throw.
 */
import { describe, expect, it } from 'vitest'
import { TAPIR_CHECK_UA, guardedFetch } from '@/lib/seo-tests/guarded-fetch'
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
