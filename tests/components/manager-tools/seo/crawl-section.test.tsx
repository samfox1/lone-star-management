// @vitest-environment jsdom
/**
 * "How crawlers see your site" on the AI test tab: the five rows above the four test groups, and
 * the white card each one opens.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/crawl-section.tsx,
 *           wired in test/test-tab.tsx (words and marks from test/crawl-model.ts)
 * Feature:  SEO / GEO page · AI test tab · How crawlers see your site (Sam, 2026-09-30, round 11,
 *           prototypes/seo_variants_20260930_r11.html)
 * Tier:     LIGHT (AGENTS.md "Test depth": a UI still being designed): one test per main path,
 *           no class strings, no copy (marks are read from `data-mark` / `data-state`). STRICT
 *           for one honesty rule: Bing is never said to have "listed" a page (Bing has no such
 *           answer, types.ts SeoCrawl.listing).
 * Covers:   • no crawl (none yet, null, a later shape version): no section at all
 *           • a healthy crawl: five rows above the groups, all fine, and each card's key facts
 *             (the file and every crawler, the sitemap's pages, each canonical, every visit,
 *             Google's and Bing's answers)
 *           • a blocked crawler: the robots.txt row is red, and the crawler's row shows its rule
 *           • not registered with Google or Bing: no answers, and the links to their own tools
 *           • Bing's wording never says "listed"
 * Not here: the rules behind each mark and value (tests/unit/manager-tools/seo/crawl-model.test.ts);
 *           the rest of the tab (test-tab.test.tsx); how it looks (checked by screenshot).
 * Fixtures: healthyCrawl() (crawl-fixture.ts), its crawler list derived from bots.ts; the tab's
 *           run from seo-run-fixture.ts; the two actions and the router are mocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { FETCHING_BOTS, SEO_BOTS } from '@/lib/seo-tests/bots'
import type { SeoCrawl } from '@/lib/seo-tests/types'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { BING_WEBMASTER, CRAWL_ROWS, SEARCH_CONSOLE, listingFace, type CrawlRowId } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/crawl-model'
import { ORIGIN, PAGES, healthyCrawl, withBot } from './crawl-fixture'
import { fixtureHistory, fixtureRun } from './seo-run-fixture'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions', () => ({
  runSeoTestsAction: vi.fn(),
  applySeoFixAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/artists/a1/tools/seo/test' }))

afterEach(cleanup)

/** The done step of the tab around a run carrying `crawl` (absent when undefined). */
function show(crawl: unknown) {
  const latest = fixtureRun(crawl === undefined ? {} : { crawl: crawl as SeoCrawl })
  const data: TestTabData = { state: 'ready', latest, history: fixtureHistory(latest.results), running: null }
  return render(<TestTab artistId="a1" data={data} currentSite={ORIGIN} artistName="Skeen" />)
}

const section = () => document.querySelector<HTMLElement>('[data-crawl-section]')
const crawlRow = (id: CrawlRowId) => document.getElementById(`seo-crawl-row-${id}`) as HTMLButtonElement
/** Open a row and return its card. */
function open(id: CrawlRowId): HTMLElement {
  fireEvent.click(crawlRow(id))
  return document.getElementById(crawlRow(id).getAttribute('aria-controls')!)!
}
const part = (card: HTMLElement, name: string) => card.querySelector<HTMLElement>(`[data-card="${name}"]`)!
const states = (el: Element) => Array.from(el.querySelectorAll('[data-state]')).map((s) => s.getAttribute('data-state'))

describe('no crawl, no section', () => {
  // A run from before crawls, one that couldn't look, or a shape this page doesn't know: nothing
  // is drawn, and the test groups are all there is.
  it.each([
    ['absent', undefined],
    ['null', null],
    ['a later version', { ...healthyCrawl(), v: 2 }],
  ])('%s: no section', (_label, crawl) => {
    show(crawl)
    expect(section()).toBeNull()
    expect(document.querySelectorAll('[data-test-row]').length).toBeGreaterThan(0)
  })
})

describe('a healthy crawl', () => {
  // Five rows, first on the page (above every test group), each marked fine, and the count says so.
  it('shows five fine rows above the test groups', () => {
    show(healthyCrawl())
    const s = section()!
    const firstGroup = document.querySelector('[data-test-row]')!
    expect(s.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const rows = s.querySelectorAll('[data-crawl-row]')
    expect(rows).toHaveLength(CRAWL_ROWS.length)
    expect(Array.from(rows).map((r) => r.getAttribute('data-mark'))).toEqual(CRAWL_ROWS.map(() => 'ok'))
    expect(s.querySelector('[data-crawl-fine]')!.textContent).toContain(`${CRAWL_ROWS.length} of ${CRAWL_ROWS.length}`)
  })

  // robots.txt: the file as sent, and every crawler bots.ts knows, allowed.
  it('robots.txt opens the file and every crawler, allowed', () => {
    const crawl = healthyCrawl()
    show(crawl)
    const card = open('robots')
    expect(part(card, 'file').querySelector('pre')!.textContent).toBe(crawl.robots.text)
    const who = part(card, 'who')
    for (const b of SEO_BOTS) {
      const tr = who.querySelector(`[data-bot="${b.key}"]`)!
      expect(tr.textContent).toContain(b.robotsToken)
      expect(states(tr)).toEqual(['ok'])
    }
    // A Host line is in the file, so there is a note about it.
    expect(part(card, 'note')).not.toBeNull()
  })

  // Sitemap: each page it lists, opened.
  it('the sitemap opens its pages', () => {
    show(healthyCrawl())
    const pages = part(open('sitemap'), 'pages')
    for (const p of PAGES) expect(states(pages.querySelector(`[data-page="${p}"]`)!)).toEqual(['ok'])
  })

  // Page address and tags: every page's canonical is itself, and nothing says "don't list".
  it('the tags card: each canonical is itself, and no noindex', () => {
    show(healthyCrawl())
    const card = open('tags')
    for (const p of PAGES) expect(states(part(card, 'canonical').querySelector(`[data-page="${p}"]`)!)).toEqual(['ok'])
    expect(states(part(card, 'noindex'))).toEqual(['ok'])
  })

  // Crawler visits: a cell per visiting crawler per page, and robots.txt-only names spanning the row.
  it('the visits matrix: every visitor on every page, the robots-only names apart', () => {
    show(healthyCrawl())
    const m = part(open('visits'), 'visits')
    for (const b of FETCHING_BOTS) {
      const tr = m.querySelector(`[data-bot="${b.key}"]`)!
      expect(tr.querySelectorAll('[data-cell]')).toHaveLength(PAGES.length)
      expect(states(tr)).toEqual(PAGES.map(() => 'ok'))
    }
    for (const b of SEO_BOTS.filter((x) => !x.fetches)) expect(m.querySelector(`[data-bot="${b.key}"] [data-robots-only]`)).not.toBeNull()
  })

  // Listed: Google's answer per page, Bing's visit per page, and no "go look yourself" links.
  it('the listing card: Google per page, Bing per page', () => {
    show(healthyCrawl())
    const card = open('listed')
    for (const p of PAGES) expect(states(part(card, 'google').querySelector(`[data-page="${p}"]`)!)).toEqual(['ok'])
    expect(part(card, 'bing').querySelectorAll('[data-page]')).toHaveLength(PAGES.length)
    expect(card.querySelectorAll('a[target="_blank"]')).toHaveLength(0)
  })
})

// A crawler turned away by its own group: the row turns red, and that crawler shows the rule.
it('a blocked crawler: the robots.txt row is red, and its rule is beside it', () => {
  const blocked = { group: 'User-agent: GPTBot', rule: 'Disallow: /' }
  show(withBot(healthyCrawl(), 'gptbot', { verdict: 'blocked', ...blocked }))
  expect(crawlRow('robots').getAttribute('data-mark')).toBe('bad')
  const who = part(open('robots'), 'who')
  const tr = who.querySelector('[data-bot="gptbot"]')!
  expect(states(tr)).toEqual(['bad'])
  expect(tr.textContent).toContain(blocked.group)
  expect(tr.textContent).toContain(blocked.rule)
  // The crawlers the lead line covers don't repeat it.
  expect(who.querySelector('[data-bot="googlebot"]')!.textContent).not.toContain('Allow: /')
  expect(section()!.querySelector('[data-crawl-fine]')!.textContent).toContain(`${CRAWL_ROWS.length - 1} of ${CRAWL_ROWS.length}`)
})

// Not registered with either: no answers to show, the row is a ring, and each side links to the
// provider's own tool (https, a new tab).
it('not registered with Google or Bing: no answers, and links to their own tools', () => {
  const listing = { google: null, bing: null }
  show({ ...healthyCrawl(), listing })
  expect(crawlRow('listed').getAttribute('data-mark')).toBe('unknown')
  expect(crawlRow('listed').querySelector('[data-crawl-value]')!.textContent).toBe(listingFace(listing).value)
  const card = open('listed')
  for (const [name, link] of [['google', SEARCH_CONSOLE], ['bing', BING_WEBMASTER]] as const) {
    expect(part(card, name).querySelector('table')).toBeNull()
    const a = within(part(card, name)).getByRole('link', { name: link.label })
    expect(a.getAttribute('href')).toBe(link.href)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  }
})

describe('Bing is never "listed"', () => {
  // STRICT (honesty): Bing only says when it last visited a page, so nothing about Bing may say
  // it "listed" one: not its card part, and not the row's value when Bing is all there is.
  it.each([
    ['Bing visits, Google too', healthyCrawl().listing],
    ['Bing visits, Google not registered', { ...healthyCrawl().listing, google: null }],
    ['Bing never visited', { google: null, bing: PAGES.map((path) => ({ path, lastCrawled: null, status: null })) }],
    ['not registered with Bing', { ...healthyCrawl().listing, bing: null }],
  ])('%s', (_label, listing) => {
    show({ ...healthyCrawl(), listing })
    if (!listing.google) expect(crawlRow('listed').querySelector('[data-crawl-value]')!.textContent).not.toMatch(/listed/i)
    expect(part(open('listed'), 'bing').textContent).not.toMatch(/listed/i)
  })
})
