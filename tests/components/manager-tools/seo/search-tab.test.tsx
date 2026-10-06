// @vitest-environment jsdom
/**
 * The SEO / GEO Search tab ("How fans find you"): each engine's numbers side by side, an engine
 * with no numbers says why instead of showing zeros, and the switches change the view.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/search-tab.tsx
 * Feature:  SEO / GEO page · Search tab (Sam, 2026-10-02, prototypes/search_tab_20261002.html;
 *           "Both" side by side, Bing "usually within 2 weeks")
 * Tier:     LIGHT (AGENTS.md "Test depth"): the page is new and its look still moving; one test
 *           per state. The words it shows are pinned STRICTLY in
 *           tests/unit/manager-tools/seo/search-model.test.ts.
 * Covers:   • Both, both engines answered: two columns, each engine's OWN numbers (never a sum),
 *             the searches list with each engine's own rows
 *           • Bing with no numbers for a new site (Skeen, 2026-10-02): "No numbers yet · New site
 *             · added Sep 30 · usually within 2 weeks", beside Google's numbers and on its own
 *           • couldn't ask: says which engine; Try again (an error) re-renders the page, a refusal
 *             offers none
 *           • the switches: an engine shows at once and goes in the address (pushState); a period
 *             navigates to the address with `p`
 * Not here: the words and the side-by-side alignment (search-model.test.ts); the numbers' shape
 *           (search-stats.test.ts); the chart's drawing (checked by screenshot).
 * Fixtures: next/navigation mocked (router, address); answers shaped like Skeen's REAL normalised
 *           snapshot (2026-10-02) in search-stats.ts's own types, Bing's numbers made up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SearchTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/search-tab'
import type { SearchStatsAnswer } from '@/lib/manager-tools/seo/search-stats-ask'
import type { EngineStats, SearchPeriod, SearchStats } from '@/lib/manager-tools/seo/search-stats'

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => '/artists/a1/tools/seo/search',
  useSearchParams: () => nav.params,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  nav.params = new URLSearchParams()
})

const PERIOD: SearchPeriod = { key: '28d', days: 28, start: '2026-09-05', end: '2026-10-02' }

/** Google for skeenmusic.com, 2026-10-02 (the real snapshot, trimmed). */
const GOOGLE: SearchStats = {
  engine: 'google',
  period: PERIOD,
  totals: { clicks: 15, impressions: 57, ctr: 0.2631578947368421, position: 2.456140350877193 },
  series: [
    { date: '2026-09-29', clicks: 6, impressions: 23, final: true },
    { date: '2026-09-30', clicks: 5, impressions: 14, final: false },
    { date: '2026-10-01', clicks: 4, impressions: 19, final: false },
  ],
  // Skeen's real searches by day (2026-10-06 fixture), trimmed to the period's days.
  searchDays: [
    { key: 'skeen dj', date: '2026-09-29', impressions: 13, position: 2.15 },
    { key: 'skeen music', date: '2026-09-29', impressions: 2, position: 3 },
    { key: 'skeen dj', date: '2026-09-30', impressions: 11, position: 2.36 },
    { key: 'skeen dj', date: '2026-10-01', impressions: 15, position: 2.93 },
  ],
  queries: [
    { key: 'skeen dj', clicks: 9, impressions: 35, ctr: 0.257, position: 2.54 },
    { key: 'skeen music', clicks: 2, impressions: 4, ctr: 0.5, position: 2.25 },
  ],
  pages: [{ key: 'https://www.skeenmusic.com/', clicks: 15, impressions: 57, ctr: 0.263, position: 2.46 }],
  countries: [{ key: 'USA', clicks: 11, impressions: 37, ctr: 0.297, position: 2.84 }],
  devices: [{ key: 'desktop', clicks: 13, impressions: 39, ctr: 0.333, position: 2.49 }],
  unlisted: { clicks: 4, impressions: 18 },
  coverage: { from: '2026-09-29', to: '2026-10-01' },
  preliminaryFrom: '2026-09-30',
}

/** Bing once it has numbers (made up: Bing had none for Skeen on 2026-10-02). */
const BING: SearchStats = {
  ...GOOGLE,
  engine: 'bing',
  totals: { clicks: 3, impressions: 8, ctr: 0.375, position: 1.5 },
  series: [{ date: '2026-09-30', clicks: 3, impressions: 8, final: true }],
  searchDays: [{ key: 'skeen music', date: '2026-09-28', impressions: 8, position: 1.5 }],
  queries: [{ key: 'skeen music', clicks: 3, impressions: 8, ctr: 0.375, position: 1.5 }],
  pages: [],
  countries: null,
  devices: null,
  unlisted: { clicks: 0, impressions: 0 },
  coverage: { from: '2026-09-30', to: '2026-09-30' },
  preliminaryFrom: null,
}

const ok = (stats: SearchStats): EngineStats => ({ engine: stats.engine, state: 'ok', stats })
const answer = (google: EngineStats, bing: EngineStats): SearchStatsAnswer => ({
  period: PERIOD,
  askedAt: '2026-10-02T20:00:51.997Z',
  added: { google: '2026-09-29T17:00:00.000Z', bing: '2026-09-30T18:20:00.000Z' },
  google,
  bing,
})
const AI = [{ name: 'ChatGPT', visitors: 2 }, { name: 'Gemini', visitors: 0 }, { name: 'Perplexity', visitors: 0 }]
const show = (a: SearchStatsAnswer) => render(<SearchTab answer={a} name="Skeen" ai={AI} />)
const drawn = () => [...document.querySelectorAll('[data-series]')].map((g) => g.getAttribute('data-series'))
const facts = (region: string) => [...screen.getByRole('region', { name: `${region}, in numbers` }).querySelectorAll('[data-fact]')].map((f) => f.textContent)

describe('Both, side by side', () => {
  // Each engine its OWN lines and numbers: Google's and Bing's, never one summed line.
  it('CRITICAL: each engine its own spot line, seen and clicks lines and numbers — never added together', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How Skeen shows up in search')
    expect(drawn()).toEqual(['google-spot', 'bing-spot', 'google-seen', 'bing-seen', 'google-clicks', 'bing-clicks'])
    expect(facts('Seen and clicked')).toEqual([
      expect.stringMatching(/^Google seen56/), expect.stringMatching(/^Bing seen8/),
      expect.stringMatching(/^Google clicks15/), expect.stringMatching(/^Bing clicks3/),
    ])
    expect(screen.queryByText('18')).toBeNull()
    // The searches list: each engine's own row, "skeen music" from both side by side (Google
    // first), with an engine column; Seen and the spot.
    const rows = [...document.querySelectorAll('[data-row="query"]')].map((r) => `${r.getAttribute('data-engine')}:${r.textContent}`)
    expect(rows).toEqual(['google:Googleskeen dj35#2.5', 'google:Googleskeen music4#2.3', 'bing:Bingskeen music8#1.5'])
  })

  // Each engine's spot numbers sit beside the chart, and the day the site was added is pinned.
  it('the spot is "now" and the average beside each engine, #1 at the top; the day each site was added is pinned', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    expect(facts('Your spot')).toEqual([expect.stringMatching(/^Google#2\.5Average #2\.5/), expect.stringMatching(/^Bing#1\.5Average #1\.5/)])
    expect(screen.getByRole('button', { name: 'Site added to Google' })).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
  })

  // The AI list shows each assistant with its visits.
  it('fans sent by AI: each assistant and its visits', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    expect([...document.querySelectorAll('[data-row="ai"]')].map((r) => r.textContent)).toEqual(['ChatGPT2', 'Gemini0', 'Perplexity0'])
  })
})

describe('Bing with no numbers yet', () => {
  // Skeen on 2026-10-02: Bing registered Sep 30 and answered with nothing. On its own it says
  // so; beside Google it is a dot on its button; it is never a line of zeros.
  it('says “usually within 2 weeks” for a new site on its own; beside Google, only a dot', () => {
    const a = answer(ok(GOOGLE), { engine: 'bing', state: 'no_data', period: PERIOD })
    show(a)
    // Beside Google's numbers: no note row (Sam, 2026-10-06), only the amber dot on Bing's button,
    // and the page reads as Google alone: Google's lines only.
    expect(document.querySelector('[data-note-engine="bing"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Bing' }).querySelector('[data-dot="pending"]')).not.toBeNull()
    expect(drawn()).toEqual(['google-spot', 'google-seen', 'google-clicks'])
    cleanup()
    // On its own, Bing says so in full.
    nav.params = new URLSearchParams('e=bing')
    show(a)
    const bing = document.querySelector('[data-note-engine="bing"]') as HTMLElement
    expect(within(bing).getByText('No numbers yet')).toBeTruthy()
    expect(bing.textContent).toContain('New siteadded Sep 30usually within 2 weeks')
    expect(drawn()).toEqual([])
  })
})

describe('couldn’t ask', () => {
  // Google broke and Bing refused: each says it couldn't ask; only the error offers Try again,
  // which re-renders the page (the loader asks again after an error).
  it('names the engine; Try again (after an error) re-renders the page', () => {
    show(answer({ engine: 'google', state: 'error', period: PERIOD }, { engine: 'bing', state: 'quota', period: PERIOD }))
    expect(screen.getByText("Couldn't ask Google")).toBeTruthy()
    expect(screen.getByText("Couldn't ask Bing")).toBeTruthy()
    expect(screen.getByText("Bing's daily limit")).toBeTruthy()
    expect(drawn()).toEqual([])
    const again = screen.getAllByRole('button', { name: 'Try again' })
    expect(again).toHaveLength(1)
    fireEvent.click(again[0])
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('the switches', () => {
  // An engine shows at once (no server trip) and goes in the address; a period is new numbers,
  // so it navigates, keeping the engine.
  it('Google shows Google alone and goes in the address; 3 months navigates with p=3m', () => {
    const push = vi.spyOn(window.history, 'pushState')
    show(answer(ok(GOOGLE), ok(BING)))
    expect(document.querySelector('[data-search-view]')?.getAttribute('data-search-view')).toBe('both')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    })
    expect(document.querySelector('[data-search-view]')?.getAttribute('data-search-view')).toBe('google')
    expect(push).toHaveBeenCalledWith(null, '', '/artists/a1/tools/seo/search?e=google')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How Skeen shows up on Google')
    expect(drawn()).toEqual(['google-spot', 'google-seen', 'google-clicks'])
    expect(screen.getByRole('button', { name: 'Google' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '3m' }))
    expect(nav.push).toHaveBeenCalledWith('/artists/a1/tools/seo/search?e=google&p=3m', { scroll: false })
  })

  // Turning Clicks off removes the clicks lines and their numbers.
  it('Clicks off takes the clicks lines and their numbers away', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clicks' }))
    expect(drawn()).toEqual(['google-spot', 'bing-spot', 'google-seen', 'bing-seen'])
    expect(facts('Seen and clicked')).toHaveLength(2)
  })
})
