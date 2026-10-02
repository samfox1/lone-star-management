/**
 * "How crawlers see your site": the rules behind each row's mark and value, and the few words
 * that must stay true (a date that doesn't slip a day, Bing never "listed").
 *
 * Code:     src/lib/manager-tools/seo/crawl-model.ts
 * Feature:  SEO / GEO page · AI test tab · How crawlers see your site (round 11)
 * Tier:     LIGHT for the values' wording (the design is still moving: values are matched on
 *           their numbers, not their sentences). STRICT for what the manager is told is true:
 *           a mark is a check only when nothing blocks, "N of 5 fine" counts checks only, Bing
 *           is never said to list a page, and a sitemap's date is never shifted a day.
 * Covers:   • which crawl is shown: version 1 in its shape, nothing else
 *           • companies: derived from bots.ts; a robots.txt name only sits with its visitor
 *           • robots.txt: allowed / blocked / couldn't read / no file; the shared rule said once
 *           • the sitemap: none, couldn't read, a page that doesn't open, all open
 *           • tags: canonical itself / elsewhere / none; noindex by tag or header
 *           • visits: a refused visit is red, no answer is a ring
 *           • listing: Google PASS / not listed / not asked; Bing's words; neither registered
 *           • the "Ask Google" link: a fixed https host, only its two values vary, both encoded
 *           • dayText: a date with no time is the same day in every zone
 * Not here: drawing any of it (tests/components/manager-tools/seo/crawl-section.test.tsx).
 * Fixtures: healthyCrawl() (tests/helpers/seo/crawl-fixture.ts), its crawler
 *           list derived from bots.ts; each case changes one fact of it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SEO_BOTS } from '@/lib/seo-tests/bots'
import type { SeoCrawl } from '@/lib/seo-tests/types'
import {
  googleNotListed,
  bingWord,
  byCompany,
  canonicalState,
  companyOf,
  crawlFaces,
  crawlToShow,
  dayText,
  decisionOf,
  fineCount,
  googleWord,
  listingFace,
  requestIndexingHref,
  robotsFace,
  robotsLead,
  sitemapFace,
  tagsFace,
  visitsFace,
} from '@/lib/manager-tools/seo/crawl-model'
import { ORIGIN, PAGES, healthyCrawl, withBot } from '@tests/helpers/seo/crawl-fixture'

const page = (c: SeoCrawl, path: string) => c.pages.find((p) => p.path === path)!

describe('which crawl is shown', () => {
  // Version 1 with every part: shown. Anything else: nothing (a half-read crawl would say a wrong "fine").
  it('version 1 in its shape, and nothing else', () => {
    const c = healthyCrawl()
    expect(crawlToShow(c)).toBe(c)
    expect(crawlToShow({ ...c, v: 2 })).toBeNull()
    expect(crawlToShow({ ...c, pages: undefined })).toBeNull()
    expect(crawlToShow({ ...c, robots: { ...c.robots, bots: 'x' } })).toBeNull()
    expect(crawlToShow(null)).toBeNull()
    expect(crawlToShow(undefined)).toBeNull()
  })
})

describe('companies', () => {
  // Every crawler bots.ts knows gets a company, and a robots.txt name only (Google-Extended,
  // Applebot-Extended) sits with the crawler that does its visiting.
  it('derived from bots.ts; a robots.txt name only sits with its visitor', () => {
    for (const b of SEO_BOTS) expect(companyOf(b.key, b.who)).toBeTruthy()
    const tokenOnly = SEO_BOTS.filter((b) => b.visitsAs)
    expect(tokenOnly.length).toBeGreaterThan(0)
    for (const b of tokenOnly) {
      const visitor = SEO_BOTS.find((x) => x.key === b.visitsAs)!
      expect(companyOf(b.key, b.who)).toBe(companyOf(visitor.key, visitor.who))
    }
    // Two crawlers read by different tests (outside `others`) are never one company.
    const byTest = new Map<string, string>()
    for (const b of SEO_BOTS.filter((x) => x.test !== 'others' && !x.visitsAs)) byTest.set(b.test, companyOf(b.key, b.who))
    expect(new Set(byTest.values()).size).toBe(byTest.size)
  })

  // Grouping keeps every crawler once, and a company's crawlers together.
  it('groups keep every crawler once', () => {
    const groups = byCompany(healthyCrawl().robots.bots)
    expect(groups.flatMap((g) => g.bots.map((b) => b.key)).sort()).toEqual(SEO_BOTS.map((b) => b.key).sort())
    expect(new Set(groups.map((g) => g.company)).size).toBe(groups.length)
  })
})

describe('robots.txt', () => {
  // Everyone allowed by the rules: a check.
  it('everyone allowed: fine', () => {
    expect(robotsFace(healthyCrawl().robots).mark).toBe('ok')
  })
  // One crawler blocked: red, and the value counts it.
  it('one blocked: red, counted', () => {
    const f = robotsFace(withBot(healthyCrawl(), 'gptbot', { verdict: 'blocked', group: 'User-agent: GPTBot', rule: 'Disallow: /' }).robots)
    expect(f.mark).toBe('bad')
    expect(f.value).toMatch(/\b1\b/)
  })
  // The file couldn't be read: a ring, never a check.
  it('couldn’t read: a ring', () => {
    const c = healthyCrawl()
    const bots = c.robots.bots.map((b) => ({ ...b, verdict: 'unknown' as const, why: 'no-answer' as const, group: null, rule: null }))
    expect(robotsFace({ ...c.robots, status: null, text: null, bots }).mark).toBe('unknown')
  })
  // No file: everyone may visit, so it is fine.
  it('no file: fine', () => {
    const c = healthyCrawl()
    const bots = c.robots.bots.map((b) => ({ ...b, why: 'no-file' as const, group: null, rule: null }))
    expect(robotsFace({ ...c.robots, status: 404, text: null, bots }).mark).toBe('ok')
  })
  // The shared rule is said once, with the group and the rule as they are in the file.
  it('the shared rule is said once', () => {
    const lead = robotsLead(healthyCrawl().robots.bots)!
    expect(lead.words).toContainEqual({ code: 'User-agent: *' })
    expect(lead.words).toContainEqual({ code: 'Allow: /' })
    expect(healthyCrawl().robots.bots.every((b) => decisionOf(b) === lead.common)).toBe(true)
  })
  // One crawler decided differently: the line still covers the rest, and not that one.
  it('one decided differently is not covered by the line', () => {
    const bots = withBot(healthyCrawl(), 'gptbot', { verdict: 'blocked', group: 'User-agent: GPTBot', rule: 'Disallow: /' }).robots.bots
    const lead = robotsLead(bots)!
    expect(decisionOf(bots.find((b) => b.key === 'gptbot')!)).not.toBe(lead.common)
    expect(decisionOf(bots.find((b) => b.key === 'googlebot')!)).toBe(lead.common)
  })
})

describe('the sitemap', () => {
  // All listed pages opened: fine.
  it('all open: fine', () => {
    expect(sitemapFace(healthyCrawl()).mark).toBe('ok')
  })
  // No sitemap at the address: red. Couldn't ask: a ring.
  it('none: red; no answer: a ring', () => {
    const c = healthyCrawl()
    expect(sitemapFace({ ...c, sitemap: { ...c.sitemap, status: 404, total: 0, pages: [] } }).mark).toBe('bad')
    expect(sitemapFace({ ...c, sitemap: { ...c.sitemap, status: null } }).mark).toBe('unknown')
  })
  // A listed page that doesn't open: red, counted.
  it('a listed page that doesn’t open: red', () => {
    const c = healthyCrawl()
    const pages = c.sitemap.pages.map((p) => (p.path === '/about' ? { ...p, status: 404 } : p))
    const f = sitemapFace({ ...c, sitemap: { ...c.sitemap, pages } })
    expect(f.mark).toBe('bad')
    expect(f.value).toMatch(/\b1\b/)
  })
})

describe('page address and tags', () => {
  // A canonical is "itself" only for the same origin, path and query.
  it('canonicalState', () => {
    expect(canonicalState(ORIGIN, ORIGIN, '/')).toBe('self')
    expect(canonicalState(`${ORIGIN}/`, ORIGIN, '/')).toBe('self')
    expect(canonicalState(`${ORIGIN}/about`, ORIGIN, '/about')).toBe('self')
    expect(canonicalState(`${ORIGIN}/`, ORIGIN, '/about')).toBe('other')
    expect(canonicalState(`${ORIGIN.replace('://www.', '://')}/about`, ORIGIN, '/about')).toBe('other')
    expect(canonicalState(null, ORIGIN, '/')).toBe('none')
  })
  // Every page itself for every visitor: fine.
  it('each page itself: fine', () => {
    expect(tagsFace(healthyCrawl(), ORIGIN).mark).toBe('ok')
  })
  // Google alone told another address: red (a person's tag being right is not enough).
  it('Google told another address: red', () => {
    const c = healthyCrawl()
    page(c, '/about').canonical.google = `${ORIGIN}/`
    expect(tagsFace(c, ORIGIN).mark).toBe('bad')
  })
  // A "don't list" header: red, whatever the tags say.
  it('noindex by a header: red', () => {
    const c = healthyCrawl()
    page(c, '/faqsheet').noindex.header = true
    expect(tagsFace(c, ORIGIN).mark).toBe('bad')
  })
  // No page opened: nothing to read, a ring.
  it('no page opened: a ring', () => {
    const c = healthyCrawl()
    for (const p of c.pages) p.status = null
    expect(tagsFace(c, ORIGIN).mark).toBe('unknown')
  })
})

describe('crawler visits', () => {
  // Every visit 200: fine. One refused: red. One unanswered (and none refused): a ring.
  it('refused is red, no answer is a ring', () => {
    expect(visitsFace(healthyCrawl()).mark).toBe('ok')
    const refused = healthyCrawl()
    page(refused, '/about').visits.claudebot = 403
    expect(visitsFace(refused).mark).toBe('bad')
    const silent = healthyCrawl()
    page(silent, '/about').visits.claudebot = null
    expect(visitsFace(silent).mark).toBe('unknown')
  })
})

describe('listed on Google and Bing', () => {
  // Google's verdicts: PASS is listed; FAIL ("Error") is red; NEUTRAL ("Excluded") is a ring, since
  // it covers harmless states; asked-but-no-answer is "no answer", never "not listed".
  it('googleWord', () => {
    expect(googleWord({ answered: true, verdict: 'PASS', coverage: 'Submitted and indexed' }).mark).toBe('ok')
    const excluded = googleWord({ answered: true, verdict: 'NEUTRAL', coverage: 'Page with redirect' })
    expect(excluded.mark).toBe('unknown')
    expect(excluded.word).toContain('Page with redirect')
    const error = googleWord({ answered: true, verdict: 'FAIL', coverage: 'Server error (5xx)' })
    expect(error.mark).toBe('bad')
    expect(error.word).toContain('Server error (5xx)')
    for (const e of [{ answered: false, verdict: null, coverage: null }, { answered: true, verdict: null, coverage: null }]) {
      expect(googleWord(e)).toEqual({ word: 'no answer', mark: 'unknown' })
    }
  })
  // "Ask Google" goes to Search Console and nowhere else: the host is fixed, and a page's address
  // (text from the site) is one encoded value that can't add a parameter or leave the host.
  it('requestIndexingHref: a fixed https host, the property and the page encoded', () => {
    const path = '/about?x=1&resource_id=https://evil.test/#top'
    const href = requestIndexingHref(ORIGIN, path)!
    expect(href).toContain('?resource_id=https%3A%2F%2Fwww.example-artist.com%2F&id=https%3A%2F%2Fwww.example-artist.com%2Fabout%3F')
    const u = new URL(href)
    expect(`${u.origin}${u.pathname}`).toBe('https://search.google.com/search-console/inspect')
    expect([...u.searchParams.keys()]).toEqual(['resource_id', 'id'])
    expect(u.searchParams.get('resource_id')).toBe(`${ORIGIN}/`)
    expect(u.searchParams.get('id')).toBe(`${ORIGIN}${path}`)
    expect(u.hash).toBe('')
    expect(requestIndexingHref(null, '/about')).toBeNull()
  })
  // "Ask Google" only where asking can help: not for a page that points elsewhere on purpose.
  it('googleNotListed: a waiting page yes, a redirect or an alternate canonical no', () => {
    const e = (coverage: string) => ({ answered: true, verdict: 'NEUTRAL', coverage })
    expect(googleNotListed(e('Discovered - currently not indexed'))).toBe(true)
    expect(googleNotListed(e('Page with redirect'))).toBe(false)
    expect(googleNotListed(e('Alternate page with proper canonical tag'))).toBe(false)
    expect(googleNotListed(e("Excluded by 'noindex' tag"))).toBe(false)
    expect(googleNotListed(e('Blocked by robots.txt'))).toBe(false)
    expect(googleNotListed(e('Soft 404'))).toBe(false)
  })
  // Every page listed on Google: fine. One not: red. Neither registered: a ring.
  it('listingFace', () => {
    const c = healthyCrawl()
    expect(listingFace(c.listing).mark).toBe('ok')
    const google = c.listing.google!.map((g, i) => (i === 1 ? { ...g, verdict: 'FAIL' } : g))
    expect(listingFace({ ...c.listing, google }).mark).toBe('bad')
    expect(listingFace({ google: null, bing: null }).mark).toBe('unknown')
  })

  // Asked but nothing answered (failed, timed out, no key): said as such, never "0 on Google".
  it('says "couldn’t ask" when nothing answered', () => {
    const c = healthyCrawl()
    const google = c.listing.google!.map((g) => ({ ...g, answered: false, verdict: null, coverage: null, lastCrawl: null }))
    expect(listingFace({ google, bing: null })).toEqual({ mark: 'unknown', value: 'couldn’t ask Google' })
    const bing = c.listing.bing!.map((b) => ({ ...b, answered: false, lastCrawled: null, status: null }))
    expect(listingFace({ google: null, bing })).toEqual({ mark: 'unknown', value: 'couldn’t ask Bing' })
    expect(bingWord(bing[0], '')).toBe('no answer')
  })
  // STRICT: Bing alone never makes the row fine, and its words never say "listed".
  it('Bing is never "listed", and alone is never fine', () => {
    const c = healthyCrawl()
    const face = listingFace({ google: null, bing: c.listing.bing })
    expect(face.mark).toBe('unknown')
    expect(face.value).not.toMatch(/listed/i)
    for (const e of [...c.listing.bing!, { path: '/', answered: true, lastCrawled: null, status: null }, { path: '/', answered: false, lastCrawled: null, status: null }]) {
      expect(bingWord(e, 'Sep 27, 2026')).not.toMatch(/listed/i)
      expect(bingWord(e, '')).not.toMatch(/listed/i)
    }
  })
})

describe('the count', () => {
  // "N of 5 fine" counts checks only: a ring is not fine.
  it('only checks count as fine', () => {
    const all = fineCount(crawlFaces(healthyCrawl(), ORIGIN))
    expect(all).toEqual({ fine: 5, total: 5 })
    const c = { ...healthyCrawl(), listing: { google: null, bing: null } }
    expect(fineCount(crawlFaces(c, ORIGIN))).toEqual({ fine: 4, total: 5 })
  })
})

describe('dayText', () => {
  const zone = process.env.TZ
  afterEach(() => {
    process.env.TZ = zone
  })
  // A sitemap date with no time is that calendar day in every zone (parsed as UTC it would read
  // a day early anywhere west of London).
  it('a date with no time is the same day in every zone', () => {
    for (const tz of ['America/Chicago', 'Pacific/Auckland', 'UTC']) {
      process.env.TZ = tz
      expect(dayText('2026-09-29', 'en-US')).toBe('Sep 29, 2026')
    }
  })
  // Nothing, or not a date: nothing.
  it('nothing for nothing', () => {
    expect(dayText(null)).toBe('')
    expect(dayText('not a date')).toBe('')
  })
  // Every page of the fixture has a date to show.
  it('the fixture’s dates read', () => {
    for (const p of healthyCrawl().sitemap.pages) expect(dayText(p.lastmod, 'en-US')).not.toBe('')
    expect(PAGES.length).toBeGreaterThan(0)
  })
})
