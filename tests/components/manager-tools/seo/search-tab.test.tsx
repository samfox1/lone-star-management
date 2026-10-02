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
const show = (a: SearchStatsAnswer) => render(<SearchTab answer={a} />)

describe('Both, side by side', () => {
  // Each engine its own column with its OWN four numbers: Google's 15 and Bing's 3, never 18.
  it('shows each engine’s own numbers in two columns, never added together', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    const g = document.querySelector('[data-numbers="google"]') as HTMLElement
    const b = document.querySelector('[data-numbers="bing"]') as HTMLElement
    expect(within(g).getByText('15')).toBeTruthy()
    expect(within(g).getByText('26%')).toBeTruthy()
    expect(within(g).getByText('1 in 4 clicked')).toBeTruthy()
    expect(within(b).getByText('3')).toBeTruthy()
    expect(within(b).getByText('1.5')).toBeTruthy()
    expect(screen.queryByText('18')).toBeNull()
    // Google's Seen says it counts the AI answers; Bing's doesn't.
    expect(g.querySelector('[data-ai-note]')).not.toBeNull()
    expect(b.querySelector('[data-ai-note]')).toBeNull()
    // The searches list: each engine's own row, "skeen music" from both side by side (Google
    // first), with an engine column.
    const rows = [...document.querySelectorAll('[data-row="query"]')].map((r) => `${r.getAttribute('data-engine')}:${r.textContent}`)
    expect(rows).toEqual(['google:Googleskeen dj9352.5', 'google:Googleskeen music242.3', 'bing:Bingskeen music381.5'])
  })
})

describe('Bing with no numbers yet', () => {
  // Skeen on 2026-10-02: Bing registered Sep 30 and answered with nothing. Beside Google's
  // numbers in Both, and on its own in Bing, it says so; it is never a column of zeros.
  it('says “usually within 2 weeks” for a new site, beside Google and on its own', () => {
    const a = answer(ok(GOOGLE), { engine: 'bing', state: 'no_data', period: PERIOD })
    show(a)
    const bing = document.querySelector('[data-engine-column="bing"]') as HTMLElement
    expect(within(bing).getByText('No numbers yet')).toBeTruthy()
    expect(bing.textContent).toContain('New siteadded Sep 30usually within 2 weeks')
    expect(document.querySelector('[data-numbers="bing"]')).toBeNull()
    // The switch marks Bing with the amber dot.
    expect(screen.getByRole('button', { name: /Bing, No numbers yet/ }).querySelector('[data-dot="pending"]')).not.toBeNull()
    cleanup()
    nav.params = new URLSearchParams('e=bing')
    show(a)
    expect(document.querySelector('[data-note-engine="bing"]')?.textContent).toContain('No numbers yet')
    expect(document.querySelector('[data-numbers]')).toBeNull()
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
    expect(document.querySelector('[data-numbers]')).toBeNull()
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
    expect(document.querySelector('[data-numbers="bing"]')).toBeNull()
    expect(document.querySelectorAll('[data-row="query"]')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Google' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '3 months' }))
    expect(nav.push).toHaveBeenCalledWith('/artists/a1/tools/seo/search?e=google&p=3m', { scroll: false })
  })
})
