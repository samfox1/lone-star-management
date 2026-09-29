/**
 * gatherSiteEvidence: every fetch the "Can be found" tests read, gathered once (STRICT: it
 * fetches addresses a manager and a site's own files hand the server, AGENTS.md). A fake web,
 * no network. The bots and their User-Agents come from the registry (AGENTS.md rule 4).
 */
import { describe, expect, it } from 'vitest'
import { BROWSER_UA, FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { gatherSiteEvidence, sameSite } from '@/lib/seo-tests/evidence'
import { fakeSite, type Route } from '@tests/unit/seo-tests/fake-site'

const O = 'https://www.example.com'
const page = (title: string, body = '') => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body || `Words about ${title} for people to read.`}</p></body></html>`
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n`
const urlset = (entries: [string, string?][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`
const xml = (body: string) => ({ body, headers: { 'content-type': 'application/xml' } })

/** A healthy three-page site. `over` replaces any route. */
function healthy(over: Record<string, Route> = {}) {
  return fakeSite({
    [`${O}/`]: page('Home'),
    [`${O}/about`]: page('About'),
    [`${O}/faqsheet`]: page('Facts'),
    [`${O}/robots.txt`]: { body: ROBOTS, headers: { 'content-type': 'text/plain' } },
    [`${O}/sitemap.xml`]: xml(urlset([[`${O}/`, '2026-09-28'], [`${O}/about`, '2026-09-20'], [`${O}/faqsheet`]])),
    ...over,
  })
}

const hosts = (calls: { url: string }[]) => [...new Set(calls.map((c) => new URL(c.url).host))]

describe('sameSite: the one rule for "this site"', () => {
  it('www and the bare domain are the same site, over http or https', () => {
    expect(sameSite('https://example.com/a', O)).toBe(true)
    expect(sameSite('http://www.example.com/a', O)).toBe(true)
    expect(sameSite('https://WWW.Example.COM./a', O)).toBe(true)
    expect(sameSite('https://www.example.com/a', 'https://example.com')).toBe(true)
  })
  it('anything else is another site', () => {
    for (const u of ['https://evil.example.com/', 'https://example.com.evil.test/', 'https://wwwexample.com/', 'https://www.www.example.com/', 'https://example.com@evil.test/', 'ftp://www.example.com/', 'javascript:alert(1)', 'not a url', 'https://www.example.com:8443/']) {
      expect([u, sameSite(u, O)]).toEqual([u, false])
    }
  })
})

describe('a healthy site', () => {
  it('visits "/" and the sitemap pages as a person and as every bot, with each bot\'s exact name', async () => {
    const f = healthy()
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
    // The plain visit is a browser's, and every page was asked for exactly once per visitor.
    expect(f.calls.filter((c) => c.ua === BROWSER_UA && /\/(about|faqsheet)?$/.test(new URL(c.url).pathname))).toHaveLength(3)
    expect(e.robots).toEqual({ status: 200, body: ROBOTS })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, namedInRobots: true, total: 3, url: `${O}/sitemap.xml`, urls: [`${O}/`, `${O}/about`, `${O}/faqsheet`], lastmods: ['2026-09-28', '2026-09-20', null] })
    expect(e.bing).toEqual({ siteAuth: { status: 404, hasUser: false } })
    expect(Date.parse(e.gatheredAt)).not.toBeNaN()
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  it('keeps only the headers a test reads', async () => {
    const f = healthy({ [`${O}/`]: { body: page('Home'), headers: { 'X-Robots-Tag': 'noindex', 'Set-Cookie': 'session=secret', 'content-type': 'text/html', Server: 'Vercel', 'X-Vercel-Mitigated': 'challenge', 'X-Powered-By': 'Next.js', Link: '<https://www.example.com/>; rel="canonical"' } } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.plain[0].headers).toEqual({ 'x-robots-tag': 'noindex', 'content-type': 'text/html', server: 'Vercel', 'x-vercel-mitigated': 'challenge', link: '<https://www.example.com/>; rel="canonical"' })
  })
  it('keeps html only for a 2xx web page', async () => {
    const f = healthy({
      [`${O}/about`]: { status: 403, body: '<html>Sorry, you have been blocked</html>', headers: { 'content-type': 'text/html' } },
      [`${O}/faqsheet`]: { body: '{"a":1}', headers: { 'content-type': 'application/json' } },
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.plain.map((p) => [p.status, p.html === null])).toEqual([[200, false], [403, true], [200, true]])
  })
  it('starts from where the home page really lives (bare domain → www), so pages are not redirected twice', async () => {
    const f = healthy({ 'https://example.com/': { status: 308, location: `${O}/` } })
    const e = await gatherSiteEvidence('https://example.com/', { fetcher: f })
    expect(e.origin).toBe(O)
    expect(e.paths).toEqual(['/', '/about', '/faqsheet'])
    expect(f.calls.filter((c) => new URL(c.url).host === 'example.com')).toHaveLength(1)
  })
})

describe('the sitemap', () => {
  it('reads /sitemap.xml when robots.txt names none, and says so', async () => {
    const f = healthy({ [`${O}/robots.txt`]: 'User-agent: *\nAllow: /\n' })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: true, namedInRobots: false, url: `${O}/sitemap.xml` })
  })
  it('an html page where the sitemap should be is not a sitemap', async () => {
    const f = healthy({ [`${O}/sitemap.xml`]: page('Home') })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ status: 200, parsed: false, urls: [], total: 0 })
    expect(e.paths).toEqual(['/'])
  })
  it('never visits pages the sitemap lists on other hosts or private addresses, and counts them', async () => {
    const f = healthy({
      [`${O}/sitemap.xml`]: xml(urlset([[`${O}/`], ['https://evil.test/steal'], ['http://169.254.169.254/latest/meta-data/'], ['http://localhost:3000/'], [`${O}/about`], ['https://example.com/faqsheet']])),
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/about', '/faqsheet'])
    expect(e.sitemap?.offSite).toEqual({ count: 3, examples: ['https://evil.test/steal', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/'] })
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  it('a sitemap of 10,000 pages: visits 5, keeps a capped list, counts them all', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => [`${O}/p${i}`] as [string])
    const f = healthy({ [`${O}/sitemap.xml`]: xml(urlset(many)) }, )
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/p0', '/p1', '/p2', '/p3'])
    expect(e.sitemap?.total).toBe(10_000)
    expect(e.sitemap!.urls.length).toBeLessThanOrEqual(500)
    expect(e.sitemap!.urls.length).toBe(e.sitemap!.lastmods.length)
    // 5 pages × (1 person + every bot) + robots + sitemap + Bing's file, and nothing more.
    expect(f.calls.length).toBe(5 * (1 + FETCHING_BOTS.length) + 3)
  })
  it('follows a sitemap index one level deep, on this site only', async () => {
    const f = healthy({
      [`${O}/sitemap.xml`]: xml(`<sitemapindex><sitemap><loc>${O}/pages.xml</loc></sitemap><sitemap><loc>https://cdn.evil.test/more.xml</loc></sitemap><sitemap><loc>${O}/nested.xml</loc></sitemap></sitemapindex>`),
      [`${O}/pages.xml`]: xml(urlset([[`${O}/about`, '2026-09-01']])),
      [`${O}/nested.xml`]: xml(`<sitemapindex><sitemap><loc>${O}/deeper.xml</loc></sitemap></sitemapindex>`),
      [`${O}/deeper.xml`]: xml(urlset([[`${O}/deep`]])),
    })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.sitemap).toMatchObject({ parsed: true, urls: [`${O}/about`], lastmods: ['2026-09-01'], total: 1 })
    expect(e.sitemap?.children).toEqual([{ url: `${O}/pages.xml`, status: 200 }, { url: `${O}/nested.xml`, status: 200 }])
    expect(e.sitemap?.offSite?.count).toBe(1)
    expect(f.calls.some((c) => c.url.endsWith('/deeper.xml'))).toBe(false)
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  it('decodes entities in a <loc>', async () => {
    const f = healthy({ [`${O}/sitemap.xml`]: xml(urlset([[`${O}/`], [`${O}/search?a=1&amp;b=2`]])) })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.paths).toEqual(['/', '/search?a=1&b=2'])
  })
})

describe('hostile answers', () => {
  it('a page that redirects to a private address: no answer, the address named, never asked', async () => {
    const f = healthy({ [`${O}/about`]: { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    const about = e.plain.find((p) => p.path === '/about')!
    expect(about.status).toBeNull()
    expect(about.error).toBe('not-public: http://169.254.169.254/latest/meta-data/')
    expect(f.calls.some((c) => c.url.includes('169.254'))).toBe(false)
  })
  it('a page that redirects to another site: no answer, the other site named, never asked', async () => {
    const f = healthy({ [`${O}/`]: { status: 302, location: 'https://linktr.ee/someone' } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.plain[0]).toMatchObject({ status: null, error: 'not-allowed: https://linktr.ee/someone' })
    expect(hosts(f.calls)).toEqual(['www.example.com'])
  })
  it('a redirect loop ends as "too-many-redirects"', async () => {
    const f = healthy({ [`${O}/about`]: { status: 302, location: `${O}/about/` }, [`${O}/about/`]: { status: 302, location: `${O}/about` } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.plain.find((p) => p.path === '/about')).toMatchObject({ status: null, error: 'too-many-redirects' })
  })
  it('an endless page is cut and marked', async () => {
    const f = healthy({ [`${O}/about`]: { endless: true, headers: { 'content-type': 'text/html' } } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    const about = e.plain.find((p) => p.path === '/about')!
    expect(about.truncated).toBe(true)
    expect(about.html!.length).toBeLessThanOrEqual(1024 * 1024)
  })
  it('a 5 MB robots.txt is read only as far as the 500 KiB anyone obeys', async () => {
    const f = healthy({ [`${O}/robots.txt`]: { body: `User-agent: *\nDisallow: /x\n${'# filler\n'.repeat(600_000)}`, headers: { 'content-type': 'text/plain' } } })
    const e = await gatherSiteEvidence(O, { fetcher: f })
    expect(e.robots.status).toBe(200)
    expect(e.robots.body!.length).toBeLessThanOrEqual(520 * 1024)
    expect(e.robots.body!.startsWith('User-agent: *\nDisallow: /x')).toBe(true)
  })
  it('a site that is not a public address is never visited', async () => {
    for (const origin of ['http://10.0.0.5', 'http://localhost:3000', 'not a url']) {
      const f = healthy()
      const e = await gatherSiteEvidence(origin, { fetcher: f })
      expect(f.calls).toHaveLength(0)
      expect(e.plain).toEqual([{ path: '/', finalUrl: null, status: null, headers: {}, html: null, error: 'not-public' }])
      expect(e.byBot.googlebot[0].status).toBeNull()
      expect(e.robots).toEqual({ status: null, body: null })
      expect(e.sitemap).toBeNull()
    }
  })
})

describe('being polite', () => {
  it('never has more than 4 requests open at once', async () => {
    const slow = (html: string): Route => ({ body: html, delayMs: 15, headers: { 'content-type': 'text/html' } })
    const f = healthy({ [`${O}/`]: slow(page('Home')), [`${O}/about`]: slow(page('About')), [`${O}/faqsheet`]: slow(page('Facts')) })
    await gatherSiteEvidence(O, { fetcher: f })
    expect(f.maxInFlight()).toBeGreaterThan(1)
    expect(f.maxInFlight()).toBeLessThanOrEqual(4)
  })
  it('one run stops at its time budget: what was not reached is "no answer", not a pass', async () => {
    const f = healthy({ [`${O}/about`]: { hang: true }, [`${O}/faqsheet`]: { hang: true } })
    const t = Date.now()
    const e = await gatherSiteEvidence(O, { fetcher: f, budgetMs: 400, timeoutMs: 10_000 })
    expect(Date.now() - t).toBeLessThan(2000)
    const about = e.plain.find((p) => p.path === '/about')!
    expect(about.status).toBeNull()
    expect(['timeout', 'out-of-time']).toContain(about.error)
    expect(e.byBot.gptbot.find((p) => p.path === '/about')?.status).toBeNull()
  })
  it('each request gives up at its own timeout', async () => {
    const f = healthy({ [`${O}/about`]: { hang: true } })
    const t = Date.now()
    const e = await gatherSiteEvidence(O, { fetcher: f, timeoutMs: 100 })
    expect(Date.now() - t).toBeLessThan(3000)
    expect(e.plain.find((p) => p.path === '/about')).toMatchObject({ status: null, error: 'timeout' })
    expect(e.plain.find((p) => p.path === '/faqsheet')).toMatchObject({ status: 200 })
  })
})

describe("Bing's file", () => {
  it('reads /BingSiteAuth.xml and whether it names a user', async () => {
    const f = healthy({ [`${O}/BingSiteAuth.xml`]: xml('<?xml version="1.0"?><users><user>0123456789ABCDEF0123456789ABCDEF</user></users>') })
    expect((await gatherSiteEvidence(O, { fetcher: f })).bing).toEqual({ siteAuth: { status: 200, hasUser: true } })
    // A site that answers every address with its home page is not a Bing file.
    const g = healthy({ [`${O}/BingSiteAuth.xml`]: page('Home') })
    expect((await gatherSiteEvidence(O, { fetcher: g })).bing).toEqual({ siteAuth: { status: 200, hasUser: false } })
  })
})
