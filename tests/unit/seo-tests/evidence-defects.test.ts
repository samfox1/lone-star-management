/**
 * gatherSiteEvidence, the defects the verifiers found (2026-09-29, scratchpad verify-found.md
 * and the security review), each seen RED before its fix. STRICT: this is the code that
 * fetches what a manager and a site's own files point at.
 */
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { BROWSER_UA, FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { gatherSiteEvidence, parseSitemap } from '@/lib/seo-tests/evidence'
import { fakeSite, type Route } from '@tests/unit/seo-tests/fake-site'

const O = 'https://www.example.com'
const page = (title: string, body = '') => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body || `Words about ${title} for people to read.`}</p></body></html>`
const urlset = (locs: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc><lastmod>2026-09-20</lastmod></url>`).join('')}</urlset>`
const xml = (body: string | Uint8Array, type = 'application/xml') => ({ body, headers: { 'content-type': type } })
const text = (body: string) => ({ body, headers: { 'content-type': 'text/plain' } })

function site(over: Record<string, Route> = {}) {
  return fakeSite({
    [`${O}/`]: page('Home'),
    [`${O}/about`]: page('About'),
    [`${O}/robots.txt`]: text(`User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n`),
    [`${O}/sitemap.xml`]: xml(urlset([`${O}/`, `${O}/about`])),
    ...over,
  })
}

describe('the sitemap reader is linear (security review: a regex froze on hostile input)', () => {
  const CAP = 2 * 1024 * 1024
  const hostile: [string, string][] = [
    ['<url> never closed', '<urlset>' + '<url>'.repeat(CAP / 5)],
    ['<url><loc> never closed', '<urlset>' + '<url><loc>'.repeat(CAP / 10)],
    ['<loc> never closed', '<urlset><url>' + '<loc>a'.repeat(CAP / 6)],
    ['</ everywhere', '<urlset><url><loc>' + '</'.repeat(CAP / 2)],
    ['CDATA never closed', '<urlset><url><loc><![CDATA[' + 'x<![CDATA['.repeat(CAP / 10)],
    ['sitemapindex, <sitemap> never closed', '<sitemapindex>' + '<sitemap>'.repeat(CAP / 9)],
    ['prefix soup', '<' + 'a'.repeat(CAP / 2) + ':' + '<b:'.repeat(CAP / 6)],
    ['entities', '<urlset><url><loc>' + '&#x110000;&amp;'.repeat(CAP / 15) + '</loc></url></urlset>'],
    ['a million unclosed tags and one > at the end', '<urlset>' + '<a'.repeat(CAP / 2) + '>'],
    ['text list of junk lines', 'x\n'.repeat(CAP / 2)],
  ]
  for (const [name, body] of hostile) {
    it(`${name}: finishes in under 200 ms at the 2 MiB cap and never throws`, () => {
      const t = performance.now()
      expect(() => parseSitemap(body)).not.toThrow()
      expect(performance.now() - t).toBeLessThan(200)
    })
  }
  it('a normal sitemap still reads (prefixes, CDATA, entities, whitespace)', () => {
    const r = parseSitemap(`<?xml version="1.0"?><ns:urlset xmlns:ns="x"><ns:url>\n<ns:loc>\n <![CDATA[${O}/]]>\n</ns:loc><ns:lastmod>2026-09-20</ns:lastmod></ns:url><ns:url><ns:loc> ${O}/a?b=1&amp;c=2 </ns:loc></ns:url></ns:urlset>`)
    expect(r).toEqual({ kind: 'urlset', format: 'xml', locs: [`${O}/`, `${O}/a?b=1&c=2`], lastmods: ['2026-09-20', null] })
  })
  it('an entry past 8 KB is not decoded whole (sitemaps.org: under 2,048 characters)', () => {
    const r = parseSitemap(`<urlset><url><loc>${O}/${'a'.repeat(20_000)}</loc></url></urlset>`)
    expect(r.locs[0].length).toBeLessThanOrEqual(8192)
  })
  it('an invalid character reference is replaced, not thrown', () => {
    expect(parseSitemap(`<urlset><url><loc>${O}/&#x110000;</loc></url></urlset>`).locs).toEqual([`${O}/\uFFFD`])
  })
  it('reads a text list (one address per line) and RSS / Atom feeds, as Google does', () => {
    expect(parseSitemap(`${O}/\n${O}/about\n`)).toMatchObject({ kind: 'urlset', format: 'text', locs: [`${O}/`, `${O}/about`] })
    expect(parseSitemap(`<rss><channel><item><link>${O}/a</link><pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`)).toMatchObject({ kind: 'urlset', format: 'feed', locs: [`${O}/a`] })
    expect(parseSitemap(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="${O}/b"/><updated>2026-09-20T10:00:00Z</updated></entry></feed>`)).toMatchObject({ kind: 'urlset', format: 'feed', locs: [`${O}/b`], lastmods: ['2026-09-20T10:00:00Z'] })
  })
  it('an html page is "html", anything else is "other"', () => {
    expect(parseSitemap(page('Home'))).toMatchObject({ kind: null, format: 'html' })
    expect(parseSitemap('{"a":1}')).toMatchObject({ kind: null, format: 'other' })
  })
})

describe('the sitemap, as gathered', () => {
  it('F20: a gzip file is unpacked', async () => {
    const f = site({
      [`${O}/robots.txt`]: text(`User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml.gz\n`),
      [`${O}/sitemap.xml.gz`]: xml(new Uint8Array(gzipSync(urlset([`${O}/`, `${O}/about`]))), 'application/gzip'),
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, format: 'xml', urls: [`${O}/`, `${O}/about`] })
  })
  it('F20: a gzip bomb stops at the cap instead of filling memory', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20)))
    const f = site({ [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/s.xml.gz\n`), [`${O}/s.xml.gz`]: xml(bomb, 'application/gzip'), [`${O}/sitemap.xml`]: { status: 404, body: 'nf' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap?.parsed).toBe(false)
    expect(e.sitemap?.truncated).toBe(true)
  })
  it('F20: a text list is read', async () => {
    const f = site({ [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/sitemap.txt\n`), [`${O}/sitemap.txt`]: text(`${O}/\n${O}/about\n`) })
    expect((await gatherSiteEvidence(O, { fetcher: f })).sitemap).toMatchObject({ parsed: true, format: 'text', total: 2 })
  })
  it('F21: robots.txt names two lists, the first 404s → the second is read, and both are recorded', async () => {
    const f = site({ [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/old.xml\nSitemap: ${O}/sitemap.xml\n`) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, url: `${O}/sitemap.xml`, tried: [{ url: `${O}/old.xml`, status: 404 }, { url: `${O}/sitemap.xml`, status: 200 }] })
  })
  it('F25: a list named only on another site is recorded, never opened', async () => {
    const f = site({ [`${O}/robots.txt`]: text('User-agent: *\nSitemap: https://cdn.sitemaps-host.net/s.xml\n'), [`${O}/sitemap.xml`]: { status: 404, body: 'nf' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap?.namedElsewhere).toEqual(['https://cdn.sitemaps-host.net/s.xml'])
    expect(f.calls.some((c) => c.url.includes('sitemaps-host'))).toBe(false)
  })
  it('F25: relative entries are counted as not full addresses; other spellings of the site are counted', async () => {
    const f = site({ [`${O}/sitemap.xml`]: xml('<urlset><url><loc>/</loc></url><url><loc>/about</loc></url><url><loc>http://www.example.com/x</loc></url><url><loc>https://example.com/y</loc></url></urlset>') })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap?.badLocs).toEqual({ count: 2, examples: ['/', '/about'] })
    expect(e.sitemap?.offSite?.count).toBe(0)
    expect(e.sitemap?.otherSpelling).toBe(2)
  })
  it('F23: an index records how many lists it names', async () => {
    const idx = `<sitemapindex>${[1, 2, 3, 4, 5].map((n) => `<sitemap><loc>${O}/s${n}.xml</loc></sitemap>`).join('')}</sitemapindex>`
    const f = site({ [`${O}/sitemap.xml`]: xml(idx), [`${O}/s1.xml`]: xml(urlset([`${O}/`])) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap?.childTotal).toBe(5)
    expect(e.sitemap?.children).toHaveLength(3)
  })
})

describe('robots.txt, as gathered', () => {
  it('is always read as UTF-8, as RFC 9309 says: a UTF-16 file is junk to Google, so it holds no rules for us either', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('User-agent: *\nDisallow: /\n').flatMap((c) => [c.charCodeAt(0), 0])])
    const f = site({ [`${O}/robots.txt`]: { body: utf16, headers: { 'content-type': 'text/plain' } } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.robots.body).not.toContain('User-agent: *')
  })
  it('F14: a redirect to another site is kept as the reason', async () => {
    const f = site({ [`${O}/robots.txt`]: { status: 301, location: 'https://cdn.other-host.net/robots.txt' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.robots).toEqual({ status: null, body: null, error: 'not-allowed: https://cdn.other-host.net/robots.txt' })
  })
})

describe('one polite retry', () => {
  it('a dropped connection is tried once more, and the second answer is kept', async () => {
    let n = 0
    const f = site({ [`${O}/about`]: () => (n++ === 0 ? { fail: true } : page('About')) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.plain.find((p) => p.path === '/about')?.status).toBe(200)
  })
  it('a timeout is tried once more', async () => {
    let n = 0
    const f = site({ [`${O}/about`]: () => (n++ === 0 ? { hang: true } : page('About')) })
    const e = await gatherSiteEvidence(O, { fetcher: f, timeoutMs: 100 })
    expect(e.plain.find((p) => p.path === '/about')?.status).toBe(200)
  })
  it('an answer, even an error, is never retried', async () => {
    const f = site({ [`${O}/about`]: { status: 503, body: 'down' } })
    await gatherSiteEvidence(O, { fetcher: f })
    expect(f.calls.filter((c) => c.url === `${O}/about` && c.ua === BROWSER_UA)).toHaveLength(1)
  })
  it('only once: a page that keeps failing costs two tries, then "no answer"', async () => {
    const f = site({ [`${O}/about`]: { fail: true } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(f.calls.filter((c) => c.url === `${O}/about` && c.ua === BROWSER_UA)).toHaveLength(2)
    expect(e.plain.find((p) => p.path === '/about')).toMatchObject({ status: null, error: 'network' })
  })
  it('a visit cut by the run\'s budget says "out-of-time", not "timeout"', async () => {
    const f = site({ [`${O}/about`]: { hang: true } })
    const e = await gatherSiteEvidence(O, { fetcher: f, budgetMs: 300, timeoutMs: 10_000 })
    expect(e.plain.find((p) => p.path === '/about')?.error).toBe('out-of-time')
  })
})

describe('F28: a page in another character set is read in it', () => {
  it('ISO-8859-1 by header', async () => {
    const latin = Uint8Array.from(Array.from(page('Home', 'Café Señor')).map((c) => c.charCodeAt(0) & 0xff))
    const f = site({ [`${O}/`]: { body: latin, headers: { 'content-type': 'text/html; charset=ISO-8859-1' } } })
    expect((await gatherSiteEvidence(O, { fetcher: f })).plain[0].html).toContain('Café Señor')
  })
  it('windows-1252 by <meta charset>', async () => {
    const html = page('Home', 'Théâtre').replace('<head>', '<head><meta charset="windows-1252">')
    const bytes = Uint8Array.from(Array.from(html).map((c) => c.charCodeAt(0) & 0xff))
    const f = site({ [`${O}/`]: { body: bytes, headers: { 'content-type': 'text/html' } } })
    expect((await gatherSiteEvidence(O, { fetcher: f })).plain[0].html).toContain('Théâtre')
  })
})

describe('F26: which pages are opened', () => {
  it('the artist\'s key pages come first, from the list or the home page\'s own links', async () => {
    const f = site({
      [`${O}/sitemap.xml`]: xml(urlset(['/', '/news/1', '/news/2', '/news/3', '/news/4', '/about', '/music'].map((p) => `${O}${p}`))),
      [`${O}/music`]: page('Music'),
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toContain('/about')
    expect(e.paths).toContain('/music')
    expect(e.paths).toHaveLength(5)
  })
  it('with no sitemap, pages the home page links to are opened (same site only, no files)', async () => {
    const home = page('Home').replace('</body>', '<nav><a href="/about">About</a> <a href="https://instagram.com/x">IG</a> <a href="/press.pdf">Kit</a> <a href="mailto:a@b.c">Mail</a> <a href="#top">Top</a></nav></body>')
    const f = site({ [`${O}/`]: home, [`${O}/sitemap.xml`]: { status: 404, body: 'nf' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/about'])
    expect(f.calls.some((c) => c.url.includes('instagram') || c.url.endsWith('.pdf'))).toBe(false)
  })
})

describe('the run-level fact the page needs: did the site answer at all', () => {
  it('answered / server error / refused / no answer', async () => {
    expect((await gatherSiteEvidence(O, { fetcher: site() })).reach).toEqual({ state: 'answered', status: 200 })
    expect((await gatherSiteEvidence(O, { fetcher: site({ [`${O}/`]: { status: 500, body: 'x' } }) })).reach).toEqual({ state: 'server-error', status: 500 })
    expect((await gatherSiteEvidence(O, { fetcher: site({ [`${O}/`]: { status: 403, body: 'x' } }) })).reach).toEqual({ state: 'refused', status: 403 })
    expect((await gatherSiteEvidence(O, { fetcher: site({ [`${O}/`]: { fail: true } }) })).reach).toEqual({ state: 'no-answer', status: null, error: 'network' })
  })
})

describe('F29: Bing\'s file must hold a real code', () => {
  it('a placeholder user is not a code', async () => {
    const f = site({ [`${O}/BingSiteAuth.xml`]: xml('<users><user>YOUR_CODE_HERE</user></users>') })
    expect((await gatherSiteEvidence(O, { fetcher: f })).bing?.siteAuth.hasUser).toBe(false)
  })
})

void FETCHING_BOTS
