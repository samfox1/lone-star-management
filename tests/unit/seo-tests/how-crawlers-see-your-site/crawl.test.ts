/**
 * What the AI test's "How crawlers see your site" section is built from: robots.txt, the sitemap,
 * each page's tags, and every crawler's visit, read by the engine's own rules.
 *
 * Code:     src/lib/seo-tests/crawl.ts (buildCrawl)
 * Feature:  SEO / GEO page · the AI test's "How crawlers see your site" section
 *           (prototypes/seo_variants_20260930_r11.html, the Done step's first group)
 * Tier:     STRICT (AGENTS.md "Test depth"): this is stored with the run and shown to the manager
 *           as what their site told each crawler, so it must say what the engine saw, read by
 *           the engine's own rules (a second reading could disagree with the 24 tests).
 * Covers:   • robots.txt: the file cut at 2,000 characters; every crawler in SEO_BOTS order with
 *             its verdict, why, and the deciding group and rule as robots.txt lines; a Disallow
 *             for one crawler, a crawler that follows another's group (Applebot → Googlebot),
 *             no file (404), a server error (5xx), no answer
 *           • the sitemap: its address, answer, total, the first 50 pages as paths with their
 *             dates and the status a person got (joined the `list` test's way), and "every page
 *             has the same date"
 *           • each opened page: the canonical each visitor was given (absolute), noindex from the
 *             meta tag vs the header (the `allowed` test's rule, and never a different verdict
 *             from it), and each VISITING crawler's status
 *           • hostile text stays plain text; junk evidence never throws; otherHost / listing pass through
 * Not here: how the evidence is gathered (can-be-found/evidence.test.ts); what the 24 tests
 *           conclude (the other folders); asking Google / Bing and the other spelling (runs/
 *           running.test.ts); storing and rendering the section (store / page tests).
 * Fixtures: a Skeen-like site gathered by the REAL gatherer (evidence.ts) from a fake web
 *           (../fake-site.ts), and the "Can be found" fixture site (../found-fixtures.ts) with one
 *           thing changed per test. The crawler list and its order come from bots.ts, never
 *           typed out here.
 */
import { describe, expect, it } from 'vitest'
import { FETCHING_BOTS, SEO_BOTS } from '@/lib/seo-tests/bots'
import { buildCrawl } from '@/lib/seo-tests/crawl'
import { gatherSiteEvidence } from '@/lib/seo-tests/evidence'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoCrawl, SeoEvidence } from '@/lib/seo-tests/types'
import { fakeSite, type FakeAnswer } from '@tests/unit/seo-tests/fake-site'
import { ABOUT, HOME, O, doc, evidence, fetched, type Fixture } from '@tests/unit/seo-tests/found-fixtures'

const NONE = { otherHost: null, listing: { google: null, bing: null } } as const
const crawlOf = (f: Fixture = {}) => buildCrawl(evidence(f), NONE)
const bot = (c: SeoCrawl, key: string) => c.robots.bots.find((b) => b.key === key)!
const pageAt = (c: SeoCrawl, path: string) => c.pages.find((p) => p.path === path)!
const TOKEN_ONLY = SEO_BOTS.filter((b) => !b.fetches)

/* ── a Skeen-like site, gathered by the real gatherer ───────────────────────────────── */

const SK = 'https://www.skeenlike.example'
const DAY = '2026-09-29'
const skPage = (title: string, path: string) => doc(title, `<main><h1>${title}</h1><p>Words about ${title} for people to read.</p></main>`, `<link rel="canonical" href="${SK}${path}">`)
const text = (body: string): FakeAnswer => ({ body, headers: { 'content-type': 'text/plain' } })
const SK_ROBOTS = `User-Agent: *\nAllow: /\n\nHost: ${SK}\nSitemap: ${SK}/sitemap.xml`
const SK_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/about', '/faqsheet'].map((p) => `<url><loc>${SK}${p}</loc><lastmod>${DAY}</lastmod></url>`).join('')}</urlset>`

async function skeenLike(): Promise<SeoEvidence> {
  const fetcher = fakeSite({
    // The bare domain sends every visitor to www, as Skeen's does.
    'https://skeenlike.example/': { status: 308, location: `${SK}/` },
    [`${SK}/`]: skPage('Skeen', '/'),
    [`${SK}/about`]: skPage('About', '/about'),
    [`${SK}/faqsheet`]: skPage('Facts', '/faqsheet'),
    [`${SK}/robots.txt`]: text(SK_ROBOTS),
    [`${SK}/sitemap.xml`]: { body: SK_SITEMAP, headers: { 'content-type': 'application/xml' } },
  })
  const site = await gatherSiteEvidence('https://skeenlike.example', { fetcher })
  return { ...site, shareImage: null, musicbrainz: { looked: false, artistUrl: null, matchedOn: null }, known: evidence().known }
}

describe('a healthy site, as the real gatherer saw it', () => {
  // Every crawler the tests know, in SEO_BOTS order, named as a person and as robots.txt knows
  // it; token-only names (Google-Extended, Applebot-Extended) marked as never visiting.
  it('lists every crawler in SEO_BOTS order, and the file as the site sent it', async () => {
    const e = await skeenLike()
    const c = buildCrawl(e, NONE)
    expect(c.v).toBe(1)
    expect(c.robots.url).toBe(`${SK}/robots.txt`)
    expect(c.robots.status).toBe(200)
    expect(c.robots.text).toBe(SK_ROBOTS)
    expect(c.robots.truncated).toBe(false)
    expect(c.robots.bots.map((b) => [b.key, b.who, b.token, b.visits])).toEqual(SEO_BOTS.map((b) => [b.key, b.who, b.robotsToken, b.fetches]))
    // "User-Agent: *" + "Allow: /" decides for every one of them.
    for (const b of c.robots.bots) expect({ key: b.key, verdict: b.verdict, why: b.why, group: b.group, rule: b.rule }).toEqual({ key: b.key, verdict: 'allowed', why: 'rules', group: 'User-agent: *', rule: 'Allow: /' })
  })

  // The sitemap as read: its address, answer, that robots.txt names it, and each page with the
  // status a person got; three pages on one date are "the same date".
  it('shows the sitemap’s pages with their dates and the status a person got', async () => {
    const c = buildCrawl(await skeenLike(), NONE)
    expect(c.sitemap).toEqual({
      url: `${SK}/sitemap.xml`, status: 200, namedInRobots: true, total: 3, sameDates: true,
      pages: ['/', '/about', '/faqsheet'].map((path) => ({ path, lastmod: DAY, status: 200 })),
    })
  })

  // One row per page the run opened: each visitor was told the page is its own main address,
  // nothing says noindex, and every VISITING crawler got a 200. Token-only names have no visits.
  it('reports each opened page: canonicals per visitor, no noindex, every visiting crawler’s status', async () => {
    const e = await skeenLike()
    const c = buildCrawl(e, NONE)
    expect(c.pages.map((p) => p.path)).toEqual(e.paths)
    for (const p of c.pages) {
      const self = `${SK}${p.path}`
      expect(p.status).toBe(200)
      expect(p.canonical).toEqual({ person: self, google: self, bing: self })
      expect(p.noindex).toEqual({ meta: false, header: false })
      expect(Object.keys(p.visits)).toEqual(FETCHING_BOTS.map((b) => b.key))
      expect(Object.values(p.visits).every((s) => s === 200)).toBe(true)
      for (const t of TOKEN_ONLY) expect(p.visits).not.toHaveProperty(t.key)
    }
  })

  // The other spelling and the listing are the run's to find out; the builder keeps them as given.
  it('keeps the other spelling and the listing exactly as the run found them', async () => {
    const otherHost = { url: 'https://skeenlike.example/', status: 200, to: `${SK}/` }
    const listing = { google: [{ path: '/', answered: true, verdict: 'PASS', coverage: 'Submitted and indexed', lastCrawl: '2026-09-29T08:15:02.000Z' }], bing: null }
    const c = buildCrawl(await skeenLike(), { otherHost, listing })
    expect(c.otherHost).toEqual(otherHost)
    expect(c.listing).toEqual(listing)
  })
})

/* ── robots.txt ─────────────────────────────────────────────────────────────────────── */

describe('robots.txt', () => {
  // A file that names one crawler: that crawler is blocked by its OWN group, spelled the way
  // robots.txt knows it; everyone else falls to "*".
  it('names the group and rule that blocked one crawler', () => {
    const c = crawlOf({ robots: { status: 200, body: 'user-agent: gptbot\ndisallow: /\n\nUser-agent: *\nAllow: /\n' } })
    expect(bot(c, 'gptbot')).toMatchObject({ verdict: 'blocked', why: 'rules', group: 'User-agent: GPTBot', rule: 'Disallow: /' })
    for (const b of c.robots.bots.filter((x) => x.key !== 'gptbot')) expect(b, b.key).toMatchObject({ verdict: 'allowed', group: 'User-agent: *', rule: 'Allow: /' })
  })

  // Apple's rule: with no Applebot group, Applebot follows Googlebot's. The group shown is
  // Googlebot's, so the manager sees WHY Apple is blocked.
  it('shows the group a crawler falls back to (Applebot follows Googlebot)', () => {
    const fallback = SEO_BOTS.find((b) => b.robotsFallback?.length)!
    const c = crawlOf({ robots: { status: 200, body: `User-agent: ${fallback.robotsFallback![0]}\nDisallow: /\n\nUser-agent: *\nAllow: /\n` } })
    expect(bot(c, fallback.key)).toMatchObject({ verdict: 'blocked', group: `User-agent: ${fallback.robotsFallback![0]}`, rule: 'Disallow: /' })
  })

  // A group with no rule for "/" (only /private is closed): allowed, the group named, no rule.
  it('says no rule matched when the group has none for the home page', () => {
    const c = crawlOf({ robots: { status: 200, body: 'User-agent: *\nDisallow: /private\n' } })
    expect(bot(c, 'googlebot')).toMatchObject({ verdict: 'allowed', why: 'rules', group: 'User-agent: *', rule: null })
    // Judged at the home page itself: "Allow: /$" opens "/" only, "Disallow: /" closes the rest.
    const homeOnly = crawlOf({ robots: { status: 200, body: 'User-agent: *\nDisallow: /\nAllow: /$\n' } })
    expect(bot(homeOnly, 'googlebot')).toMatchObject({ verdict: 'allowed', rule: 'Allow: /$' })
    // An empty file: rules read, no group at all.
    expect(bot(crawlOf({ robots: { status: 200, body: '' } }), 'googlebot')).toMatchObject({ verdict: 'allowed', why: 'rules', group: null, rule: null })
  })

  // No file (404): every crawler may go anywhere (RFC 9309). No text, no group, no rule.
  it('no file: every crawler allowed, nothing to quote', () => {
    const c = crawlOf({ robots: { status: 404, body: null } })
    expect(c.robots).toMatchObject({ status: 404, text: null, truncated: false })
    for (const b of c.robots.bots) expect({ verdict: b.verdict, why: b.why, group: b.group, rule: b.rule }).toEqual({ verdict: 'allowed', why: 'no-file', group: null, rule: null })
  })

  // A server error (5xx): crawlers must assume they are shut out of the whole site (RFC 9309).
  it('a server error: every crawler blocked', () => {
    const c = crawlOf({ robots: { status: 503, body: null } })
    for (const b of c.robots.bots) expect({ verdict: b.verdict, why: b.why, group: b.group, rule: b.rule }).toEqual({ verdict: 'blocked', why: 'server-error', group: null, rule: null })
  })

  // No answer at all: we can't say, for anyone.
  it('no answer: unknown for every crawler', () => {
    const c = crawlOf({ robots: { status: null, body: null, error: 'timeout' } })
    expect(c.robots.status).toBeNull()
    for (const b of c.robots.bots) expect([b.verdict, b.why]).toEqual(['unknown', 'no-answer'])
  })

  // The file is quoted up to 2,000 characters; longer is cut and says so. A character made of
  // two UTF-16 units is never split in half at the cut.
  it('quotes the first 2,000 characters and says when it was cut', () => {
    const exact = `User-agent: *\nAllow: /\n#${'x'.repeat(3000)}`.slice(0, 2000)
    expect(exact).toHaveLength(2000)
    expect(crawlOf({ robots: { status: 200, body: exact } }).robots).toMatchObject({ text: exact, truncated: false })
    const long = `${exact}yz`
    expect(crawlOf({ robots: { status: 200, body: long } }).robots).toMatchObject({ text: exact, truncated: true })
    const emoji = `${'a'.repeat(1999)}🎵rest`
    const cut = crawlOf({ robots: { status: 200, body: emoji } }).robots
    expect(cut.truncated).toBe(true)
    expect(cut.text).toBe('a'.repeat(1999))
  })
})

/* ── the sitemap ────────────────────────────────────────────────────────────────────── */

const sm = (urls: string[], lastmods: (string | null)[], over: Partial<NonNullable<SeoEvidence['sitemap']>> = {}): NonNullable<SeoEvidence['sitemap']> => ({
  status: 200, urls, lastmods, url: `${O}/sitemap.xml`, parsed: true, namedInRobots: true, total: urls.length, offSite: { count: 0, examples: [] }, ...over,
})

describe('the sitemap', () => {
  // "Same dates" only when there is more than one page and every one carries the same date.
  it('says every page has the same date only when that is true of more than one page', () => {
    const same = (urls: string[], lastmods: (string | null)[]) => crawlOf({ sitemap: sm(urls, lastmods) }).sitemap.sameDates
    expect(same([`${O}/`, `${O}/about`], [DAY, DAY])).toBe(true)
    expect(same([`${O}/`, `${O}/about`], [DAY, '2026-09-20'])).toBe(false)
    expect(same([`${O}/`, `${O}/about`], [DAY, null])).toBe(false)
    expect(same([`${O}/`, `${O}/about`], [null, null])).toBe(false)
    expect(same([`${O}/`], [DAY])).toBe(false)
  })

  // The total is every page the list names, not the pages we kept; the list is shown only as
  // its first 50, in the list's order.
  it('counts every page, shows the first 50', () => {
    const urls = Array.from({ length: 120 }, (_, i) => `${O}/p${i}`)
    const c = crawlOf({ sitemap: sm(urls, urls.map(() => DAY), { total: 812 }) }).sitemap
    expect(c.total).toBe(812)
    expect(c.pages).toHaveLength(50)
    expect(c.pages.map((p) => p.path)).toEqual(urls.slice(0, 50).map((u) => u.slice(O.length)))
    // Evidence from before `total` existed: the pages it holds.
    const { total: _t, ...noTotal } = sm([`${O}/`, `${O}/about`], [DAY, DAY])
    void _t
    expect(crawlOf({ sitemap: noTotal }).sitemap.total).toBe(2)
  })

  // Each listed page carries the status a person got WHEN the run opened it, matched the `list`
  // test's way (a trailing slash is the same page); a page we didn't open has none.
  it('joins each listed page to the status a person got, or none when it wasn’t opened', () => {
    const c = crawlOf({
      pages: { '/': HOME, '/about': ABOUT, '/tour': HOME },
      plain: { '/tour': { status: 404, html: null } },
      sitemap: sm([`${O}/`, `${O}/about/`, `${O}/tour`, `${O}/press?x=1`], [DAY, DAY, null, DAY]),
    }).sitemap
    expect(c.pages).toEqual([
      { path: '/', lastmod: DAY, status: 200 },
      { path: '/about/', lastmod: DAY, status: 200 },
      { path: '/tour', lastmod: null, status: 404 },
      { path: '/press?x=1', lastmod: DAY, status: null },
    ])
  })

  // An address on another site is never "one of your pages".
  it('leaves out addresses on other sites', () => {
    const c = crawlOf({ sitemap: sm([`${O}/`, 'https://cdn.other.example/x', 'not a url'], [DAY, DAY, DAY]) }).sitemap
    expect(c.pages.map((p) => p.path)).toEqual(['/'])
  })

  // No sitemap read at all: nothing listed, nothing claimed.
  it('no sitemap: empty, never invented', () => {
    expect(crawlOf({ sitemap: null }).sitemap).toEqual({ url: null, status: null, namedInRobots: false, total: 0, pages: [], sameDates: false })
  })
})

/* ── each opened page ───────────────────────────────────────────────────────────────── */

const withCanonical = (href: string, extraHead = '') => doc('About Skeen', '<main><h1>About</h1><p>Skeen is a Chicago DJ and producer.</p></main>', `${extraHead}<link rel="canonical" href="${href}">`)
const NO_CANONICAL = doc('About Skeen', '<main><h1>About</h1><p>Skeen is a Chicago DJ and producer.</p></main>')

describe('canonicals, per visitor', () => {
  // Each visitor's own copy is read: a relative canonical is made absolute against where the
  // page answered, Google can be handed a different one, and a copy with none says none.
  it('shows the canonical each visitor was given, as an absolute address', () => {
    const c = crawlOf({
      pages: { '/': HOME, '/about': withCanonical('/about') },
      bots: { googlebot: { '/about': { html: withCanonical('https://www.example.com/') } }, bingbot: { '/about': { html: NO_CANONICAL } } },
    })
    expect(pageAt(c, '/about').canonical).toEqual({ person: `${O}/about`, google: `${O}/`, bing: null })
  })

  // A `<base href>` moves where a relative canonical points; a Link header canonical counts too.
  it('reads <base href> and a Link header, the way the `allowed` test does', () => {
    const based = crawlOf({ pages: { '/': HOME, '/about': withCanonical('about', '<base href="https://www.example.com/en/">') } })
    expect(pageAt(based, '/about').canonical.person).toBe(`${O}/en/about`)
    const header = crawlOf({ pages: { '/': HOME, '/about': NO_CANONICAL }, plain: { '/about': { headers: { 'content-type': 'text/html', link: `<${O}/about-us>; rel="canonical"` } } } })
    expect(pageAt(header, '/about').canonical.person).toBe(`${O}/about-us`)
  })

  // A page we couldn't read (an error, no answer) has no canonical to show, never a guess.
  it('has none for a visit that isn’t a readable page', () => {
    const c = crawlOf({ plain: { '/about': { status: 500, html: null } }, bots: { googlebot: { '/about': { status: null, html: null, error: 'timeout' } } } })
    expect(pageAt(c, '/about').canonical).toEqual({ person: null, google: null, bing: `${O}/about` })
  })
})

describe('noindex: the meta tag vs the header', () => {
  const NOINDEX_META = doc('About Skeen', '<main><h1>About</h1><p>Words.</p></main>', '<meta name="robots" content="noindex, follow">')
  const allowedSaysNoindex = (f: Fixture) => /asks search engines not to list it/.test(FOUND_TESTS.allowed(evidence(f)).evidence.map((r) => r.value).join(' '))

  // The tag and the header are told apart, and each is read for the person AND for Google and
  // Bing's own copies (a site can hand only Googlebot a noindex).
  it.each<[string, Fixture, { meta: boolean; header: boolean }]>([
    ['a robots meta tag for everyone', { pages: { '/': HOME, '/about': NOINDEX_META } }, { meta: true, header: false }],
    ['an X-Robots-Tag header', { plain: { '/about': { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } } } }, { meta: false, header: true }],
    ['a header only Googlebot is sent', { bots: { googlebot: { '/about': { headers: { 'x-robots-tag': 'googlebot: noindex' } } } } }, { meta: false, header: true }],
    ['"none", which includes noindex', { plain: { '/about': { headers: { 'x-robots-tag': 'none' } } } }, { meta: false, header: true }],
    ['a header scoped to another crawler', { plain: { '/about': { headers: { 'x-robots-tag': 'otherbot: noindex' } } } }, { meta: false, header: false }],
    ['nofollow alone', { plain: { '/about': { headers: { 'x-robots-tag': 'nofollow' } } } }, { meta: false, header: false }],
  ])('%s', (_name, f, want) => {
    expect(pageAt(crawlOf(f), '/about').noindex).toEqual(want)
    // Never a different answer from the `allowed` test, which reads the same rule.
    expect(allowedSaysNoindex(f)).toBe(want.meta || want.header)
  })
})

describe('visits', () => {
  // Every VISITING crawler's answer on each page, by its key; a crawler we have no visit for is
  // null (no answer), never left out and never a guess.
  it('gives each visiting crawler’s status, null when there was no answer', () => {
    const c = crawlOf({ bots: { gptbot: { '/about': { status: 403, html: null } }, ccbot: { '/about': { status: null, html: null, error: 'timeout' } } } })
    const v = pageAt(c, '/about').visits
    expect(Object.keys(v)).toEqual(FETCHING_BOTS.map((b) => b.key))
    expect(v.gptbot).toBe(403)
    expect(v.ccbot).toBeNull()
    expect(v.googlebot).toBe(200)
    const e = evidence()
    delete e.byBot.claudebot
    expect(pageAt(buildCrawl(e, NONE), '/').visits.claudebot).toBeNull()
  })
})

/* ── hostile and broken input ───────────────────────────────────────────────────────── */

describe('hostile and broken input', () => {
  // Everything here came from the artist's site: it is kept as the exact text, never parsed,
  // escaped or dropped here (the page renders it as text).
  it('keeps hostile text as plain strings', () => {
    const script = '<script>alert(1)</script>'
    const c = crawlOf({
      robots: { status: 200, body: `User-agent: *\nDisallow: /${script}\n` },
      sitemap: sm([`${O}/`, `${O}/about`], [`"><img src=x onerror=alert(2)>`, DAY]),
      pages: { '/': HOME, '/about': withCanonical('javascript:alert(3)') },
    })
    expect(c.robots.text).toContain(script)
    expect(bot(c, 'googlebot').rule).toBeNull()
    expect(c.sitemap.pages[0].lastmod).toBe('"><img src=x onerror=alert(2)>')
    expect(pageAt(c, '/about').canonical.person).toBe('javascript:alert(3)')
  })

  // Missing or junk evidence is empty answers, never a throw (the run must still be stored).
  it('never throws on missing or junk evidence', () => {
    const junk = [{}, { origin: 42, paths: 'x', plain: null, byBot: 'x', robots: 'x', sitemap: { urls: 'x', lastmods: null } }, { paths: ['/', 7], plain: [null, 5], byBot: { googlebot: [null] } }]
    for (const e of junk) {
      const c = buildCrawl(e as unknown as SeoEvidence, NONE)
      expect(c.v).toBe(1)
      expect(c.robots.bots.map((b) => b.key)).toEqual(SEO_BOTS.map((b) => b.key))
      expect(Array.isArray(c.pages) && Array.isArray(c.sitemap.pages)).toBe(true)
    }
    expect(buildCrawl({} as SeoEvidence, NONE).robots.bots.every((b) => b.verdict === 'unknown')).toBe(true)
  })

  // A page row per opened path, even when a visit is missing: the fact is "no answer".
  it('keeps a row for an opened page with no visit recorded', () => {
    const e = evidence()
    e.plain = [fetched('/', HOME)]
    const about = pageAt(buildCrawl(e, NONE), '/about')
    expect(about.status).toBeNull()
    expect(about.canonical.person).toBeNull()
  })
})
