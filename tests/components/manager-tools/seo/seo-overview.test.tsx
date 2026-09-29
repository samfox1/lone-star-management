// @vitest-environment jsdom
// The SEO / GEO Overview: each state, the to-do links into the Test tab, the timeline from a
// fixture (null parts included), and the Test tab opening the row a to-do points at.
/**
 * Sam, 2026-09-28: round 2's "Overview 3 · Timeline". LIGHT for layout (the main path of each
 * state); STRICT for what could mislead: a to-do must land on its own test with its dropdown
 * open, an unreadable number must show "—" (never 0), and no "weekly test" is ever drawn.
 * The view is built by the real `buildOverview` from fixtures (no database).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { SeoOverview } from '@/lib/seo-tests/overview'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { SeoOverview as Overview, todoHref } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/overview'
import { TODO, buildOverview } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { fixtureHistory, fixtureResults, fixtureRun, RAN_AT } from './seo-run-fixture'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions', () => ({
  runSeoTestsAction: vi.fn(),
  applySeoFixAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/artists/a1/tools/seo' }))

afterEach(() => cleanup())

const ready = (latest = fixtureRun()): TestTabData => ({ state: 'ready', latest, history: fixtureHistory(latest?.results), running: null })
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
const show = (tab: TestTabData, ov: SeoOverview | null = overview(), siteConnected = true) =>
  render(<Overview artistId="a1" view={buildOverview({ tab, overview: ov, siteConnected })} />)
const headline = () => screen.getByRole('heading', { level: 2 }).textContent
const moment = (name: string) => document.querySelector(`[data-moment="${name}"]`) as HTMLElement

describe('the states', () => {
  it('CRITICAL: testing not switched on: calm, and still shows the visits and the last publish', () => {
    show({ state: 'off' }, overview({ timeline: null, failing: null, readable: false, lastPublishedAt: RAN_AT }))
    expect(headline()).toBe('Testing isn’t switched on yet')
    expect(screen.getByText('You published.')).toBeTruthy()
    expect(within(moment('visits')).getByText('112', { exact: false })).toBeTruthy()
    // No "couldn't read" alarm for a feature that simply isn't on yet.
    expect(screen.queryByText(/Couldn’t read/)).toBeNull()
  })
  it('never tested: says so, with the way to the tests', () => {
    show(ready(null as never))
    expect(headline()).toBe('Not tested yet')
    expect(screen.getByRole('link', { name: /Go to the tests/ }).getAttribute('href')).toBe('/artists/a1/tools/seo/test')
  })
  it('no site connected', () => {
    show(ready(), overview(), false)
    expect(headline()).toBe('No site connected')
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
  it('couldn’t read the results', () => {
    show({ state: 'error' })
    expect(headline()).toBe('Couldn’t read the test results')
  })
  it('nothing needs you: "All N tests pass", calmly, no to-do list', () => {
    const results = fixtureResults(Object.fromEntries(SEO_TEST_DEFS.map((d) => [d.id, { status: 'pass' as const }])))
    show(ready(fixtureRun({}, results)))
    expect(headline()).toBe(`All ${SEO_TEST_DEFS.length} tests pass`)
    expect(screen.queryByRole('list', { name: 'What needs you' })).toBeNull()
  })
})

describe('what needs you', () => {
  it('CRITICAL: each to-do links to ITS test on the Test tab, opened (?open=) and scrolled to (#row)', () => {
    show(ready())
    const fails = fixtureResults().filter((r) => r.status === 'fail')
    expect(headline()).toBe(`${fails.length} things need you`)
    const links = within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('link')
    expect(links).toHaveLength(fails.length)
    const bio = links.find((l) => l.textContent?.includes(TODO.bio.title))!
    expect(bio.getAttribute('href')).toBe('/artists/a1/tools/seo/test?open=bio#seo-test-row-bio')
    expect(todoHref('a1', 'mb')).toBe('/artists/a1/tools/seo/test?open=mb#seo-test-row-mb')
    // The result's own value names the cause; OUTSIDE TAPIR marks a fix made elsewhere.
    expect(bio.textContent).toContain('288 of 2,500')
    expect(links.find((l) => l.textContent?.includes(TODO.mb.title))!.textContent).toMatch(/Outside Tapir/i)
  })
  it('CRITICAL: the Test tab opens the row a to-do points at', () => {
    render(<TestTab artistId="a1" data={ready()} siteConnected siteUrl="https://www.skeenmusic.com" initialOpen="bio" />)
    expect(document.getElementById('seo-test-row-bio')!.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('seo-test-row-mb')!.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the timeline', () => {
  const at = (m: number) => new Date(Date.parse(RAN_AT) + m * 60_000).toISOString()
  it('publishes and runs as they happened, with what changed between runs', () => {
    show(
      ready(),
      overview({
        timeline: [
          { kind: 'test', at: at(2), runId: 'r2', trigger: 'publish', passed: 19, total: 24, siteFresh: true, changes: [{ id: 'title', from: 'fail', to: 'pass' }] },
          { kind: 'publish', at: at(0), changed: 3 },
          { kind: 'test', at: at(-600), runId: 'r1', trigger: 'manual', passed: 18, total: 24, siteFresh: true, changes: null },
        ],
      }),
    )
    expect(screen.getByText('You published. We tested your site.')).toBeTruthy()
    expect(screen.getByText('19 of 24 tests pass.')).toBeTruthy()
    const changed = screen.getByRole('list', { name: 'What changed' })
    expect(within(changed).getByText(SEO_TEST_DEFS.find((d) => d.id === 'title')!.name)).toBeTruthy()
    expect(within(changed).getByText('now passes')).toBeTruthy()
    expect(screen.getByText('You tested your site.')).toBeTruthy()
    // Two moments (the pair, the manual run) plus Now and the visits.
    expect(document.querySelectorAll('[data-moment="test"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-moment="publish"]')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/weekly/i)
  })
  it('CRITICAL: unreadable parts read "—" and a plain sentence, never 0', () => {
    show(ready(), overview({ timeline: null, visits: { days: 30, search: null, ai: null } }))
    expect(screen.getByText('Couldn’t read what happened lately.')).toBeTruthy()
    const visits = moment('visits')
    expect(visits.textContent).toContain('—')
    expect(visits.textContent).not.toMatch(/\b0\b/)
  })
  it('a long history shows five moments, then "Show N more"', () => {
    const timeline = Array.from({ length: 8 }, (_, i) => ({ kind: 'publish' as const, at: at(-i * 60), changed: 1 }))
    show(ready(), overview({ timeline }))
    expect(document.querySelectorAll('[data-moment="publish"]')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show 3 more' })).toBeTruthy()
  })
})
