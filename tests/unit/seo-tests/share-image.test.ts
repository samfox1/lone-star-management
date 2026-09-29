/**
 * The share picture: found in the LIVE home page, fetched through guardedFetch (https only,
 * capped), measured from the file's own header bytes. A fetch of an address a page names is
 * a security edge, and the header readers are parsers: strict, mocked fetcher, no network.
 */
import { describe, expect, it, vi } from 'vitest'
import { fetchShareImage, readImageHeader, SHARE_MAX_BYTES } from '@/lib/seo-tests/share-image'

const ORIGIN = 'https://www.example-artist.com'

/* ── real header bytes ── */
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >>> 8) & 255]
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function png(w: number, h: number, extra = 40): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...ascii('IHDR'), ...u32(w), ...u32(h), 8, 6, 0, 0, 0, ...new Array(extra).fill(0)])
}
function gif(w: number, h: number): Uint8Array {
  return new Uint8Array([...ascii('GIF89a'), ...le16(w), ...le16(h), 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b])
}
/** SOI, an APP0 (JFIF) segment, a few fill bytes, then a baseline (C0) or progressive (C2) SOF. */
function jpeg(w: number, h: number, sof = 0xc0, cut = false): Uint8Array {
  const app0 = [0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const sofSeg = [0xff, 0xff, 0xff, sof, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app0, ...(cut ? [] : sofSeg), 0xff, 0xd9])
}
function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', w: number, h: number): Uint8Array {
  const head = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(kind), 0, 0, 0, 0]
  if (kind === 'VP8 ') return new Uint8Array([...head, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0])
  if (kind === 'VP8L') {
    const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)
    return new Uint8Array([...head, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0])
  }
  return new Uint8Array([...head, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 0, 0])
}

describe('readImageHeader', () => {
  it('reads PNG, GIF, JPEG (baseline and progressive) and all three WebP kinds', () => {
    expect(readImageHeader(png(1200, 630))).toEqual({ format: 'png', width: 1200, height: 630 })
    expect(readImageHeader(gif(1, 1))).toEqual({ format: 'gif', width: 1, height: 1 })
    expect(readImageHeader(jpeg(1600, 800))).toEqual({ format: 'jpeg', width: 1600, height: 800 })
    expect(readImageHeader(jpeg(1200, 630, 0xc2))).toEqual({ format: 'jpeg', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8 ', 1200, 630))).toEqual({ format: 'webp', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8L', 1200, 630))).toEqual({ format: 'webp', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8X', 4000, 2100))).toEqual({ format: 'webp', width: 4000, height: 2100 })
  })
  it('knows the format but not the size of a file cut off before its size', () => {
    expect(readImageHeader(png(1200, 630).slice(0, 20))).toEqual({ format: 'png', width: null, height: null })
    expect(readImageHeader(jpeg(1200, 630, 0xc0, true))).toEqual({ format: 'jpeg', width: null, height: null })
    expect(readImageHeader(jpeg(1200, 630).slice(0, 30))).toEqual({ format: 'jpeg', width: null, height: null })
    expect(readImageHeader(webp('VP8X', 10, 10).slice(0, 26))).toEqual({ format: 'webp', width: null, height: null })
  })
  it('never reads a size out of the picture data (after the scan starts)', () => {
    const sosFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16, 3, 0xff, 0xd9])
    expect(readImageHeader(sosFirst)).toEqual({ format: 'jpeg', width: null, height: null })
  })
  it('never reads a DHT (C4) segment as the size', () => {
    const b = jpeg(1200, 630)
    const withDht = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0, 7, 0, 9, 9, 9, 9, ...b.slice(2)])
    expect(readImageHeader(withDht)).toEqual({ format: 'jpeg', width: 1200, height: 630 })
  })
  it('names svg, avif and heic, and nothing else', () => {
    expect(readImageHeader(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')).format).toBe('svg')
    expect(readImageHeader(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0])).format).toBe('avif')
    expect(readImageHeader(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypheic'), 0, 0, 0, 0])).format).toBe('heic')
    expect(readImageHeader(new TextEncoder().encode('<!DOCTYPE html><html>')).format).toBeNull()
    expect(readImageHeader(new Uint8Array([])).format).toBeNull()
  })
})

/* ── the fetch ── */
type Answer = { status?: number; body?: Uint8Array | string | null; headers?: Record<string, string> }
function fakeFetch(answers: Record<string, Answer | Error>) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = String(input)
    const a = answers[url]
    if (!a) throw new Error(`unexpected fetch ${url}`)
    if (a instanceof Error) throw a
    return new Response((a.body ?? null) as BodyInit | null, { status: a.status ?? 200, headers: a.headers ?? {} })
  })
}
const home = (content: string, prop = 'og:image') => `<html><head><meta property="${prop}" content="${content}"/></head><body></body></html>`
const IMG = 'https://cdn.example-artist.com/og/card.png'

describe('fetchShareImage', () => {
  it('is null when there is no page, or the page names no picture', async () => {
    const f = fakeFetch({})
    expect(await fetchShareImage(null, ORIGIN, { fetcher: f })).toBeNull()
    expect(await fetchShareImage('<html><head><title>x</title></head></html>', ORIGIN, { fetcher: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('fetches the picture and reads its real size, type and weight', async () => {
    const bytes = png(1200, 630)
    const f = fakeFetch({ [IMG]: { body: bytes, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual({
      url: IMG, status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: bytes.length, format: 'png',
    })
    const init = f.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('user-agent')).toMatch(/Tapir/)
    expect(init.redirect).toBe('manual')
  })
  it('resolves a relative or protocol-relative address, and decodes &amp;', async () => {
    const f = fakeFetch({
      [`${ORIGIN}/og/card.png`]: { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
      'https://cdn.example-artist.com/x.png?v=1&w=2': { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
    })
    expect((await fetchShareImage(home('/og/card.png'), ORIGIN, { fetcher: f }))?.url).toBe(`${ORIGIN}/og/card.png`)
    expect((await fetchShareImage(home('//cdn.example-artist.com/x.png?v=1&amp;w=2'), ORIGIN, { fetcher: f }))?.width).toBe(1200)
  })
  it('falls back to og:image:secure_url', async () => {
    const f = fakeFetch({ [IMG]: { body: png(1200, 630), headers: { 'content-type': 'image/png' } } })
    expect((await fetchShareImage(home(IMG, 'og:image:secure_url'), ORIGIN, { fetcher: f }))?.status).toBe(200)
  })
  it('never fetches an http, private or non-web address', async () => {
    const f = fakeFetch({})
    expect(await fetchShareImage(home('http://cdn.example-artist.com/og.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-https' }))
    expect(await fetchShareImage(home('https://169.254.169.254/latest/meta-data'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('https://10.0.0.7/og.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('javascript:alert(1)'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'bad-url' }))
    expect(f).not.toHaveBeenCalled()
  })
  it('refuses a redirect to a private address or to http, before fetching it', async () => {
    const f = fakeFetch({
      [IMG]: { status: 302, headers: { location: 'https://127.0.0.1/og.png' } },
      'https://cdn.example-artist.com/b.png': { status: 301, headers: { location: 'http://cdn.example-artist.com/b.png' } },
    })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('https://cdn.example-artist.com/b.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'redirect-not-https' }))
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('follows a safe redirect and reports the address that answered', async () => {
    const f = fakeFetch({
      [IMG]: { status: 302, headers: { location: '/og/card-2.png' } },
      'https://cdn.example-artist.com/og/card-2.png': { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
    })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 200, width: 1200 }))
  })
  it('reports a page that is not a picture as such', async () => {
    const f = fakeFetch({ [IMG]: { body: '<!DOCTYPE html><html>Not found</html>', headers: { 'content-type': 'text/html' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 200, contentType: 'text/html', format: null, width: null }))
  })
  it('reads the bytes, not the label: a JPEG served as image/png', async () => {
    const f = fakeFetch({ [IMG]: { body: jpeg(1200, 630), headers: { 'content-type': 'image/png' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ contentType: 'image/png', format: 'jpeg', width: 1200, height: 630 }))
  })
  it('keeps the status of a broken link', async () => {
    const f = fakeFetch({ [IMG]: { status: 404, body: 'nope', headers: { 'content-type': 'text/plain' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 404 }))
  })
  it('marks a file shorter than its own stated length as broken', async () => {
    const f = fakeFetch({ [IMG]: { body: png(1200, 630), headers: { 'content-type': 'image/png', 'content-length': '50000' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ broken: true, bytes: 50000 }))
  })
  it('stops at the cap and marks a huge file too big', async () => {
    const big = new Uint8Array(SHARE_MAX_BYTES + 10)
    big.set(png(4000, 2100))
    const f = fakeFetch({ [IMG]: { body: big, headers: { 'content-type': 'image/png' } } })
    const r = await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })
    expect(r).toEqual(expect.objectContaining({ tooBig: true, width: 4000, height: 2100 }))
    expect(r!.bytes).toBeGreaterThanOrEqual(SHARE_MAX_BYTES)
  })
  it('turns a thrown fetch or a timeout into no answer, never a throw', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    const f = fakeFetch({ [IMG]: new Error('boom'), 'https://cdn.example-artist.com/slow.png': timeout })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'network' }))
    expect(await fetchShareImage(home('https://cdn.example-artist.com/slow.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'timeout' }))
  })
  it('does not start when the run has already given up', async () => {
    const f = fakeFetch({})
    const signal = AbortSignal.abort()
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f, signal })).toEqual(expect.objectContaining({ status: null, error: 'timeout' }))
    expect(f).not.toHaveBeenCalled()
  })
})
