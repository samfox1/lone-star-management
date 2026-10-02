/**
 * The one visit to the artist's site that every "Can be found" test reads: which pages it opens,
 * how it finds and reads the list of pages, and that it never leaves the site or outstays its welcome.
 *
 * Code:     src/lib/seo-tests/evidence.ts (gatherSiteEvidence, sameSite, parseSitemap)
 * Feature:  the evidence behind all ten "Can be found" tests (Test tab group "Can be found")
 * Tier:     STRICT (AGENTS.md "Test depth"): it fetches addresses that a manager and a site's own
 *           files hand the server, and parses what comes back.
 * Covers:   • what counts as "this site": www or bare, http or https, nothing else
 *           • a healthy site: every page visited once as a person and once as each bot, by its
 *             exact name; only the headers a test reads are kept; html only for a real page
 *           • which pages are opened: the artist's key pages first, from the list or home's links
 *           • the list of pages (sitemap): where it is found, gzip, text lists and feeds, an index
 *             one level deep, addresses on other sites counted but never opened
 *           • reading a list is fast on hostile input, and exact on normal input
 *           • robots.txt as fetched: capped at 500 KiB, read as UTF-8, a redirect elsewhere named
 *           • redirects to other sites or private addresses are named, never followed
 *           • pages in another character set, one polite retry, 4 requests at a time, time limits
 *           • whether the site answered at all, and Bing's file
 * Not here: what the tests conclude from this evidence (the other files in this folder); how
 *           robots.txt rules are read (robots-txt.test.ts); the fetch guard itself, byte caps and
 *           slow parsers of other readers (tests/unit/safe-fetching/).
 * Fixtures: a fake web (tests/helpers/seo/fake-site.ts): each address answers from a table with a real Response,
 *           and redirects are followed only if the code asks. No network. The bots and their names
 *           come from the bot list (bots.ts), never typed out here.
 */
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { BROWSER_UA, FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { gatherSiteEvidence, parseSitemap, sameSite, type GatheredSite } from '@/lib/seo-tests/evidence'
import type { SeoEvidence } from '@/lib/seo-tests/types'
import { fakeSite, type FakeAnswer, type Route } from '@tests/helpers/seo/fake-site'

const O = 'https://www.example.com'
const page = (title: string, body = '') => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body || `Words about ${title} for people to read.`}</p></body></html>`
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n`
/** A sitemap listing `entries`: an address alone, or [address, last-changed date]. */
const urlset = (entries: (string | [string, string])[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((e) => (typeof e === 'string' ? `<url><loc>${e}</loc></url>` : `<url><loc>${e[0]}</loc><lastmod>${e[1]}</lastmod></url>`)).join('')}</urlset>`
const xml = (body: string | Uint8Array, type = 'application/xml'): FakeAnswer => ({ body, headers: { 'content-type': type } })
const text = (body: string): FakeAnswer => ({ body, headers: { 'content-type': 'text/plain' } })
const notFound: FakeAnswer = { status: 404, body: 'not found' }

/** A healthy three-page site: home, /about and /faqsheet, a robots.txt naming its sitemap. `over` replaces any address. */
function site(over: Record<string, Route> = {}) {
  return fakeSite({
    [`${O}/`]: page('Home'),
    [`${O}/about`]: page('About'),
    [`${O}/faqsheet`]: page('Facts'),
    [`${O}/robots.txt`]: text(ROBOTS),
    [`${O}/sitemap.xml`]: xml(urlset([[`${O}/`, '2026-09-28'], [`${O}/about`, '2026-09-20'], `${O}/faqsheet`])),
    ...over,
  })
}
const gather = (over: Record<string, Route> = {}, opts: Parameters<typeof gatherSiteEvidence>[1] = {}) => gatherSiteEvidence(O, { fetcher: site(over), ...opts })
const hosts = (calls: { url: string }[]) => [...new Set(calls.map((c) => new URL(c.url).host))]
const plainAt = (e: GatheredSite, path: string) => e.plain.find((p) => p.path === path)

describe('what counts as this site (sameSite)', () => {
  // www and the bare domain, over http or https, any letter case or a trailing dot, are one site:
  // otherwise a site's own links would count as "another site".
  it('www and the bare domain are the same site, over http or https', () => {
    expect(sameSite('https://example.com/a', O)).toBe(true)
    expect(sameSite('http://www.example.com/a', O)).toBe(true)
    expect(sameSite('https://WWW.Example.COM./a', O)).toBe(true)
    expect(sameSite('https://www.example.com/a', 'https://example.com')).toBe(true)
  })
  // Everything else is another site we never fetch: a sub-domain (anyone can run one), a look-
  // alike name, a login trick, another scheme or port, or junk.
  it.each([
    'https://evil.example.com/', 'https://example.com.evil.test/', 'https://wwwexample.com/', 'https://www.www.example.com/',
    'https://example.com@evil.test/', 'ftp://www.example.com/', 'javascript:alert(1)', 'not a url', 'https://www.example.com:8443/',
  ])('%s is another site', (url) => {
    expect(sameSite(url, O)).toBe(false)
  })
})

describe('a healthy site', () => {
  // Every page on the list is visited once as a person and once as each bot, under the bot's
  // exact name from bots.ts, and nothing outside the site is asked for.
  it('visits every listed page as a person and as every bot, by its exact name, once each', async () => {
    const f = site()
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.origin).toBe(O)
    expect(e.paths).toEqual(['/', '/about', '/faqsheet'])
    expect(e.plain.map((p) => [p.path, p.status])).toEqual([['/', 200], ['/about', 200], ['/faqsheet', 200]])
    expect(e.plain[1].html).toContain('<h1>About</h1>')
    expect(Object.keys(e.byBot).sort()).toEqual(FETCHING_BOTS.map((b) => b.key).sort())
    for (const bot of FETCHING_BOTS) {
      expect(e.byBot[bot.key].map((p) => [p.path, p.status])).toEqual([['/', 200], ['/about', 200], ['/faqsheet', 200]])
      const sent = f.calls.filter((c) => c.ua === bot.userAgent).map((c) => new URL(c.url).pathname)
      expect([bot.key, sent.sort()]).toEqual([bot.key, ['/', '/about', '/faqsheet']])
    }
    expect(f.calls.filter((c) => c.ua === BROWSER_UA && /\/(about|faqsheet)?$/.test(new URL(c.url).pathname))).toHaveLength(3)
    expect(e.robots).toEqual({ status: 200, body: ROBOTS })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, namedInRobots: true, total: 3, url: `${O}/sitemap.xml`, urls: [`${O}/`, `${O}/about`, `${O}/faqsheet`], lastmods: ['2026-09-28', '2026-09-20', null] })
    expect(e.bing).toEqual({ siteAuth: { status: 404, hasUser: false } })
    expect(Date.parse(e.gatheredAt)).not.toBeNaN()
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  // Only the headers a test reads are kept: never a cookie, never anything else.
  it('keeps only the headers a test reads, never cookies', async () => {
    const e = await gather({ [`${O}/`]: { body: page('Home'), headers: { 'X-Robots-Tag': 'noindex', 'Set-Cookie': 'session=secret', 'content-type': 'text/html', Server: 'Vercel', 'X-Vercel-Mitigated': 'challenge', 'X-Powered-By': 'Next.js', Link: '<https://www.example.com/>; rel="canonical"' } } })
    expect(e.plain[0].headers).toEqual({ 'x-robots-tag': 'noindex', 'content-type': 'text/html', server: 'Vercel', 'x-vercel-mitigated': 'challenge', link: '<https://www.example.com/>; rel="canonical"' })
  })
  // A page's html is kept only for a 2xx web page: not for an error, not for JSON.
  it('keeps html only for a 2xx web page', async () => {
    const e = await gather({
      [`${O}/about`]: { status: 403, body: '<html>Sorry, you have been blocked</html>', headers: { 'content-type': 'text/html' } },
      [`${O}/faqsheet`]: { body: '{"a":1}', headers: { 'content-type': 'application/json' } },
    })
    expect(e.plain.map((p) => [p.status, p.html === null])).toEqual([[200, false], [403, true], [200, true]])
  })
  // The run starts from where the home page really lives (bare domain → www), so every other
  // request goes straight there instead of through the redirect.
  it('starts from where the home page really lives, so pages are not redirected twice', async () => {
    const f = site({ 'https://example.com/': { status: 308, location: `${O}/` } })
    const e = await gatherSiteEvidence('https://example.com/', { fetcher: f })
    expect(e.origin).toBe(O)
    expect(e.paths).toEqual(['/', '/about', '/faqsheet'])
    expect(f.calls.filter((c) => new URL(c.url).host === 'example.com')).toHaveLength(1)
  })
})

describe('which pages are opened', () => {
  // The artist's key pages (about, music, …) come first, ahead of news posts earlier on the list:
  // they are where the bio, releases and shows live. (verify-found F26)
  it('the artist’s key pages come first, from the list', async () => {
    const e = await gather({
      [`${O}/sitemap.xml`]: xml(urlset(['/', '/news/1', '/news/2', '/news/3', '/news/4', '/about', '/music'].map((p) => `${O}${p}`))),
      [`${O}/music`]: page('Music'),
    })
    expect(e.paths).toHaveLength(5)
    expect(e.paths).toContain('/about')
    expect(e.paths).toContain('/music')
  })
  // With no list, the pages home links to are opened: this site only, no files, no mail links.
  // (verify-found F26)
  it('with no list, the pages home links to are opened: same site only, no files', async () => {
    const home = page('Home').replace('</body>', '<nav><a href="/about">About</a> <a href="https://instagram.com/x">IG</a> <a href="/press.pdf">Kit</a> <a href="mailto:a@b.c">Mail</a> <a href="#top">Top</a></nav></body>')
    const f = site({ [`${O}/`]: home, [`${O}/sitemap.xml`]: notFound })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/about'])
    expect(f.calls.some((c) => c.url.includes('instagram') || c.url.endsWith('.pdf'))).toBe(false)
  })
  // A list of 10,000 pages: 5 pages are visited, the kept list is capped, and all are counted;
  // the number of requests is exactly the pages times the visitors, plus three files.
  it('a list of 10,000 pages: visits 5, keeps a capped list, counts them all', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `${O}/p${i}`)
    const f = site({ [`${O}/sitemap.xml`]: xml(urlset(many)) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/p0', '/p1', '/p2', '/p3'])
    expect(e.sitemap?.total).toBe(10_000)
    expect(e.sitemap!.urls.length).toBeLessThanOrEqual(500)
    expect(e.sitemap!.urls.length).toBe(e.sitemap!.lastmods.length)
    // 5 pages × (a person + every bot) + robots.txt + the sitemap + Bing's file, and nothing more.
    expect(f.calls.length).toBe(5 * (1 + FETCHING_BOTS.length) + 3)
  })
})

describe('finding the list of pages (sitemap)', () => {
  // With no list named in robots.txt, /sitemap.xml is read, and the evidence says it wasn't named.
  it('robots.txt names no list: /sitemap.xml is read, marked as not named', async () => {
    const e = await gather({ [`${O}/robots.txt`]: text('User-agent: *\nAllow: /\n') })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, namedInRobots: false, url: `${O}/sitemap.xml` })
  })
  // robots.txt names two lists and the first is gone: the second is read, and both tries are
  // recorded. (verify-found F21)
  it('robots.txt names two lists and the first is gone: the second is read, both recorded', async () => {
    const e = await gather({ [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/old.xml\nSitemap: ${O}/sitemap.xml\n`) })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, url: `${O}/sitemap.xml`, tried: [{ url: `${O}/old.xml`, status: 404 }, { url: `${O}/sitemap.xml`, status: 200 }] })
  })
  // A list robots.txt names on another site is recorded but never opened. (verify-found F25)
  it('a list named only on another site: recorded, never opened', async () => {
    const f = site({ [`${O}/robots.txt`]: text('User-agent: *\nSitemap: https://cdn.sitemaps-host.net/s.xml\n'), [`${O}/sitemap.xml`]: notFound })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap?.namedElsewhere).toEqual(['https://cdn.sitemaps-host.net/s.xml'])
    expect(f.calls.some((c) => c.url.includes('sitemaps-host'))).toBe(false)
  })
  // Google accepts gzip, a plain text list and feeds, so we read them all; a web page where the
  // list should be is not a list. (verify-found F20)
  it.each<[string, Record<string, Route>, Partial<NonNullable<SeoEvidence['sitemap']>>]>([
    ['a gzip file', { [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/sitemap.xml.gz\n`), [`${O}/sitemap.xml.gz`]: xml(new Uint8Array(gzipSync(urlset([`${O}/`, `${O}/about`]))), 'application/gzip') }, { status: 200, parsed: true, format: 'xml', urls: [`${O}/`, `${O}/about`] }],
    ['a text list, one address per line', { [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/sitemap.txt\n`), [`${O}/sitemap.txt`]: text(`${O}/\n${O}/about\n`) }, { parsed: true, format: 'text', total: 2 }],
    ['a web page where the list should be', { [`${O}/sitemap.xml`]: page('Home') }, { status: 200, parsed: false, urls: [], total: 0 }],
  ])('%s', async (_name, over, want) => {
    expect((await gather(over)).sitemap).toMatchObject(want)
  })
  // A gzip bomb (64 MB of spaces packed small) stops at the unpacking cap instead of filling
  // memory, and is marked as cut. (verify-found F20, security)
  it('a gzip bomb stops at the cap instead of filling memory', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20)))
    const e = await gather({ [`${O}/robots.txt`]: text(`User-agent: *\nSitemap: ${O}/s.xml.gz\n`), [`${O}/s.xml.gz`]: xml(bomb, 'application/gzip'), [`${O}/sitemap.xml`]: notFound })
    expect(e.sitemap).toMatchObject({ parsed: false, truncated: true })
  })
  // An index is followed one level deep, on this site only: an index inside it, and a list on
  // another host, are never opened.
  it('an index is followed one level deep, on this site only', async () => {
    const f = site({
      [`${O}/sitemap.xml`]: xml(`<sitemapindex><sitemap><loc>${O}/pages.xml</loc></sitemap><sitemap><loc>https://cdn.evil.test/more.xml</loc></sitemap><sitemap><loc>${O}/nested.xml</loc></sitemap></sitemapindex>`),
      [`${O}/pages.xml`]: xml(urlset([[`${O}/about`, '2026-09-01']])),
      [`${O}/nested.xml`]: xml(`<sitemapindex><sitemap><loc>${O}/deeper.xml</loc></sitemap></sitemapindex>`),
      [`${O}/deeper.xml`]: xml(urlset([`${O}/deep`])),
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ parsed: true, urls: [`${O}/about`], lastmods: ['2026-09-01'], total: 1 })
    expect(e.sitemap?.children).toEqual([{ url: `${O}/pages.xml`, status: 200 }, { url: `${O}/nested.xml`, status: 200 }])
    expect(e.sitemap?.offSite?.count).toBe(1)
    expect(f.calls.some((c) => c.url.endsWith('/deeper.xml'))).toBe(false)
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  // An index naming more lists than we open (3) records how many it names. (verify-found F23)
  it('an index naming 5 lists: 3 opened, 5 recorded', async () => {
    const idx = `<sitemapindex>${[1, 2, 3, 4, 5].map((n) => `<sitemap><loc>${O}/s${n}.xml</loc></sitemap>`).join('')}</sitemapindex>`
    const e = await gather({ [`${O}/sitemap.xml`]: xml(idx), [`${O}/s1.xml`]: xml(urlset([`${O}/`])) })
    expect(e.sitemap?.childTotal).toBe(5)
    expect(e.sitemap?.children).toHaveLength(3)
  })
  // Pages the list names on other hosts or private addresses are counted, never visited.
  it('pages the list names on other sites or private addresses: counted, never visited', async () => {
    const f = site({ [`${O}/sitemap.xml`]: xml(urlset([`${O}/`, 'https://evil.test/steal', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/', `${O}/about`, 'https://example.com/faqsheet'])) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/about', '/faqsheet'])
    expect(e.sitemap?.offSite).toEqual({ count: 3, examples: ['https://evil.test/steal', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/'] })
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  // Entries that aren't full addresses are counted as that (not "other sites"), and this site
  // spelled another way (http://, the bare domain) is counted too. (verify-found F25)
  it('entries that aren’t full addresses, and other spellings of this site, are counted', async () => {
    const e = await gather({ [`${O}/sitemap.xml`]: xml('<urlset><url><loc>/</loc></url><url><loc>/about</loc></url><url><loc>http://www.example.com/x</loc></url><url><loc>https://example.com/y</loc></url></urlset>') })
    expect(e.sitemap?.badLocs).toEqual({ count: 2, examples: ['/', '/about'] })
    expect(e.sitemap?.offSite?.count).toBe(0)
    expect(e.sitemap?.otherSpelling).toBe(2)
  })
  // An address with an entity (&amp;) is read as the address it stands for.
  it('an entity in an address is decoded', async () => {
    const e = await gather({ [`${O}/sitemap.xml`]: xml(urlset([`${O}/`, `${O}/search?a=1&amp;b=2`])) })
    expect(e.paths).toEqual(['/', '/search?a=1&b=2'])
  })
})

describe('reading a list of pages (parseSitemap)', () => {
  const CAP = 2 * 1024 * 1024
  // The reader is one straight pass: each hostile file at the 2 MiB cap finishes well under a
  // second (~tens of ms alone) and never throws. A regex here once took 170 s on such a file, and
  // no timeout can stop a regex. The 2 s limit leaves room for a busy full-suite run and still
  // cannot pass by luck. (security review 2026-09-29)
  it.each<[string, string]>([
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
  ])('%s: under 2 s at the cap, never throws', (_name, body) => {
    const t = performance.now()
    expect(() => parseSitemap(body)).not.toThrow()
    expect(performance.now() - t).toBeLessThan(2000)
  })
  // …and a normal list still reads exactly: name prefixes, CDATA, entities and spaces.
  it('a normal list reads exactly (prefixes, CDATA, entities, spaces)', () => {
    const r = parseSitemap(`<?xml version="1.0"?><ns:urlset xmlns:ns="x"><ns:url>\n<ns:loc>\n <![CDATA[${O}/]]>\n</ns:loc><ns:lastmod>2026-09-20</ns:lastmod></ns:url><ns:url><ns:loc> ${O}/a?b=1&amp;c=2 </ns:loc></ns:url></ns:urlset>`)
    expect(r).toEqual({ kind: 'urlset', format: 'xml', locs: [`${O}/`, `${O}/a?b=1&c=2`], lastmods: ['2026-09-20', null] })
  })
  // An address past 8 KB is junk (sitemaps.org: under 2,048 characters): not decoded whole.
  it('an address past 8 KB is not decoded whole', () => {
    expect(parseSitemap(`<urlset><url><loc>${O}/${'a'.repeat(20_000)}</loc></url></urlset>`).locs[0].length).toBeLessThanOrEqual(8192)
  })
  // A character reference past the last Unicode character is replaced, not thrown.
  it('an impossible character reference is replaced, not thrown', () => {
    expect(parseSitemap(`<urlset><url><loc>${O}/&#x110000;</loc></url></urlset>`).locs).toEqual([`${O}/\u{FFFD}`])
  })
  // A text list and RSS / Atom feeds are lists too, as Google reads them; a web page is "html",
  // anything else "other", and neither is a list.
  it.each<[string, string, object]>([
    ['a text list', `${O}/\n${O}/about\n`, { kind: 'urlset', format: 'text', locs: [`${O}/`, `${O}/about`] }],
    ['an RSS feed', `<rss><channel><item><link>${O}/a</link><pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`, { kind: 'urlset', format: 'feed', locs: [`${O}/a`] }],
    ['an Atom feed', `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="${O}/b"/><updated>2026-09-20T10:00:00Z</updated></entry></feed>`, { kind: 'urlset', format: 'feed', locs: [`${O}/b`], lastmods: ['2026-09-20T10:00:00Z'] }],
    ['a web page', page('Home'), { kind: null, format: 'html' }],
    ['JSON', '{"a":1}', { kind: null, format: 'other' }],
  ])('%s', (_name, body, want) => {
    expect(parseSitemap(body)).toMatchObject(want)
  })
})

describe('robots.txt, as fetched', () => {
  // A 5 MB robots.txt is read only as far as the 500 KiB anyone obeys.
  it('a 5 MB file is read only as far as the 500 KiB anyone obeys', async () => {
    const e = await gather({ [`${O}/robots.txt`]: text(`User-agent: *\nDisallow: /x\n${'# filler\n'.repeat(600_000)}`) })
    expect(e.robots.status).toBe(200)
    expect(e.robots.body!.length).toBeLessThanOrEqual(520 * 1024)
    expect(e.robots.body!.startsWith('User-agent: *\nDisallow: /x')).toBe(true)
  })
  // robots.txt is always read as UTF-8 (RFC 9309): a UTF-16 file is junk to Google, so it holds
  // no rules for us either.
  it('is always read as UTF-8: a UTF-16 file holds no rules', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('User-agent: *\nDisallow: /\n').flatMap((c) => [c.charCodeAt(0), 0])])
    const e = await gather({ [`${O}/robots.txt`]: { body: utf16, headers: { 'content-type': 'text/plain' } } })
    expect(e.robots.body).not.toContain('User-agent: *')
  })
  // A robots.txt that redirects to another site is not followed, and where it pointed is kept as
  // the reason. (verify-found F14)
  it('a redirect to another site: not followed, kept as the reason', async () => {
    const e = await gather({ [`${O}/robots.txt`]: { status: 301, location: 'https://cdn.other-host.net/robots.txt' } })
    expect(e.robots).toEqual({ status: null, body: null, error: 'not-allowed: https://cdn.other-host.net/robots.txt' })
  })
})

describe('answers that try to lead us astray', () => {
  // A redirect to a private address or to another site is never followed: the visit has no
  // answer, and where it pointed is named.
  it.each([
    ['a private address', '/about', 'http://169.254.169.254/latest/meta-data/', 'not-public'],
    ['another site', '/', 'https://linktr.ee/someone', 'not-allowed'],
  ])('a redirect to %s: named, never asked', async (_name, path, to, code) => {
    const f = site({ [`${O}${path}`]: { status: 302, location: to } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(plainAt(e, path)).toMatchObject({ status: null, error: `${code}: ${to}` })
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  // A redirect loop ends as "too many redirects", not a hang.
  it('a redirect loop ends as too many redirects', async () => {
    const e = await gather({ [`${O}/about`]: { status: 302, location: `${O}/about/` }, [`${O}/about/`]: { status: 302, location: `${O}/about` } })
    expect(plainAt(e, '/about')).toMatchObject({ status: null, error: 'too-many-redirects' })
  })
  // A page that never ends is cut at 1 MiB and marked as cut.
  it('a page that never ends is cut at 1 MiB and marked', async () => {
    const about = plainAt(await gather({ [`${O}/about`]: { endless: true, headers: { 'content-type': 'text/html' } } }), '/about')!
    expect(about.truncated).toBe(true)
    expect(about.html!.length).toBeLessThanOrEqual(1024 * 1024)
  })
  // A site that is not a public address (a private network, this machine, junk) is never visited
  // at all, and every part of the evidence says why.
  it.each(['http://10.0.0.5', 'http://localhost:3000', 'not a url'])('a site at %s is never visited', async (origin) => {
    const f = site()
    const e = await gatherSiteEvidence(origin, { fetcher: f })
    expect(f.calls).toHaveLength(0)
    expect(e.plain).toEqual([{ path: '/', finalUrl: null, status: null, headers: {}, html: null, error: 'not-public' }])
    expect(e.byBot.googlebot[0].status).toBeNull()
    expect(e.robots).toEqual({ status: null, body: null, error: 'not-public' })
    expect(e.sitemap).toBeNull()
    expect(e.reach).toEqual({ state: 'no-answer', status: null, error: 'not-public' })
  })
})

describe('a page in another character set', () => {
  // A page is read in the character set it names, by header or by <meta charset>, so accented
  // words match what Tapir holds. (verify-found F28)
  it.each([
    ['ISO-8859-1, named in the header', 'Café Señor', page('Home', 'Café Señor'), 'text/html; charset=ISO-8859-1'],
    ['windows-1252, named in a <meta charset>', 'Théâtre', page('Home', 'Théâtre').replace('<head>', '<head><meta charset="windows-1252">'), 'text/html'],
  ])('%s', async (_name, words, html, type) => {
    const bytes = Uint8Array.from(Array.from(html).map((c) => c.charCodeAt(0) & 0xff))
    expect((await gather({ [`${O}/`]: { body: bytes, headers: { 'content-type': type } } })).plain[0].html).toContain(words)
  })
})

describe('one polite retry', () => {
  // A visit that got NO answer (a dropped connection, a timeout) is tried once more, and the
  // second answer is kept.
  it.each<[string, FakeAnswer]>([
    ['a dropped connection', { fail: true }],
    ['a timeout', { hang: true }],
  ])('%s is tried once more, and the second answer kept', async (_name, first) => {
    let n = 0
    const e = await gather({ [`${O}/about`]: () => (n++ === 0 ? first : page('About')) }, { timeoutMs: 100 })
    expect(plainAt(e, '/about')?.status).toBe(200)
  })
  // An answer, even an error, is never asked for again.
  it('an answer, even an error, is never retried', async () => {
    const f = site({ [`${O}/about`]: { status: 503, body: 'down' } })
    await gatherSiteEvidence(O, { fetcher: f })
    expect(f.calls.filter((c) => c.url === `${O}/about` && c.ua === BROWSER_UA)).toHaveLength(1)
  })
  // Only once: a page that keeps failing costs two tries, then "no answer".
  it('a page that keeps failing costs two tries, then no answer', async () => {
    const f = site({ [`${O}/about`]: { fail: true } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(f.calls.filter((c) => c.url === `${O}/about` && c.ua === BROWSER_UA)).toHaveLength(2)
    expect(plainAt(e, '/about')).toMatchObject({ status: null, error: 'network' })
  })
})

describe('being polite', () => {
  // At most 4 requests are open at once (and more than one, or the run would be slow).
  it('never has more than 4 requests open at once', async () => {
    const slow = (html: string): Route => ({ body: html, delayMs: 15, headers: { 'content-type': 'text/html' } })
    const f = site({ [`${O}/`]: slow(page('Home')), [`${O}/about`]: slow(page('About')), [`${O}/faqsheet`]: slow(page('Facts')) })
    await gatherSiteEvidence(O, { fetcher: f })
    expect(f.maxInFlight()).toBeGreaterThan(1)
    expect(f.maxInFlight()).toBeLessThanOrEqual(4)
  })
  // The whole run stops at its time budget: what it didn't reach is "out-of-time" (a no answer
  // the tests read as couldn't check), never a pass, and never mistaken for the site timing out.
  // The bound is the hang's only other way out, its own 10 s limit, not a guess at how fast this
  // machine is: a budget that doesn't cut the hang lands past it, however busy the machine.
  it('the run stops at its time budget: what it didn’t reach is out-of-time', async () => {
    const PER_REQUEST_MS = 10_000
    const t = Date.now()
    const e = await gather({ [`${O}/about`]: { hang: true }, [`${O}/faqsheet`]: { hang: true } }, { budgetMs: 300, timeoutMs: PER_REQUEST_MS })
    expect(Date.now() - t).toBeLessThan(PER_REQUEST_MS)
    expect(plainAt(e, '/about')).toMatchObject({ status: null, error: 'out-of-time' })
    expect(e.byBot.gptbot.find((p) => p.path === '/about')?.status).toBeNull()
  })
  // Each request gives up at its own time limit, and the rest of the run carries on. "timeout",
  // not "out-of-time", says the request's own limit ended it before the run's budget did.
  it('each request gives up at its own time limit, and the rest carries on', async () => {
    const BUDGET_MS = 15_000
    const t = Date.now()
    const e = await gather({ [`${O}/about`]: { hang: true } }, { timeoutMs: 100, budgetMs: BUDGET_MS })
    expect(Date.now() - t).toBeLessThan(BUDGET_MS)
    expect(plainAt(e, '/about')).toMatchObject({ status: null, error: 'timeout' })
    expect(plainAt(e, '/faqsheet')).toMatchObject({ status: 200 })
  })
})

describe('did the site answer at all', () => {
  // How the home page answered is the one run-level fact the page shows once ("we couldn't reach
  // your site"): answered, a server error, refused, or no answer.
  it.each<[string, Route | undefined, NonNullable<SeoEvidence['reach']>]>([
    ['answered', undefined, { state: 'answered', status: 200 }],
    ['a server error', { status: 500, body: 'x' }, { state: 'server-error', status: 500 }],
    ['refused', { status: 403, body: 'x' }, { state: 'refused', status: 403 }],
    ['no answer', { fail: true }, { state: 'no-answer', status: null, error: 'network' }],
  ])('%s', async (_name, home, reach) => {
    expect((await gather(home ? { [`${O}/`]: home } : {})).reach).toEqual(reach)
  })
})

describe('Bing’s file', () => {
  // /BingSiteAuth.xml counts only when it holds a real 32-character Bing code: a site that answers
  // every address with its home page, or a placeholder, is not a code. (verify-found F29)
  it.each<[string, Route, boolean]>([
    ['a file with a real code', xml('<?xml version="1.0"?><users><user>0123456789ABCDEF0123456789ABCDEF</user></users>'), true],
    ['the home page, served for every address', page('Home'), false],
    ['a placeholder code', xml('<users><user>YOUR_CODE_HERE</user></users>'), false],
  ])('%s', async (_name, file, hasUser) => {
    expect((await gather({ [`${O}/BingSiteAuth.xml`]: file })).bing).toEqual({ siteAuth: { status: 200, hasUser } })
  })
})
