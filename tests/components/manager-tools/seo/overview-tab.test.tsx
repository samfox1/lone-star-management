// @vitest-environment jsdom
/**
 * The SEO / GEO Overview tab shows each state plainly, links each to-do to its test, lists what
 * couldn't be checked, draws the timeline, and runs "Test again".
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/overview.tsx,
 *           overview/test-again.tsx (drawn from overview/model.ts buildOverview)
 * Feature:  SEO / GEO page · Overview tab (Sam, 2026-09-28: round 2's "Overview 3 · Timeline")
 * Tier:     LIGHT for layout (the main path of each state), STRICT (AGENTS.md "Test depth") for
 *           what could mislead: a to-do lands on its own test, a site that didn't answer is said
 *           once with no to-dos, "All N pass" is never said while something couldn't be checked,
 *           an unreadable number shows "—" (never 0), no "weekly test" is drawn.
 * Covers:   • each state: not switched on (still showing visits and the last publish), site
 *             didn't answer, nothing failed but something couldn't be checked, never tested, no
 *             site, couldn't read, the site's address changed, a newer test that didn't finish
 *           • each to-do links to ITS test on the Test tab, opened and scrolled to; a long list
 *             shows five, then "Show N more"
 *           • "Test again" runs the Test tab's own action, then reads the page again; a refusal is said
 *           • the timeline: publishes and runs as they happened, what changed; unreadable parts
 *             say "—" and a plain sentence; a long history shows five, then "Show N more"
 * Not here: the Overview's arithmetic (tests/unit/manager-tools/seo/overview-model.test.ts);
 *           reading its data (tests/unit/seo-tests/runs/overview-data.test.ts); the Test tab
 *           opening the row a to-do points at (test-tab.test.tsx, "a deep link").
 * Fixtures: runs from the REAL engine (seo-run-fixture.ts `engineRun`), asserted by state and
 *           count, never by the engine's sentences; the run action and the router are mocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SeoOverview } from '@/lib/seo-tests/overview'
import type { StoredSeoRun } from '@/lib/seo-tests/store'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { SEO_TEST_IDS } from '@/lib/seo-tests/types'
import { SeoOverview as Overview, todoHref } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/overview'
import { TODO, buildOverview } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { runSeoTestsAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions'
import { ORIGIN, engineRun } from './seo-run-fixture'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions', () => ({
  runSeoTestsAction: vi.fn(),
  applySeoFixAction: vi.fn(),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => '/artists/a1/tools/seo' }))
const runMock = vi.mocked(runSeoTestsAction)

beforeEach(() => {
  runMock.mockReset()
  refresh.mockReset()
})
afterEach(() => cleanup())

const ready = (latest: StoredSeoRun | null): TestTabData => ({ state: 'ready', latest, history: Object.fromEntries(SEO_TEST_IDS.map((id) => [id, []])) as never, running: null })
const overview = (over: Partial<SeoOverview> = {}): SeoOverview => ({
  latest: null,
  running: null,
  failing: [],
  timeline: [],
  lastPublishedAt: null,
  visits: { days: 30, search: 112, ai: 0 },
  readable: true,
  ...over,
})
// An old run: no cool-down in the way of "Test again".
const OLD = '2026-09-28T21:14:00.000Z'
const show = (tab: TestTabData, ov: SeoOverview | null = overview(), siteUrl: string | null = ORIGIN) =>
  render(<Overview artistId="a1" view={buildOverview({ tab, overview: ov, siteUrl })} />)
const headline = () => screen.getByRole('heading', { level: 2 }).textContent
const moment = (name: string) => document.querySelector(`[data-moment="${name}"]`) as HTMLElement
const withFails = (ids: readonly (typeof SEO_TEST_IDS)[number][]) => {
  const run = engineRun('healthy', { ranAt: OLD })
  return { ...run, results: run.results.map((r) => (ids.includes(r.id) ? { ...r, status: 'fail' as const, value: `${r.id} value` } : r)) }
}

describe('the states', () => {
  // Not switched on: calm, nothing to press, and the visits and last publish still show.
  it('CRITICAL: testing not switched on: calm, and still shows the visits and the last publish', () => {
    show({ state: 'off' }, overview({ timeline: null, failing: null, readable: false, lastPublishedAt: OLD }))
    expect(headline()).toBe('Site tests are coming soon')
    expect(screen.getByText('Nothing for you to do.')).toBeTruthy()
    expect(screen.getByText('You published.')).toBeTruthy()
    expect(within(moment('visits')).getByText('112', { exact: false })).toBeTruthy()
    expect(screen.queryByText(/Couldn’t read/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Test/ })).toBeNull()
  })
  // Site didn't answer: said once, with no to-dos and no couldn't-check list blaming the settings.
  it('CRITICAL: a site that didn’t answer is ONE plain thing: no to-dos, no couldn’t-check list', () => {
    show(ready(engineRun('siteDown')))
    expect(headline()).toBe('We couldn’t reach your site')
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Couldn’t check' })).toBeNull()
    cleanup()
    show(ready(engineRun('site500')))
    expect(headline()).toBe('We couldn’t reach your site')
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
  // Nothing failed but something couldn't be checked: never "All N tests pass"; each couldn't-check says why.
  it('CRITICAL: nothing failed but something couldn’t be checked: never "All N tests pass"; the couldn’t-checks are listed apart', () => {
    const run = engineRun('healthy')
    const clean = { ...run, results: run.results.map((r) => (r.status === 'fail' ? { ...r, status: 'pass' as const } : r)) }
    show(ready(clean))
    expect(headline()).not.toMatch(/^All /)
    expect(headline()).toMatch(/of \d+ tests pass/)
    const unknown = within(screen.getByRole('list', { name: 'Couldn’t check' })).getAllByRole('link')
    const unknowns = clean.results.filter((r) => r.status === 'unknown')
    expect(unknown.length).toBe(unknowns.length)
    // Each says WHY, in its result's own words (read from the result, not copied here).
    expect(unknown[0].textContent).toContain(unknowns[0].sentence.slice(1, 30))
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
  // Never tested: says so and offers "Test now".
  it('never tested: says so, and offers "Test now"', () => {
    show(ready(null))
    expect(headline()).toBe('Not tested yet')
    expect(screen.getByRole('button', { name: /Test now/ })).toBeTruthy()
  })
  // No site, or couldn't read: each says so in the headline.
  it('no site connected / couldn’t read', () => {
    show(ready(engineRun('healthy')), overview(), null)
    expect(headline()).toBe('No site connected')
    cleanup()
    show({ state: 'error' })
    expect(headline()).toBe('Couldn’t read the test results')
  })
  // A moved site: the old site's results are not listed as the manager's to-dos.
  it('the site’s address changed: says so, lists nothing from the old site', () => {
    show(ready(withFails(['bio'])), overview(), 'https://new-site.example.com')
    expect(headline()).toBe('Your site’s address changed')
    expect(screen.getByText(/new-site\.example\.com/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
  // A newer test that didn't finish is said, not hidden behind the older run.
  it('a newer test that didn’t finish is said', () => {
    show({ ...ready(engineRun('healthy', { ranAt: OLD })), lastFailed: { ranAt: '2026-09-28T22:00:00.000Z', note: null } } as TestTabData)
    expect(screen.getByText(/couldn’t finish/)).toBeTruthy()
  })
})

describe('what needs you', () => {
  // To-do links: each opens its own test on the Test tab and scrolls to it.
  it('CRITICAL: each to-do links to ITS test on the Test tab, opened (?open=) and scrolled to (#row)', () => {
    show(ready(withFails(['bio', 'mb'])))
    const links = within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')
    const bio = links.find((l) => l.textContent?.includes(TODO.bio.title))!
    expect(bio.getAttribute('href')).toBe('/artists/a1/tools/seo/test?open=bio#seo-test-row-bio')
    expect(todoHref('a1', 'mb')).toBe('/artists/a1/tools/seo/test?open=mb#seo-test-row-mb')
    expect(bio.textContent).toContain('bio value')
    expect(links.find((l) => l.textContent?.includes(TODO.mb.title))!.textContent).toMatch(/Outside Tapir/i)
  })
  // A long to-do list: the five most important, then "Show N more".
  it('a long list shows the five most important, then "Show N more"', () => {
    const ids = ['google', 'bing', 'title', 'desc', 'bio', 'place', 'genre'] as const
    show(ready(withFails(ids)))
    const fails = withFails(ids).results.filter((r) => r.status === 'fail').length
    expect(within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: `Show ${fails - 5} more` }))
    expect(within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')).toHaveLength(fails)
  })
})

describe('Test again', () => {
  // Test again: the same action as the Test tab, then the page is read again.
  it('runs the Test tab’s own action, then reads the page again', async () => {
    runMock.mockResolvedValue({ ok: true, run: null })
    show(ready(engineRun('healthy', { ranAt: OLD })), overview({ timeline: [{ kind: 'test', at: OLD, runId: 'r', trigger: 'manual', passed: 22, total: 24, siteFresh: true, changes: null }] }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Test again/ }))
    })
    expect(runMock).toHaveBeenCalledWith('a1')
    expect(refresh).toHaveBeenCalled()
  })
  // A refusal (another run going) is said in words.
  it('a refusal is said in words (another run going)', async () => {
    runMock.mockResolvedValue({ ok: false, error: 'A test is already running.', reason: 'busy' } as never)
    show(ready(engineRun('healthy', { ranAt: OLD })))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Test again/ }))
    })
    expect(screen.getByRole('status').textContent).toMatch(/already running/)
  })
})

describe('the timeline', () => {
  const at = (m: number) => new Date(Date.parse(OLD) + m * 60_000).toISOString()
  // The timeline: publishes and runs as they happened, what changed, and never a "weekly" test.
  it('publishes and runs as they happened, with what changed between runs; never a weekly test', () => {
    show(
      ready(engineRun('healthy', { ranAt: OLD })),
      overview({
        timeline: [
          { kind: 'test', at: at(2), runId: 'r2', trigger: 'publish', passed: 19, total: 24, siteFresh: true, changes: [{ id: 'title', from: 'fail', to: 'pass' }] },
          { kind: 'publish', at: at(0), changed: 3 },
          { kind: 'test', at: at(-600), runId: 'r1', trigger: 'manual', passed: 18, total: 24, siteFresh: true, changes: null },
        ],
      }),
    )
    expect(screen.getByText('You published. We tested your site.')).toBeTruthy()
    const changed = screen.getByRole('list', { name: 'What changed' })
    expect(within(changed).getByText(SEO_TEST_DEFS.find((d) => d.id === 'title')!.name)).toBeTruthy()
    expect(document.querySelectorAll('[data-moment="test"]')).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/weekly/i)
    // "See the tests · Test again" sit under the newest test, once.
    expect(screen.getAllByRole('button', { name: /Test again/ })).toHaveLength(1)
  })
  // Unreadable parts: "—" and a plain sentence, never a 0 that looks like a real count.
  it('CRITICAL: unreadable parts read "—" and a plain sentence, never 0', () => {
    show(ready(engineRun('healthy')), overview({ timeline: null, visits: { days: 30, search: null, ai: null } }))
    expect(screen.getByText('Couldn’t read what happened lately.')).toBeTruthy()
    expect(moment('visits').textContent).toContain('—')
    expect(moment('visits').textContent).not.toMatch(/\b0\b/)
  })
  // A long history: five moments, then "Show N more".
  it('a long history shows five moments, then "Show N more"', () => {
    const timeline = Array.from({ length: 8 }, (_, i) => ({ kind: 'publish' as const, at: at(-i * 60), changed: 1 }))
    show(ready(engineRun('healthy')), overview({ timeline }))
    expect(document.querySelectorAll('[data-moment="publish"]')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show 3 more' })).toBeTruthy()
  })
})
