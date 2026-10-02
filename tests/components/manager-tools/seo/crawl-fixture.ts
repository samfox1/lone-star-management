/**
 * A stored crawl (types.ts SeoCrawl) for the "How crawlers see your site" tests: a healthy site
 * that lets every crawler in, three pages, registered with Google and Bing. Shaped like Skeen's
 * real answers of 2026-09-29 (prototypes/seo_variants_20260930_r11.html), on the test origin.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/crawl-section.tsx,
 *           test/crawl-model.ts
 * Feature:  SEO / GEO page · AI test tab · How crawlers see your site
 * Tier:     LIGHT, like the section it feeds (AGENTS.md "Test depth"); held to the SeoCrawl type
 *           by `tsc`.
 * What it provides:
 *           • healthyCrawl(): every crawler allowed by `User-agent: *` / `Allow: /`, a Host line,
 *             a sitemap of the three pages (all one date), each page's canonical itself for all
 *             three visitors, no noindex, every visit 200, the other spelling 308 → the site, and
 *             Google PASS + Bing visits for each page
 *           • withBot(crawl, key, over): the same crawl with one crawler's robots.txt answer changed
 *           • PAGES, OTHER_HOST
 * Not here: building a crawl from evidence (crawl.ts `buildCrawl`, another part's job, not yet
 *           landed when this was written: this is hand-built to the TYPE, so `tsc` holds it to
 *           the shape).
 * Fixtures: the crawler list is DERIVED from bots.ts SEO_BOTS / FETCHING_BOTS (AGENTS.md rule 4),
 *           never hand-listed, so a new crawler shows up here and in every expectation.
 */
import { FETCHING_BOTS, SEO_BOTS } from '@/lib/seo-tests/bots'
import type { SeoCrawl } from '@/lib/seo-tests/types'
import { ORIGIN } from '@tests/unit/seo-tests/_page-fixture'

export { ORIGIN }

export const PAGES = ['/', '/about', '/faqsheet'] as const

/** The site's other spelling: the bare domain for a www site. */
const OTHER_HOST = ORIGIN.replace('://www.', '://')

const own = (path: string) => `${ORIGIN}${path === '/' ? '' : path}`

export function healthyCrawl(): SeoCrawl {
  return {
    v: 1,
    robots: {
      url: `${ORIGIN}/robots.txt`,
      status: 200,
      text: `User-Agent: *\nAllow: /\n\nHost: ${ORIGIN}\nSitemap: ${ORIGIN}/sitemap.xml`,
      truncated: false,
      bots: SEO_BOTS.map((b) => ({
        key: b.key,
        who: b.who,
        token: b.robotsToken,
        visits: b.fetches,
        verdict: 'allowed' as const,
        why: 'rules' as const,
        group: 'User-agent: *',
        rule: 'Allow: /',
      })),
    },
    sitemap: {
      url: `${ORIGIN}/sitemap.xml`,
      status: 200,
      namedInRobots: true,
      total: PAGES.length,
      pages: PAGES.map((path) => ({ path, lastmod: '2026-09-29', status: 200 })),
      sameDates: true,
    },
    pages: PAGES.map((path) => ({
      path,
      status: 200,
      canonical: { person: own(path), google: own(path), bing: own(path) },
      noindex: { meta: false, header: false },
      visits: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, 200])),
    })),
    otherHost: { url: `${OTHER_HOST}/`, status: 308, to: `${ORIGIN}/` },
    listing: {
      google: PAGES.map((path) => ({ path, answered: true, verdict: 'PASS', coverage: 'Submitted and indexed', lastCrawl: '2026-09-28T15:00:00.000Z' })),
      bing: PAGES.map((path) => ({ path, answered: true, lastCrawled: '2026-09-27T15:00:00.000Z', status: 200 })),
    },
  }
}

type CrawlBot = SeoCrawl['robots']['bots'][number]

/** The crawl with one crawler's robots.txt answer changed. */
export function withBot(crawl: SeoCrawl, key: string, over: Partial<CrawlBot>): SeoCrawl {
  return { ...crawl, robots: { ...crawl.robots, bots: crawl.robots.bots.map((b) => (b.key === key ? { ...b, ...over } : b)) } }
}
