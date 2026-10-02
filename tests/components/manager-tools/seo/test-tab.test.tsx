// @vitest-environment jsdom
/**
 * The SEO / GEO AI test tab: start, running and done, the card under an open row, its actions,
 * evidence shown as plain text, and the quiet states (busy, cool-down, failed, no site...).
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab.tsx,
 *           test/test-row.tsx, test/scan-art.tsx (drawn from src/lib/manager-tools/seo/test-model.ts)
 * Feature:  SEO / GEO page · AI test tab, all 24 SEO tests in their four groups (Sam, 2026-09-29:
 *           round 10, prototypes/seo_variants_20260929_r10.html, "Dropdown A · Card")
 * Tier:     LIGHT (AGENTS.md "Test depth": a UI still being designed) for the steps, the card and
 *           the states: one test per main path, no class strings, no copy. STRICT where it guards
 *           something that can't be allowed to slip: evidence rendered as TEXT (a hostile site's
 *           `<img onerror>` / `</script>` must never become an element), https-only outside
 *           links, and one run per double click.
 * Covers:   • start: never tested shows the start, "Test my site" runs one test, two clicks in one
 *             batch run it once; no site connected offers no run
 *           • running: no list and no ticks while a test runs; the rows come back when it lands,
 *             rising in one after another (not on a page load)
 *           • done: the headline (runHeadline's words) and the four groups; a site that didn't
 *             answer is said once, with no rows
 *           • the card: a failing row opens its sentence, its evidence and its action's link;
 *             a passing row has no "what to do"; keyboard use; a deep link (?open=) opens its row
 *           • the actions: https-only outside links; the fix (and its refusal)
 *           • evidence is text
 *           • the quiet states: tests not on, couldn't read, another run going (and we look
 *             again), cool-down, a failed run, the lines under the header
 * Not here: the counts, headline, evidence rows and refusal rules themselves
 *           (tests/unit/manager-tools/seo/test-tab-model.test.ts); the actions on the server
 *           (tests/unit/manager-tools/seo/test-actions.test.ts); how the drawings move (decoration,
 *           checked by eye).
 * Fixtures: runs from the REAL engine over made-up sites (tests/helpers/seo/run-fixture.ts), so every
 *           expectation is DERIVED from those results, never a sentence copied from them; the two
 *           actions and the router are mocks; notices are found by their `data-notice` key, not
 *           their words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SEO_TEST_GROUPS } from '@/lib/seo-tests/defs'
import { SEO_TEST_IDS, type SeoTestId, type SeoTestResult } from '@/lib/seo-tests/types'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { editHref, leadOf, runHeadline, sentenceOf } from '@/lib/manager-tools/seo/test-model'
import { applySeoFixAction, runSeoTestsAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { HOSTILE_IMG, HOSTILE_SCRIPT, ORIGIN, engineResults, fixtureHistory, fixtureResults, fixtureRun, type Scenario } from '@tests/helpers/seo/run-fixture'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions', () => ({
  runSeoTestsAction: vi.fn(),
  applySeoFixAction: vi.fn(),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => '/artists/a1/tools/seo/test' }))

const runMock = vi.mocked(runSeoTestsAction)
const fixMock = vi.mocked(applySeoFixAction)

beforeEach(() => {
  runMock.mockReset()
  fixMock.mockReset()
  refresh.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const LONG_AGO = '2026-01-01T00:00:00.000Z'
const ready = (latest: ReturnType<typeof fixtureRun> | null = fixtureRun(), over: Partial<Extract<TestTabData, { state: 'ready' }>> = {}): TestTabData => ({
  state: 'ready',
  latest,
  history: fixtureHistory(latest?.results),
  running: null,
  ...over,
})
const scenarioRun = (s: Scenario, over: Parameters<typeof fixtureRun>[0] = {}) => fixtureRun(over, engineResults(s))
const show = (data: TestTabData, props: { currentSite?: string | null; initialOpen?: SeoTestId } = {}) =>
  render(<TestTab artistId="a1" data={data} currentSite={props.currentSite === undefined ? ORIGIN : props.currentSite} artistName="Skeen" initialOpen={props.initialOpen} />)

const rowButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-test-row]'))
const row = (id: string) => document.getElementById(`seo-test-row-${id}`) as HTMLButtonElement
const card = (id: string) => document.getElementById(row(id).getAttribute('aria-controls')!)!
const goButton = () => screen.getByRole('button', { name: /^test my site$/i }) as HTMLButtonElement
const againButton = () => screen.getByRole('button', { name: /^test again$/i }) as HTMLButtonElement
const heading = () => screen.getByRole('heading', { level: 2 }).textContent
const notice = (key: string) => document.querySelector(`[data-notice="${key}"]`)
const firstWith = (rs: SeoTestResult[], pred: (r: SeoTestResult) => boolean) => rs.find(pred)!

describe('start', () => {
  // Never tested: the start shows (no rows), and "Test my site" runs the first test; its result then shows.
  it('never tested: the start, and "Test my site" runs the first test', async () => {
    const run = fixtureRun()
    runMock.mockResolvedValue({ ok: true, run })
    show(ready(null))
    expect(rowButtons()).toHaveLength(0)
    fireEvent.click(goButton())
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
    await vi.waitFor(() => expect(heading()).toBe(runHeadline(run).title))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
  })
  // Two fast clicks (in one act batch) start ONE run (AGENTS.md rule 5: the latch is a ref).
  it('CRITICAL: two fast clicks start ONE run', () => {
    runMock.mockReturnValue(new Promise(() => {}))
    show(ready(null))
    const b = goButton()
    act(() => {
      b.click()
      b.click()
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
  // No site connected: nothing to run, so there is no "Test my site" at all.
  it('never tested and no site: no run is offered', () => {
    show(ready(null), { currentSite: null })
    expect(screen.queryByRole('button', { name: /test my site/i })).toBeNull()
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('running', () => {
  // While a test runs: no heading, no list and no ticks (the drawing never fakes progress); the rows come back when it lands.
  it('shows no list and no ticks while a test runs; the rows come back when it lands', async () => {
    let finish: (v: Awaited<ReturnType<typeof runSeoTestsAction>>) => void = () => {}
    runMock.mockReturnValue(new Promise((r) => (finish = r)))
    const run = fixtureRun({ ranAt: LONG_AGO })
    show(ready(run))
    fireEvent.click(againButton())
    expect(rowButtons()).toHaveLength(0)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(document.querySelector('[data-icon="check"]')).toBeNull()
    await act(async () => finish({ ok: true, run: fixtureRun({ id: 'run-2', ranAt: LONG_AGO }) }))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
  })
  // A run that lands here makes its rows rise in one after another; the run already there on load stays still.
  it('rows rise in after a run in this session, not on a page load', async () => {
    const animate = vi.fn(() => ({ cancel() {}, onfinish: null }) as unknown as Animation)
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
    try {
      const rowAnimations = () => animate.mock.contexts.filter((el) => (el as Element).hasAttribute('data-test-item')).length
      runMock.mockResolvedValue({ ok: true, run: fixtureRun({ id: 'run-2', ranAt: LONG_AGO }) })
      show(ready(fixtureRun({ ranAt: LONG_AGO })))
      expect(rowAnimations()).toBe(0)
      fireEvent.click(againButton())
      await vi.waitFor(() => expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length))
      expect(rowAnimations()).toBe(SEO_TEST_IDS.length)
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate
    }
  })
})

describe('done', () => {
  // A stored run: its headline (runHeadline's own words) and the four groups, every test once.
  it('shows the run’s headline and the four groups', () => {
    const run = fixtureRun()
    show(ready(run))
    expect(heading()).toBe(runHeadline(run).title)
    for (const g of SEO_TEST_GROUPS) expect(screen.getByRole('region', { name: g.label })).toBeTruthy()
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
  })
  // Site didn't answer (the engine's own timed-out run): said ONCE in the header, no rows to open; Test again stays on.
  it('a site that didn’t answer is said once, with no rows; Test again stays on', () => {
    const run = scenarioRun('siteDown')
    show(ready(run))
    expect(heading()).toBe(runHeadline(run).title)
    expect(runHeadline(run).kind).toBe('unreachable')
    expect(rowButtons()).toHaveLength(0)
    expect(againButton().disabled).toBe(false)
  })
  // The outside bios (Profiles tab): one quiet line to them, outside the score; none when all are fine.
  it('outside bios: one line to the Profiles tab with the count, the score untouched; nothing at 0', () => {
    const run = fixtureRun()
    const header = () => document.querySelector('header')!.textContent!.replace(/Outside bios.*$/, '')
    render(<TestTab artistId="a1" data={ready(run)} currentSite={ORIGIN} biosToCheck={3} />)
    const line = document.querySelector<HTMLAnchorElement>('[data-bios-line]')!
    expect(line.getAttribute('href')).toBe('/artists/a1/tools/seo/profiles')
    expect(line.textContent).toContain('3')
    const withLine = header()
    cleanup()
    render(<TestTab artistId="a1" data={ready(run)} currentSite={ORIGIN} biosToCheck={0} />)
    expect(document.querySelector('[data-bios-line]')).toBeNull()
    expect(header()).toBe(withLine)
  })
})

describe('the card under a row', () => {
  // A failing row opens a card with its lead and sentence, its evidence, and its pencil linking to the setting; a pass has no "what to do".
  it('a failing row opens its sentence, its evidence and its action’s link; a pass has no to-do', () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.status === 'fail' && x.action?.kind === 'edit' && x.evidence.length > 0)
    const a = r.action as Extract<NonNullable<SeoTestResult['action']>, { kind: 'edit' }>
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    expect(row(r.id).getAttribute('aria-expanded')).toBe('true')
    const c = card(r.id)
    expect(c.querySelector('[data-card="result"] p')!.textContent).toBe(`${leadOf(r)} ${sentenceOf(r)}`)
    expect(within(c).getAllByText(r.evidence[0].value).length).toBeGreaterThan(0)
    expect(within(c).getByRole('link', { name: a.label }).getAttribute('href')).toBe(editHref('a1', a.target))
    const pass = firstWith(rs, (x) => x.status === 'pass' && !x.todo && !x.good && !x.action)
    fireEvent.click(row(pass.id))
    expect(row(r.id).getAttribute('aria-expanded')).toBe('false') // one open at a time
    expect(card(pass.id).querySelector('[data-card="todo"]')).toBeNull()
    fireEvent.click(row(pass.id))
    expect(row(pass.id).getAttribute('aria-expanded')).toBe('false') // a second click closes it
  })
  // Keyboard: Esc closes the open row and returns focus to it; the arrows move between rows.
  it('keyboard: Esc closes and returns focus, arrows move between rows', () => {
    show(ready())
    fireEvent.click(row('google'))
    fireEvent.keyDown(card('google'), { key: 'Escape' })
    expect(row('google').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(row('google'))
    fireEvent.keyDown(row('google'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(SEO_TEST_IDS[1]))
  })
  // A deep link (?open=) opens that test's row on arrival.
  it('a deep link (?open=) opens that test’s row', () => {
    show(ready(), { initialOpen: 'bio' })
    expect(row('bio').getAttribute('aria-expanded')).toBe('true')
    expect(card('bio')).toBeTruthy()
  })
})

describe('the actions', () => {
  // Outside links: a new tab, noopener, https only; a stored javascript: link renders nothing.
  it('CRITICAL: outside: a new tab, noopener, https only; a stored javascript: link renders nothing', () => {
    const rs = fixtureResults({ bingwm: { action: { kind: 'outside', href: 'javascript:alert(1)', label: 'Evil' } } })
    const mb = firstWith(rs, (r) => r.id === 'mb')
    const a = mb.action as Extract<NonNullable<SeoTestResult['action']>, { kind: 'outside' }>
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row('mb'))
    const link = screen.getByRole('link', { name: a.label })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('href')).toBe(a.href)
    fireEvent.click(row('bingwm'))
    expect(screen.queryByRole('link', { name: 'Evil' })).toBeNull()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })
  // The fix: the wrench calls applySeoFixAction, the card confirms it, and a refresh raises the Publish bar.
  it('fix: the wrench makes the change, confirms it, and refreshes so the Publish bar rises', async () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.action?.kind === 'fix')
    const label = r.action!.label
    fixMock.mockResolvedValue({ ok: true, changed: 1 })
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    fireEvent.click(screen.getByRole('button', { name: label }))
    await vi.waitFor(() => expect(within(card(r.id)).getByRole('status')).toBeTruthy())
    expect(fixMock).toHaveBeenCalledWith('a1', 'apple-storefront')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: label })).toBeNull()
  })
  // A refused fix says why (the server's words, in a toast) and leaves the wrench to try again.
  it('a refused fix says why and leaves the wrench', async () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.action?.kind === 'fix')
    fixMock.mockResolvedValue({ ok: false, error: 'The server said no.' })
    render(<Toaster />)
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    fireEvent.click(screen.getByRole('button', { name: r.action!.label }))
    await screen.findByText('The server said no.')
    expect(screen.getByRole('button', { name: r.action!.label })).toBeTruthy()
  })
})

describe('evidence is text', () => {
  // A hostile site's html shows as characters, never as elements (the engine really carried it).
  it('CRITICAL: html a hostile site sent renders as characters, never as elements', () => {
    const rs = engineResults('hostile')
    expect(JSON.stringify(rs)).toContain(HOSTILE_IMG)
    expect(JSON.stringify(rs)).toContain(HOSTILE_SCRIPT)
    show(ready(fixtureRun({}, rs)))
    for (const [id, hostile] of [['title', HOSTILE_IMG], ['desc', HOSTILE_SCRIPT]] as const) {
      fireEvent.click(row(id))
      expect(card(id).textContent, id).toContain(hostile)
      expect(document.querySelector('img[src="x"]'), id).toBeNull()
      expect(document.querySelector('[onerror]'), id).toBeNull()
      expect(document.querySelectorAll('script'), id).toHaveLength(0)
    }
  })
})

describe('the quiet states', () => {
  // Tests not switched on: nothing to press, no rows. Couldn't read: a way to try again that refreshes.
  it('not on yet: nothing to press; couldn’t read: "Try again" refreshes', () => {
    show({ state: 'off' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(rowButtons()).toHaveLength(0)
    cleanup()
    show({ state: 'error' })
    fireEvent.click(screen.getByRole('button', { name: /^try again$/i }))
    expect(refresh).toHaveBeenCalled()
  })
  // Another run going (a publish's): the running view with its one "already running" line, no rows, and we look again every few seconds.
  it('another run going: the running view, its notice, and a look again every few seconds', () => {
    vi.useFakeTimers()
    show(ready(fixtureRun({ ranAt: LONG_AGO }), { running: { ranAt: '2026-01-01T00:10:00.000Z', trigger: 'publish' } }))
    expect(notice('busy')).not.toBeNull()
    expect(rowButtons()).toHaveLength(0)
    act(() => vi.advanceTimersByTime(5000))
    expect(refresh).toHaveBeenCalled()
  })
  // A cool-down refusal (read from its reason) counts down, with Test again off.
  it('cool-down: the countdown shows and Test again is off', async () => {
    runMock.mockResolvedValue({ ok: false, reason: 'cooldown', error: 'Any words at all.', retryInS: 42 })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(againButton())
    await vi.waitFor(() => expect(notice('cool')).not.toBeNull())
    expect(againButton().disabled).toBe(true)
  })
  // A failed run: the server's sentence shows, and Test again stays on.
  it('the run failed: its sentence shows, and Test again stays on', async () => {
    runMock.mockResolvedValue({ ok: false, reason: 'error', error: 'It broke this time.' })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(againButton())
    await screen.findByText('It broke this time.')
    expect(notice('failed')).not.toBeNull()
    expect(againButton().disabled).toBe(false)
  })
  // The lines under the header: a failed attempt after the latest run (after a reload), a run over 30 days old, a run of an old address.
  it('the lines under the header: a failed attempt, an old run, a moved address', () => {
    show(ready(fixtureRun({ ranAt: LONG_AGO }), { lastFailed: { ranAt: '2026-01-02T00:00:00.000Z', note: null } }))
    expect(notice('lastFailed')).not.toBeNull()
    expect(notice('old')).not.toBeNull()
    cleanup()
    show(ready(fixtureRun({ siteUrl: 'https://old-address.com' })), { currentSite: 'https://www.new-address.com' })
    expect(notice('moved')).not.toBeNull()
  })
})
