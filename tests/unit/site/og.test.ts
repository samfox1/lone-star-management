// Reading Open Graph tags off a page for the merch Add modal, behind an SSRF gate.
/**
 * Open-Graph scraping for the merch "Add" modal's Automatic mode. parseOpenGraph is
 * a pure function over HTML; isPublicHttpUrl is the SSRF gate (public http(s) only);
 * fetchOpenGraph ties them together with a size/time cap. All mocked at the fetch
 * boundary — no network.
 */
import { describe, expect, it, vi } from 'vitest'
import { parseOpenGraph, isPublicHttpUrl, fetchOpenGraph } from '@/lib/og'

describe('parseOpenGraph', () => {
  it('pulls title / image / price from OG meta (attribute order-insensitive)', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Tour Tee 2025" />
        <meta content="https://cdn.example/tee.jpg" property="og:image">
        <meta property="og:price:amount" content="32.00" />
        <title>Store — ignored when og:title present</title>
      </head></html>`
    expect(parseOpenGraph(html)).toEqual({
      title: 'Tour Tee 2025',
      image: 'https://cdn.example/tee.jpg',
      price: '32',
    })
  })

  it('falls back to twitter card + <title>, decodes entities, drops a non-numeric price', () => {
    const html = `
      <head>
        <meta name="twitter:image" content="https://cdn.example/x.png">
        <meta property="product:price:amount" content="Sold out">
        <title>Bandana &amp; Hat</title>
      </head>`
    expect(parseOpenGraph(html)).toEqual({
      title: 'Bandana & Hat',
      image: 'https://cdn.example/x.png',
      price: null,
    })
  })

  it('returns nulls for a page with no usable tags', () => {
    expect(parseOpenGraph('<html><body>nothing</body></html>')).toEqual({ title: null, image: null, price: null })
  })
})

describe('isPublicHttpUrl (SSRF gate)', () => {
  it('allows public http(s) URLs', () => {
    expect(isPublicHttpUrl('https://shop.example.com/item')).toBe(true)
    expect(isPublicHttpUrl('http://example.org')).toBe(true)
  })

  it('blocks non-http schemes, credentials, localhost and private/link-local IPs', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isPublicHttpUrl('ftp://example.com')).toBe(false)
    expect(isPublicHttpUrl('http://user:pass@example.com')).toBe(false)
    expect(isPublicHttpUrl('http://localhost:3000')).toBe(false)
    expect(isPublicHttpUrl('http://127.0.0.1')).toBe(false)
    expect(isPublicHttpUrl('http://10.0.0.5')).toBe(false)
    expect(isPublicHttpUrl('http://192.168.1.1')).toBe(false)
    expect(isPublicHttpUrl('http://172.16.0.9')).toBe(false)
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false) // cloud metadata
    expect(isPublicHttpUrl('http://printer.local')).toBe(false)
    expect(isPublicHttpUrl('not a url')).toBe(false)
  })

  it('blocks IPv6 loopback / link-local / ULA and IPv4-mapped IPv6 literals', () => {
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false)
    expect(isPublicHttpUrl('http://[fe80::1]/')).toBe(false)
    expect(isPublicHttpUrl('http://[fd00::1]/')).toBe(false)
    expect(isPublicHttpUrl('http://[::ffff:169.254.169.254]/')).toBe(false) // v4-mapped metadata
  })
})

describe('fetchOpenGraph', () => {
  // Public-host tests inject a lookup stub so they never hit real DNS.
  const publicLookup = async () => ['93.184.216.34']

  it('fetches a public URL and parses its OG tags', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<meta property="og:title" content="Vinyl LP">',
    })) as unknown as typeof fetch
    const og = await fetchOpenGraph('https://shop.example.com/lp', { fetchImpl, lookup: publicLookup })
    expect(og).toEqual({ title: 'Vinyl LP', image: null, price: null })
  })

  it('refuses to fetch a blocked (private) URL — never calls fetch', async () => {
    const fetchImpl = vi.fn()
    const og = await fetchOpenGraph('http://169.254.169.254/', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(og).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('CRITICAL: blocks a hostname that RESOLVES to a private IP (DNS to internal)', async () => {
    const fetchImpl = vi.fn()
    // hostname looks public but resolves to the metadata IP
    const og = await fetchOpenGraph('https://evil.example.com/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => ['169.254.169.254'],
    })
    expect(og).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns null for a non-HTML response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '{}',
    })) as unknown as typeof fetch
    expect(await fetchOpenGraph('https://api.example.com/x', { fetchImpl, lookup: publicLookup })).toBeNull()
  })

  it('CRITICAL: does not follow a redirect to an internal host (SSRF via redirect)', async () => {
    let hitInternal = false
    const fetchImpl = vi.fn(async (u: string) => {
      if (u.includes('169.254.169.254')) {
        hitInternal = true
        return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<meta property="og:title" content="secret">' } as unknown as Response
      }
      // public URL 302s to the cloud-metadata endpoint
      return { ok: false, status: 302, headers: { get: (k: string) => (k.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data' : null) }, text: async () => '' } as unknown as Response
    })
    const og = await fetchOpenGraph('https://shop.example.com/item', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: async () => ['93.184.216.34'],
    })
    expect(og).toBeNull()
    expect(hitInternal).toBe(false) // never fetched the internal host
  })
})
