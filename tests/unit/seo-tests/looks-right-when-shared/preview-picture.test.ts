/**
 * Proves the "Your preview picture looks right" test opens the picture a shared link shows and
 * judges the real file: it loads, it is a picture, it is wide and big enough, and not too
 * heavy. Also proves how that picture is found, fetched safely and measured.
 *
 * Code:     src/lib/seo-tests/shared.ts (`share`), src/lib/seo-tests/share-image.ts
 *           (`fetchShareImage`, `readImageHeader`)
 * Feature:  SEO test `share` · Test tab "Looks right when shared"
 * Tier:     STRICT (AGENTS.md "Test depth"): the address comes from the live page (untrusted),
 *           so fetching it is a security edge, and the size readers are parsers of raw bytes.
 * Covers:   • the test: 1200 × 630 (or 2:1) passes; none named, a broken link, not a picture,
 *             an svg, a cut-off or damaged file, over 5 MB, tiny, cropped or blurry fails
 *           • our visit turned away (401/403), a busy host (429/5xx) or no answer is
 *             "couldn't check", never "broken"; an insecure or private address is a fail
 *           • the words say "preview picture" (Sam, 2026-09-29), and X's own picture is named
 *           • the fetch: https only on every hop, never a private address, capped at 5 MB,
 *             never throws; the size is read from the file's own bytes, not its label
 *           • the byte readers: PNG, GIF, JPEG (baseline, progressive), WebP (3 kinds); a
 *             cut file keeps its format but no size; svg, avif and heic are named
 * Not here: the safe fetch's own redirect, address and size rules (tests/unit/safe-fetching/);
 *           an unreachable home page (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site whose picture is a 1200 × 630 PNG); `withImg`
 *           swaps what the fetch found; real header bytes are built by hand below; `fakeFetch`
 *           answers each address as told. Nothing reaches the network.
 */
import { describe, expect, it, vi } from 'vitest'
import { fetchShareImage, readImageHeader, SHARE_MAX_BYTES } from '@/lib/seo-tests/share-image'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import type { SeoEvidence } from '@/lib/seo-tests/types'
import { OG_IMAGE, ORIGIN, evidence, expectPlainWords, homeHtml, rowOf } from '@tests/helpers/seo/page-fixture'

const s = SHARED_TESTS.share
type Img = NonNullable<SeoEvidence['shareImage']>
/** The healthy picture as the run fetched it, with `over` changed. */
const img = (over: Partial<Img>): Img => ({ url: OG_IMAGE, status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: 32_000, format: 'png', ...over })
const withImg = (over: Partial<Img>) => s(evidence({ shareImage: img(over) }))
/** The fetch got no answer at all, for this reason. */
const noAnswer = (error: string) => withImg({ status: null, error, contentType: null, width: null, height: null, bytes: null, format: undefined })

describe('a wide picture of the right size passes', () => {
  // The one exact-wording check: the pass sentence gives the size and claims nothing it can't see (no "sharp"), and the details say size, format and weight.
  it('passes a 1200 × 630 PNG', () => {
    const r = s(evidence())
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe('Your preview picture is 1200 × 630, the right size and shape.')
    expect(rowOf(r, 'size')).toBe('1200 × 630 · PNG · 31 KB')
    expectPlainWords(r)
  })

  // X's 2:1 shape is fine too.
  it('passes 2:1 pictures (1200 × 600, 1600 × 800)', () => {
    expect(withImg({ width: 1200, height: 600 }).status).toBe('pass')
    expect(withImg({ width: 1600, height: 800 }).status).toBe('pass')
  })

  // Sam, 2026-09-29: it is the "preview picture" in every word a manager reads, never the "share picture".
  it('calls it the "preview picture" everywhere', () => {
    const cases: Partial<Img>[] = [{}, { status: 404 }, { status: 403 }, { status: null, error: 'not-https' }, { width: 600, height: 315 }, { contentType: 'text/html', format: null }]
    const results = [...cases.map((c) => withImg(c)), s(evidence({ home: homeHtml({ og: { 'og:image': null } }), shareImage: null }))]
    for (const r of results) {
      const shown = [r.value, r.sentence, r.todo, r.good, r.limits, r.action?.label].filter(Boolean).join(' | ')
      expect(shown).not.toMatch(/share (picture|image)/i)
    }
    expect(results[1].sentence).toMatch(/preview picture/)
  })

  // A different picture named just for X is listed in the details, and the limits say we don't open it. (verify-found S2)
  it('names a different picture for X, and says it isn’t opened', () => {
    const r = s(evidence({ home: homeHtml({ og: { 'twitter:image': 'https://cdn.example-artist.com/missing-404.png' } }) }))
    expect(rowOf(r, /X picture/)).toMatch(/missing-404/)
    expect(r.limits).toMatch(/X/)
  })
})

describe('no picture, or one that doesn’t load', () => {
  // No picture named: a fail, pointing to where it is set.
  it('fails when the page names no picture', () => {
    const r = s(evidence({ home: homeHtml({ og: { 'og:image': null } }), shareImage: null }))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'share' }))
    expectPlainWords(r)
  })

  // The page names a picture the run didn't open: "couldn't check", not a fail.
  it('is unknown when the named picture was not opened', () => {
    expect(s(evidence({ shareImage: null })).status).toBe('unknown')
  })

  // A timeout or no connection is about our visit, not the picture: "couldn't check".
  it('is unknown when the picture didn’t answer', () => {
    expect(noAnswer('timeout').status).toBe('unknown')
    expect(noAnswer('network').status).toBe('unknown')
  })

  // An http address, a redirect to http, a private address or a broken address: no sharing app can load it, so it fails.
  it.each(['not-https', 'redirect-not-https', 'not-public', 'bad-url'])('fails a picture no one can load (%s)', (error) => {
    const r = noAnswer(error)
    expect(r.status).toBe('fail')
    expectPlainWords(r)
  })

  // Gone (404, 410) is a broken link and says the error; turned away (401, 403) or busy (429, 5xx) is about our visit, so "couldn't check". (verify-found S1)
  it('fails a gone picture, and is unknown when our visit was turned away or the host was busy', () => {
    const answered = (status: number) => withImg({ status, contentType: 'text/html', format: null, width: null, height: null })
    for (const status of [404, 410]) expect(answered(status).status, String(status)).toBe('fail')
    expect(answered(404).sentence).toMatch(/404/)
    for (const status of [401, 403, 429, 500, 503]) expect(answered(status).status, String(status)).toBe('unknown')
  })
})

describe('a file that isn’t a usable picture fails', () => {
  // The bytes decide: an html page fails, a "PNG" whose bytes aren't one fails, and a real picture labelled as something else fails softly as a wrong label. (verify-found S5)
  it('fails something that is not a picture, whatever its label says', () => {
    expect(withImg({ contentType: 'text/html', format: null, width: null, height: null }).status).toBe('fail')
    expect(withImg({ contentType: 'image/png', format: null, width: null, height: null }).status).toBe('fail')
    for (const contentType of ['text/html', 'application/octet-stream']) {
      const r = withImg({ contentType })
      expect(r.status, contentType).toBe('fail')
      expect(r.value, contentType).toBe('wrong label')
    }
  })

  // Sharing apps don't show svg pictures.
  it('fails an svg', () => {
    expect(withImg({ contentType: 'image/svg+xml', format: 'svg', width: null, height: null }).status).toBe('fail')
  })

  // A format we can't measure yet (avif) is "couldn't check", not a fail.
  it('is unknown for a format we cannot measure', () => {
    expect(withImg({ contentType: 'image/avif', format: 'avif', width: null, height: null }).status).toBe('unknown')
  })

  // A file that stops short of its stated length, or a JPEG whose size can't be read, is damaged.
  it('fails a cut-off or damaged file', () => {
    expect(withImg({ broken: true }).status).toBe('fail')
    expect(withImg({ broken: true }).value).toBe('broken file')
    expect(withImg({ format: 'jpeg', contentType: 'image/jpeg', width: null, height: null }).status).toBe('fail')
  })

  // X won't show a picture over 5 MB; just under passes.
  it('fails a file over 5 MB', () => {
    expect(withImg({ bytes: 6_000_000 }).status).toBe('fail')
    expect(withImg({ bytes: 5 * 1024 * 1024, tooBig: true }).status).toBe('fail')
    expect(withImg({ bytes: 4_900_000 }).status).toBe('pass')
  })

  // "over 40 MB" is said only when the real size is unknown: a stated size is given as it is. (verify-found S3)
  it('says "over" only when the size was not stated', () => {
    expect(withImg({ bytes: 40 * 1024 * 1024, tooBig: true }).sentence).not.toMatch(/over 40/)
  })
})

describe('a picture of the wrong size or shape fails', () => {
  // A 1 × 1 tracking pixel is not a preview picture: a hard fail.
  it('fails a 1 × 1 tracking gif outright', () => {
    const r = withImg({ contentType: 'image/gif', format: 'gif', width: 1, height: 1, bytes: 43 })
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })

  // Smaller than 1200 × 630 looks blurry: a soft fail that says the size to aim for.
  it('fails a small picture softly', () => {
    const r = withImg({ width: 600, height: 315 })
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.good).toMatch(/1200 × 630/)
  })

  // A square picture gets cropped to a wide shape: a soft fail.
  it('fails a square picture softly', () => {
    const r = withImg({ width: 1200, height: 1200 })
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
})

/* ── real header bytes, built by hand from each format's spec ── */
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

describe('reading a picture’s size from its own bytes', () => {
  // Each format keeps its size in a different place: every one we measure is read right.
  it('reads PNG, GIF, JPEG (baseline and progressive) and all three WebP kinds', () => {
    expect(readImageHeader(png(1200, 630))).toEqual({ format: 'png', width: 1200, height: 630 })
    expect(readImageHeader(gif(1, 1))).toEqual({ format: 'gif', width: 1, height: 1 })
    expect(readImageHeader(jpeg(1600, 800))).toEqual({ format: 'jpeg', width: 1600, height: 800 })
    expect(readImageHeader(jpeg(1200, 630, 0xc2))).toEqual({ format: 'jpeg', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8 ', 1200, 630))).toEqual({ format: 'webp', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8L', 1200, 630))).toEqual({ format: 'webp', width: 1200, height: 630 })
    expect(readImageHeader(webp('VP8X', 4000, 2100))).toEqual({ format: 'webp', width: 4000, height: 2100 })
  })

  // A file cut off before its size keeps its format but no size, so the test can call it damaged, not guess.
  it('knows the format but not the size of a file cut off before its size', () => {
    expect(readImageHeader(png(1200, 630).slice(0, 20))).toEqual({ format: 'png', width: null, height: null })
    expect(readImageHeader(jpeg(1200, 630, 0xc0, true))).toEqual({ format: 'jpeg', width: null, height: null })
    expect(readImageHeader(jpeg(1200, 630).slice(0, 30))).toEqual({ format: 'jpeg', width: null, height: null })
    expect(readImageHeader(webp('VP8X', 10, 10).slice(0, 26))).toEqual({ format: 'webp', width: null, height: null })
  })

  // Once the picture data starts, no size is read from it: those bytes can look like a size by chance.
  it('never reads a size out of the picture data (after the scan starts)', () => {
    const sosFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16, 3, 0xff, 0xd9])
    expect(readImageHeader(sosFirst)).toEqual({ format: 'jpeg', width: null, height: null })
  })

  // A JPEG table segment (C4) sits in the size markers' range but is not one: it is skipped.
  it('never reads a DHT (C4) segment as the size', () => {
    const b = jpeg(1200, 630)
    const withDht = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0, 7, 0, 9, 9, 9, 9, ...b.slice(2)])
    expect(readImageHeader(withDht)).toEqual({ format: 'jpeg', width: 1200, height: 630 })
  })

  // svg, avif and heic are named (so the test can say why), and an html page or empty file is no format.
  it('names svg, avif and heic, and nothing else', () => {
    expect(readImageHeader(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')).format).toBe('svg')
    expect(readImageHeader(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0])).format).toBe('avif')
    expect(readImageHeader(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypheic'), 0, 0, 0, 0])).format).toBe('heic')
    expect(readImageHeader(new TextEncoder().encode('<!DOCTYPE html><html>')).format).toBeNull()
    expect(readImageHeader(new Uint8Array([])).format).toBeNull()
  })
})

/* ── a fake fetch: each address answers as told, anything else throws ── */
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

describe('finding and fetching the picture safely', () => {
  // No page, or no picture named: nothing is fetched.
  it('is null when there is no page, or the page names no picture', async () => {
    const f = fakeFetch({})
    expect(await fetchShareImage(null, ORIGIN, { fetcher: f })).toBeNull()
    expect(await fetchShareImage('<html><head><title>x</title></head></html>', ORIGIN, { fetcher: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  // The picture is fetched with Tapir's own User-Agent, redirects handled by hand, and its real size, type and weight reported.
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

  // A relative or //host address is resolved against the site, and "&amp;" in it is decoded.
  it('resolves a relative or protocol-relative address, and decodes &amp;', async () => {
    const f = fakeFetch({
      [`${ORIGIN}/og/card.png`]: { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
      'https://cdn.example-artist.com/x.png?v=1&w=2': { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
    })
    expect((await fetchShareImage(home('/og/card.png'), ORIGIN, { fetcher: f }))?.url).toBe(`${ORIGIN}/og/card.png`)
    expect((await fetchShareImage(home('//cdn.example-artist.com/x.png?v=1&amp;w=2'), ORIGIN, { fetcher: f }))?.width).toBe(1200)
  })

  // A page that names its picture only as og:image:secure_url is still read.
  it('falls back to og:image:secure_url', async () => {
    const f = fakeFetch({ [IMG]: { body: png(1200, 630), headers: { 'content-type': 'image/png' } } })
    expect((await fetchShareImage(home(IMG, 'og:image:secure_url'), ORIGIN, { fetcher: f }))?.status).toBe(200)
  })

  // An http, private (cloud metadata, 10.x) or script address is refused before any fetch: the page is untrusted.
  it('never fetches an http, private or non-web address', async () => {
    const f = fakeFetch({})
    expect(await fetchShareImage(home('http://cdn.example-artist.com/og.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-https' }))
    expect(await fetchShareImage(home('https://169.254.169.254/latest/meta-data'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('https://10.0.0.7/og.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('javascript:alert(1)'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'bad-url' }))
    expect(f).not.toHaveBeenCalled()
  })

  // A redirect to a private address or to http is refused before that hop is fetched.
  it('refuses a redirect to a private address or to http, before fetching it', async () => {
    const f = fakeFetch({
      [IMG]: { status: 302, headers: { location: 'https://127.0.0.1/og.png' } },
      'https://cdn.example-artist.com/b.png': { status: 301, headers: { location: 'http://cdn.example-artist.com/b.png' } },
    })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'not-public' }))
    expect(await fetchShareImage(home('https://cdn.example-artist.com/b.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'redirect-not-https' }))
    expect(f).toHaveBeenCalledTimes(2)
  })

  // A safe redirect is followed, and the address that answered is the one reported.
  it('follows a safe redirect and reports the address that answered', async () => {
    const f = fakeFetch({
      [IMG]: { status: 302, headers: { location: '/og/card-2.png' } },
      'https://cdn.example-artist.com/og/card-2.png': { body: png(1200, 630), headers: { 'content-type': 'image/png' } },
    })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 200, width: 1200 }))
  })
})

describe('what the fetch reports', () => {
  // An html page served at the picture's address is reported with no format, so the test can say "not a picture".
  it('reports a page that is not a picture as such', async () => {
    const f = fakeFetch({ [IMG]: { body: '<!DOCTYPE html><html>Not found</html>', headers: { 'content-type': 'text/html' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 200, contentType: 'text/html', format: null, width: null }))
  })

  // The bytes decide the format: a JPEG labelled image/png is a JPEG, with its real size.
  it('reads the bytes, not the label: a JPEG served as image/png', async () => {
    const f = fakeFetch({ [IMG]: { body: jpeg(1200, 630), headers: { 'content-type': 'image/png' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ contentType: 'image/png', format: 'jpeg', width: 1200, height: 630 }))
  })

  // A broken link keeps its status (404), so the test can say it.
  it('keeps the status of a broken link', async () => {
    const f = fakeFetch({ [IMG]: { status: 404, body: 'nope', headers: { 'content-type': 'text/plain' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: 404 }))
  })

  // A file shorter than its stated length is marked broken, and its stated size is kept.
  it('marks a file shorter than its own stated length as broken', async () => {
    const f = fakeFetch({ [IMG]: { body: png(1200, 630), headers: { 'content-type': 'image/png', 'content-length': '50000' } } })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ broken: true, bytes: 50000 }))
  })

  // A huge file is read only up to the 5 MB cap and marked too big; its size is still read from the start.
  it('stops at the cap and marks a huge file too big', async () => {
    const big = new Uint8Array(SHARE_MAX_BYTES + 10)
    big.set(png(4000, 2100))
    const f = fakeFetch({ [IMG]: { body: big, headers: { 'content-type': 'image/png' } } })
    const r = await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })
    expect(r).toEqual(expect.objectContaining({ tooBig: true, width: 4000, height: 2100 }))
    expect(r!.bytes).toBeGreaterThanOrEqual(SHARE_MAX_BYTES)
  })

  // A thrown fetch or a timeout becomes "no answer" with a reason, never a crash of the run.
  it('turns a thrown fetch or a timeout into no answer, never a throw', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    const f = fakeFetch({ [IMG]: new Error('boom'), 'https://cdn.example-artist.com/slow.png': timeout })
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'network' }))
    expect(await fetchShareImage(home('https://cdn.example-artist.com/slow.png'), ORIGIN, { fetcher: f })).toEqual(expect.objectContaining({ status: null, error: 'timeout' }))
  })

  // A run that has already given up (aborted) fetches nothing.
  it('does not start when the run has already given up', async () => {
    const f = fakeFetch({})
    const signal = AbortSignal.abort()
    expect(await fetchShareImage(home(IMG), ORIGIN, { fetcher: f, signal })).toEqual(expect.objectContaining({ status: null, error: 'timeout' }))
    expect(f).not.toHaveBeenCalled()
  })
})
