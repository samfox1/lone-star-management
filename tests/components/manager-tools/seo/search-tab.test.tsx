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
/** The page passes every period's answer; the 3-month one here is the same numbers marked 3m,
 *  with Google's seen doubled so a switch of the lower chart's period shows. */
const threeMonths = (a: SearchStatsAnswer): SearchStatsAnswer => {
  const P3M: SearchPeriod = { key: '3m', days: 90, start: '2026-07-05', end: '2026-10-02' }
  const g = a.google.state === 'ok'
    ? { ...a.google, stats: { ...a.google.stats, period: P3M, series: a.google.stats.series.map((d) => ({ ...d, impressions: d.impressions * 2 })) } }
    : { ...a.google, period: P3M }
  return { ...a, period: P3M, google: g as EngineStats, bing: { ...a.bing, ...(a.bing.state === 'ok' ? {} : { period: P3M }) } as EngineStats }
}
const show = (a: SearchStatsAnswer) => render(<SearchTab answer={a} answers={{ '28d': a, '3m': threeMonths(a) }} name="Skeen" ai={AI} />)
const header = () => screen.getByRole('group', { name: 'Engine' })
const lower = () => screen.getByRole('group', { name: 'Engines on this chart' })
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

  // Behind the ranking chart's info button: the searches it is built from, and a plain line when
  // "Skeen" on its own is not one of them (Sam, 2026-10-06: "some way to be more transparent").
  it('CRITICAL: lists the searches the ranking line uses, and says when the bare name is not among them', () => {
    nav.params = new URLSearchParams('e=google')
    show(answer(ok(GOOGLE), ok(BING)))
    expect(document.querySelector('[data-name-searches]')).toBeNull() // behind the info button, not a table on the page
    fireEvent.click(screen.getByRole('button', { name: 'Searches behind this ranking' }))
    const list = screen.getByRole('dialog', { name: 'Searches behind this ranking' })
    expect([...list.querySelectorAll('[data-row="name-search"]')].map((r) => r.textContent)).toEqual(['skeen dj39 seen#2.5', 'skeen music2 seen#3'])
    expect(list.querySelector('[data-note-line="bare-name"]')?.textContent).toBe('“Skeen” on its own: not showing up on Google yet')
  })

  // Behind the seen / clicked chart's info button: the searches its totals are made of, and what
  // each engine keeps private, so the parts add up to the numbers beside it.
  it('CRITICAL: lists the searches the seen / clicked totals are made of, and what Google keeps private', () => {
    nav.params = new URLSearchParams('e=google')
    show(answer(ok(GOOGLE), { engine: 'bing', state: 'no_data', period: PERIOD }))
    expect(document.querySelector('[data-reach-searches]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Searches behind these numbers' }))
    const list = screen.getByRole('dialog', { name: 'Searches behind these numbers' })
    expect([...list.querySelectorAll('[data-row="reach-search"]')].map((r) => r.textContent)).toEqual(['skeen dj35 seen9 clicks', 'skeen music4 seen2 clicks'])
    expect(list.querySelector('[data-note-line="private-google"]')?.textContent).toBe('Searches Google keeps private: 18 seen · 4 clicks')
    expect(list.querySelector('[data-note-line="private-bing"]')).toBeNull()
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
    // Beside Google's numbers: no note row (Sam, 2026-10-06), only the amber dot on Bing's button.
    // The ranking reads as Google alone; the seen / clicked chart keeps Bing on, at zero.
    expect(document.querySelector('[data-note-engine="bing"]')).toBeNull()
    expect(within(header()).getByRole('button', { name: 'Bing' }).querySelector('[data-dot="pending"]')).not.toBeNull()
    expect(drawn()).toEqual(['google-spot', 'google-seen', 'bing-seen', 'google-clicks', 'bing-clicks'])
    expect(facts('Seen and clicked')).toEqual([
      expect.stringMatching(/^Google seen56/), expect.stringMatching(/^Bing seen0/),
      expect.stringMatching(/^Google clicks15/), expect.stringMatching(/^Bing clicks0/),
    ])
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
  // The title's engine shows at once (no server trip) and goes in the address; its period is new
  // numbers, so it navigates, keeping the engine. The lower chart keeps its own engines.
  it('Google shows Google alone and goes in the address; 3 months navigates with p=3m', () => {
    const push = vi.spyOn(window.history, 'pushState')
    show(answer(ok(GOOGLE), ok(BING)))
    expect(document.querySelector('[data-search-view]')?.getAttribute('data-search-view')).toBe('both')
    act(() => {
      fireEvent.click(within(header()).getByRole('button', { name: 'Google' }))
    })
    expect(document.querySelector('[data-search-view]')?.getAttribute('data-search-view')).toBe('google')
    expect(push).toHaveBeenCalledWith(null, '', '/artists/a1/tools/seo/search?e=google')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How Skeen shows up on Google')
    expect(drawn()).toEqual(['google-spot', 'google-seen', 'bing-seen', 'google-clicks', 'bing-clicks'])
    expect(within(header()).getByRole('button', { name: 'Google' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: '3m' }))
    expect(nav.push).toHaveBeenCalledWith('/artists/a1/tools/seo/search?e=google&p=3m', { scroll: false })
  })

  // The lower chart's own toggles: both start on; an engine off takes its lines and numbers away;
  // the last one on stays on (Sam, 2026-10-06).
  it('CRITICAL: the seen / clicked chart\'s own Google and Bing toggles — both on to start, the last one stays on', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    expect(within(lower()).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true'])
    fireEvent.click(within(lower()).getByRole('button', { name: 'Bing' }))
    expect(drawn()).toEqual(['google-spot', 'bing-spot', 'google-seen', 'google-clicks'])
    expect(facts('Seen and clicked')).toEqual([expect.stringMatching(/^Seen56/), expect.stringMatching(/^Clicks15/)])
    fireEvent.click(within(lower()).getByRole('button', { name: 'Google' }))
    expect(within(lower()).getByRole('button', { name: 'Google' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'Seen and clicked on Google' })).toBeTruthy()
  })

  // The lower chart's own period switches its numbers at once, without leaving the page.
  it('the seen / clicked chart\'s own period shows that period\'s numbers, with no trip to the server', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    fireEvent.click(within(screen.getByRole('group', { name: 'Period of this chart' })).getByRole('button', { name: '3m' }))
    expect(facts('Seen and clicked')[0]).toMatch(/^Google seen112/) // the 3-month answer's numbers
    expect(nav.push).not.toHaveBeenCalled()
  })

  // Turning Clicks off removes the clicks lines and their numbers.
  it('Clicks off takes the clicks lines and their numbers away', () => {
    show(answer(ok(GOOGLE), ok(BING)))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clicks' }))
    expect(drawn()).toEqual(['google-spot', 'bing-spot', 'google-seen', 'bing-seen'])
    expect(facts('Seen and clicked')).toHaveLength(2)
  })
})
