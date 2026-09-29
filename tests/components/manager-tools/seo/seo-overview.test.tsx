// @vitest-environment jsdom
// The SEO / GEO Overview: each state, the to-do links into the Test tab, the couldn't-check list,
// the timeline (null parts included), "Test again", and the Test tab opening the row a to-do
// points at.
/**
 * Sam, 2026-09-28: round 2's "Overview 3 · Timeline"; the UI review, 2026-09-29. LIGHT for
 * layout (the main path of each state); STRICT for what could mislead: a to-do lands on its own
 * test with its dropdown open, a site that didn't answer is said once with no to-dos, "All N
 * pass" is never said while something couldn't be checked, an unreadable number shows "—"
 * (never 0), no "weekly test" is drawn. Runs come from the REAL engine (seo-engine-runs.ts);
 * only states and counts are asserted, never the engine's sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SeoOverview } from '@/lib/seo-tests/overview'
import type { StoredSeoRun } from '@/lib/seo-tests/store'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { SEO_TEST_IDS } from '@/lib/seo-tests/types'
import { SeoOverview as Overview, todoHref } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/overview'
import { TODO, buildOverview } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { runSeoTestsAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions'
import { ENGINE_ORIGIN, engineRun } from './seo-engine-runs'

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
const show = (tab: TestTabData, ov: SeoOverview | null = overview(), siteUrl: string | null = ENGINE_ORIGIN) =>
  render(<Overview artistId="a1" view={buildOverview({ tab, overview: ov, siteUrl })} />)
const headline = () => screen.getByRole('heading', { level: 2 }).textContent
const moment = (name: string) => document.querySelector(`[data-moment="${name}"]`) as HTMLElement
const withFails = (ids: readonly (typeof SEO_TEST_IDS)[number][]) => {
  const run = engineRun('healthy', { ranAt: OLD })
  return { ...run, results: run.results.map((r) => (ids.includes(r.id) ? { ...r, status: 'fail' as const, value: `${r.id} value` } : r)) }
}

describe('the states', () => {
  it('CRITICAL: testing not switched on: calm, and still shows the visits and the last publish', () => {
    show({ state: 'off' }, overview({ timeline: null, failing: null, readable: false, lastPublishedAt: OLD }))
    expect(headline()).toBe('Site tests are coming soon')
    expect(screen.getByText('Nothing for you to do.')).toBeTruthy()
    expect(screen.getByText('You published.')).toBeTruthy()
    expect(within(moment('visits')).getByText('112', { exact: false })).toBeTruthy()
    expect(screen.queryByText(/Couldn’t read/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Test/ })).toBeNull()
  })
  it('CRITICAL: a site that didn’t answer is ONE plain thing: no to-dos, no couldn’t-check list', () => {
    show(ready(engineRun('down')))
    expect(headline()).toBe('We couldn’t reach your site')
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Couldn’t check' })).toBeNull()
    cleanup()
    show(ready(engineRun('error500')))
    expect(headline()).toBe('We couldn’t reach your site')
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
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
  it('never tested: says so, and offers "Test now"', () => {
    show(ready(null))
    expect(headline()).toBe('Not tested yet')
    expect(screen.getByRole('button', { name: /Test now/ })).toBeTruthy()
  })
  it('no site connected / couldn’t read', () => {
    show(ready(engineRun('healthy')), overview(), null)
    expect(headline()).toBe('No site connected')
    cleanup()
    show({ state: 'error' })
    expect(headline()).toBe('Couldn’t read the test results')
  })
  it('the site’s address changed: says so, lists nothing from the old site', () => {
    show(ready(withFails(['bio'])), overview(), 'https://new-site.example.com')
    expect(headline()).toBe('Your site’s address changed')
    expect(screen.getByText(/new-site\.example\.com/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
  it('a newer test that didn’t finish is said', () => {
    show({ ...ready(engineRun('healthy', { ranAt: OLD })), lastFailed: { ranAt: '2026-09-28T22:00:00.000Z', note: null } } as TestTabData)
    expect(screen.getByText(/couldn’t finish/)).toBeTruthy()
  })
})

describe('what needs you', () => {
  it('CRITICAL: each to-do links to ITS test on the Test tab, opened (?open=) and scrolled to (#row)', () => {
    show(ready(withFails(['bio', 'mb'])))
    const links = within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')
    const bio = links.find((l) => l.textContent?.includes(TODO.bio.title))!
    expect(bio.getAttribute('href')).toBe('/artists/a1/tools/seo/test?open=bio#seo-test-row-bio')
    expect(todoHref('a1', 'mb')).toBe('/artists/a1/tools/seo/test?open=mb#seo-test-row-mb')
    expect(bio.textContent).toContain('bio value')
    expect(links.find((l) => l.textContent?.includes(TODO.mb.title))!.textContent).toMatch(/Outside Tapir/i)
  })
  it('a long list shows the five most important, then "Show N more"', () => {
    const ids = ['google', 'bing', 'title', 'desc', 'bio', 'place', 'genre'] as const
    show(ready(withFails(ids)))
    const fails = withFails(ids).results.filter((r) => r.status === 'fail').length
    expect(within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: `Show ${fails - 5} more` }))
    expect(within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')).toHaveLength(fails)
  })
  it('CRITICAL: the Test tab opens the row a to-do points at', () => {
    render(<TestTab artistId="a1" data={ready(withFails(['bio']))} currentSite={ENGINE_ORIGIN} initialOpen="bio" />)
    expect(document.getElementById('seo-test-row-bio')!.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('Test again', () => {
  it('runs the Test tab’s own action, then reads the page again', async () => {
    runMock.mockResolvedValue({ ok: true, run: null })
    show(ready(engineRun('healthy', { ranAt: OLD })), overview({ timeline: [{ kind: 'test', at: OLD, runId: 'r', trigger: 'manual', passed: 22, total: 24, siteFresh: true, changes: null }] }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Test again/ }))
    })
    expect(runMock).toHaveBeenCalledWith('a1')
    expect(refresh).toHaveBeenCalled()
  })
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
  it('CRITICAL: unreadable parts read "—" and a plain sentence, never 0', () => {
    show(ready(engineRun('healthy')), overview({ timeline: null, visits: { days: 30, search: null, ai: null } }))
    expect(screen.getByText('Couldn’t read what happened lately.')).toBeTruthy()
    expect(moment('visits').textContent).toContain('—')
    expect(moment('visits').textContent).not.toMatch(/\b0\b/)
  })
  it('a long history shows five moments, then "Show N more"', () => {
    const timeline = Array.from({ length: 8 }, (_, i) => ({ kind: 'publish' as const, at: at(-i * 60), changed: 1 }))
    show(ready(engineRun('healthy')), overview({ timeline }))
    expect(document.querySelectorAll('[data-moment="publish"]')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show 3 more' })).toBeTruthy()
  })
})
