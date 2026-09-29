// @vitest-environment jsdom
// The SEO / GEO Test tab: the list, the dropdown under a row, every state, evidence as text.
/**
 * Sam, 2026-09-28: round 2's Test list with round 5's dropdown under the row. Tiers (AGENTS.md):
 * STRICT for the counts (`na` out of both sides) and for evidence rendered as TEXT (a hostile
 * site's `<img onerror>` / `</script>` must never become an element); LIGHT for the rest — the
 * main path of each state and action, never a class string or a layout detail.
 *
 * Actions are mocked (no database); the run is fixtures/seo-run-fixture.ts, built over
 * SEO_TEST_IDS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { SEO_TEST_IDS } from '@/lib/seo-tests/types'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { applySeoFixAction, runSeoTestsAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { HOSTILE_IMG, HOSTILE_SCRIPT, fixtureHistory, fixtureResults, fixtureRun } from './seo-run-fixture'

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

const ready = (latest = fixtureRun(), over: Partial<Extract<TestTabData, { state: 'ready' }>> = {}): TestTabData => ({
  state: 'ready',
  latest,
  history: fixtureHistory(latest?.results),
  running: null,
  ...over,
})
const show = (data: TestTabData, props: { siteConnected?: boolean } = {}) =>
  render(<TestTab artistId="a1" data={data} siteConnected={props.siteConnected ?? true} siteUrl="https://www.skeenmusic.com" />)

const rowButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-test-row]'))
const row = (id: string) => document.getElementById(`seo-test-row-${id}`) as HTMLButtonElement
const nameOf = (id: string) => SEO_TEST_DEFS.find((d) => d.id === id)!.name
const runButton = () => screen.getByRole('button', { name: /^(test again|test now|testing…)$/i }) as HTMLButtonElement

describe('the header and its counts', () => {
  it('CRITICAL: "N of M tests pass" leaves `na` out of both sides; unknowns are said, not hidden', () => {
    const results = fixtureResults({ genre: { status: 'na' }, card: { status: 'unknown' } })
    const pass = results.filter((r) => r.status === 'pass').length
    const fail = results.filter((r) => r.status === 'fail').length
    show(ready(fixtureRun({}, results)))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(`${pass} of ${SEO_TEST_IDS.length - 1} tests pass`)
    expect(screen.getByText(new RegExp(`^${fail} need you · 1 couldn’t be checked`))).toBeTruthy()
    // The filter counts are the same numbers.
    expect(screen.getByRole('button', { name: `Needs you${fail}` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `Passing${pass}` })).toBeTruthy()
  })
  it('a run after a publish says so', () => {
    show(ready(fixtureRun({ trigger: 'publish' })))
    expect(screen.getByText(/after you published$/)).toBeTruthy()
    cleanup()
    show(ready(fixtureRun({ trigger: 'manual' })))
    expect(screen.queryByText(/after you published/)).toBeNull()
  })
})

describe('the filter', () => {
  it('Needs you shows exactly the fails; Passing exactly the passes; All everything', () => {
    const results = fixtureResults()
    show(ready(fixtureRun({}, results)))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
    fireEvent.click(screen.getByRole('button', { name: /^Needs you/ }))
    expect(rowButtons().map((b) => b.id.replace('seo-test-row-', '')).sort()).toEqual(results.filter((r) => r.status === 'fail').map((r) => r.id).sort())
    fireEvent.click(screen.getByRole('button', { name: /^Passing/ }))
    expect(rowButtons()).toHaveLength(results.filter((r) => r.status === 'pass').length)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
  })
})

describe('the dropdown under a row', () => {
  it('opens under its row, one at a time, wired for assistive tech', () => {
    show(ready())
    fireEvent.click(row('bio'))
    expect(row('bio').getAttribute('aria-expanded')).toBe('true')
    const region = document.getElementById(row('bio').getAttribute('aria-controls')!)!
    expect(region).toBeTruthy()
    expect(within(region).getByText('Not yet:')).toBeTruthy()
    fireEvent.click(row('mb'))
    expect(row('bio').getAttribute('aria-expanded')).toBe('false')
    expect(row('mb').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(row('mb'))
    expect(row('mb').getAttribute('aria-expanded')).toBe('false')
  })
  it('keyboard: rows are real buttons (Enter / Space toggle natively), Esc closes and returns focus, arrows move between rows', () => {
    show(ready())
    expect(row('google').tagName).toBe('BUTTON')
    fireEvent.click(row('google'))
    const region = document.getElementById(row('google').getAttribute('aria-controls')!)!
    const inside = within(region).getByRole('button', { name: 'Show the details' })
    inside.focus()
    fireEvent.keyDown(inside, { key: 'Escape' })
    expect(row('google').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(row('google'))
    fireEvent.keyDown(row('google'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(SEO_TEST_IDS[1]))
    fireEvent.keyDown(row(SEO_TEST_IDS[1]), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row('google'))
  })
  it('each status opens with its own lead', () => {
    const results = fixtureResults({ genre: { status: 'na', sentence: 'no music style fits.' }, card: { status: 'unknown', sentence: 'we ran out of time.' } })
    show(ready(fixtureRun({}, results)))
    const leadIn = (id: string) => {
      fireEvent.click(row(id))
      const region = document.getElementById(row(id).getAttribute('aria-controls')!)!
      return region.querySelector('p')!.textContent
    }
    expect(leadIn('bio')).toMatch(/^Not yet: your bio/)
    expect(leadIn('apple')).toMatch(/^Almost: your Apple Music/)
    expect(leadIn('card')).toBe('Couldn’t check: we ran out of time.')
    expect(leadIn('genre')).toBe('Doesn’t apply: no music style fits.')
    expect(leadIn('google')).toBe('Google can open all 3 of your pages.')
  })
})

describe('the actions, as icons', () => {
  it('edit: a pencil to the tab that holds the setting', () => {
    show(ready())
    fireEvent.click(row('bio'))
    expect(screen.getByRole('link', { name: 'Open the bio editor' }).getAttribute('href')).toBe('/artists/a1/tools/seo/facts#bio')
  })
  it('CRITICAL: outside: a new tab, noopener, https only — a stored javascript: link renders nothing', () => {
    const results = fixtureResults({ bingwm: { action: { kind: 'outside', href: 'javascript:alert(1)', label: 'Evil' } } })
    show(ready(fixtureRun({}, results)))
    fireEvent.click(row('mb'))
    const a = screen.getByRole('link', { name: 'Create it on MusicBrainz' })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('href')).toBe('https://musicbrainz.org/artist/create')
    fireEvent.click(row('bingwm'))
    expect(screen.queryByRole('link', { name: 'Evil' })).toBeNull()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })
  it('fix: the wrench makes the change, says "publish to finish", and refreshes so the Publish bar rises', async () => {
    fixMock.mockResolvedValue({ ok: true, changed: 1 })
    show(ready())
    fireEvent.click(row('apple'))
    fireEvent.click(screen.getByRole('button', { name: 'Fix the Apple Music link' }))
    await screen.findByText('Fixed · publish to finish')
    expect(fixMock).toHaveBeenCalledWith('a1', 'apple-storefront')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Fix the Apple Music link' })).toBeNull()
  })
  it('a refused fix says why and leaves the wrench', async () => {
    fixMock.mockResolvedValue({ ok: false, error: 'No Apple Music link needs this fix.' })
    render(<Toaster />)
    show(ready())
    fireEvent.click(row('apple'))
    fireEvent.click(screen.getByRole('button', { name: 'Fix the Apple Music link' }))
    await screen.findByText('No Apple Music link needs this fix.')
    expect(screen.getByRole('button', { name: 'Fix the Apple Music link' })).toBeTruthy()
  })
  it('the per-test refresh says what it does: it tests EVERYTHING again', async () => {
    runMock.mockResolvedValue({ ok: true, run: fixtureRun() })
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    fireEvent.click(row('google'))
    fireEvent.click(screen.getByRole('button', { name: 'Test everything again' }))
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
  })
})

describe('evidence is text', () => {
  it('CRITICAL: html-looking evidence renders as characters, never as elements', () => {
    show(ready())
    fireEvent.click(row('title'))
    fireEvent.click(screen.getByRole('button', { name: 'Show the details' }))
    const raw = document.getElementById(screen.getByRole('button', { name: 'Show the details' }).getAttribute('aria-controls')!)!
    expect(within(raw).getByText(HOSTILE_IMG)).toBeTruthy()
    expect(within(raw).getByText(HOSTILE_SCRIPT)).toBeTruthy()
    expect(raw.querySelector('img')).toBeNull()
    expect(raw.querySelector('script')).toBeNull()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
  it('the details say what we did, what we saw and what the test can’t see', () => {
    show(ready())
    fireEvent.click(row('google'))
    fireEvent.click(screen.getByRole('button', { name: 'Show the details' }))
    expect(screen.getByText(SEO_TEST_DEFS.find((d) => d.id === 'google')!.tested)).toBeTruthy()
    expect(screen.getByText('Googlebot/2.1')).toBeTruthy()
    expect(screen.getByText('What this test can’t see')).toBeTruthy()
  })
})

describe('the states', () => {
  it('testing isn’t switched on yet: said plainly, nothing to press', () => {
    show({ state: 'off' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Testing isn’t switched on yet')
    expect(screen.queryByRole('button', { name: /test/i })).toBeNull()
    expect(rowButtons()).toHaveLength(0)
    // The tests are still listed, so the page says what is coming.
    expect(screen.getByText(nameOf('google'))).toBeTruthy()
  })
  it('couldn’t read: said, with a way to try again', () => {
    show({ state: 'error' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Couldn’t read the test results')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalled()
  })
  it('never tested: one control, and it runs the first test', async () => {
    runMock.mockResolvedValue({ ok: true, run: fixtureRun() })
    show(ready(null as never))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Not tested yet')
    fireEvent.click(screen.getByRole('button', { name: 'Test now' }))
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
    await screen.findByText(/tests pass$/)
  })
  it('running: rows keep their last result, dimmed and out of reach; the control is off; a quiet progress line', async () => {
    let finish: (v: Awaited<ReturnType<typeof runSeoTestsAction>>) => void = () => {}
    runMock.mockReturnValue(new Promise((r) => (finish = r)))
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    fireEvent.click(runButton())
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Testing your site…')
    expect(screen.getByText(/^Visiting it the way Google and ChatGPT do/)).toBeTruthy()
    expect(runButton().disabled).toBe(true)
    expect(row('google').closest('[inert]')).not.toBeNull()
    expect(within(row('bio')).getByText('288 of 2,500')).toBeTruthy()
    await act(async () => finish({ ok: true, run: fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' }) }))
    expect(row('google').closest('[inert]')).toBeNull()
  })
  it('CRITICAL: two fast clicks start ONE run', async () => {
    runMock.mockReturnValue(new Promise(() => {}))
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    const b = runButton()
    act(() => {
      b.click()
      b.click()
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
  it('cool-down, from the answer: "You can test again in N s", control off', async () => {
    runMock.mockResolvedValue({ ok: false, error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 })
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    fireEvent.click(runButton())
    await screen.findByText(/^You can test again in 4[23] s$/)
    expect(runButton().disabled).toBe(true)
  })
  it('cool-down, known before asking: a run that started under a minute ago', () => {
    show(ready(fixtureRun({ ranAt: new Date(Date.now() - 18_000).toISOString() })))
    expect(screen.getByText(/^You can test again in \d+ s$/)).toBeTruthy()
    expect(runButton().disabled).toBe(true)
  })
  it('another run going (a publish’s): said once, control off, and we look again every few seconds', () => {
    vi.useFakeTimers()
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' }), { running: { ranAt: '2026-01-01T00:10:00.000Z', trigger: 'publish' } }))
    expect(screen.getByText('A test is already running. It will show here when it finishes.')).toBeTruthy()
    expect(runButton().disabled).toBe(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(refresh).toHaveBeenCalled()
  })
  it('"already running" from the answer shows the same state', async () => {
    runMock.mockResolvedValue({ ok: false, error: 'A test is already running. It will show here when it finishes.', retryInS: null })
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    fireEvent.click(runButton())
    await screen.findByText('A test is already running. It will show here when it finishes.')
  })
  it('the run failed: its sentence, and Test again stays on', async () => {
    runMock.mockResolvedValue({ ok: false, error: 'The test couldn’t finish. Try again in a minute.' })
    show(ready(fixtureRun({ ranAt: '2026-01-01T00:00:00.000Z' })))
    fireEvent.click(runButton())
    await screen.findByText('The test couldn’t finish. Try again in a minute.')
    expect(runButton().disabled).toBe(false)
  })
  it('no site connected: said ONCE at the top, not 24 times; no run offered', () => {
    const results = fixtureResults(Object.fromEntries(SEO_TEST_IDS.map((id) => [id, { status: 'unknown', value: 'No site', sentence: 'no site is connected, so there was nothing to check.' }])))
    show(ready(fixtureRun({ siteUrl: '' }, results)), { siteConnected: false })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('No site connected')
    expect(screen.queryAllByText('No site')).toHaveLength(0)
    expect(rowButtons()).toHaveLength(0)
    fireEvent.click(runButton())
    expect(runButton().disabled).toBe(true)
    expect(runMock).not.toHaveBeenCalled()
  })
  it('never tested and no site: nothing to run, and it says why', () => {
    show(ready(null as never), { siteConnected: false })
    expect(screen.getByText('No site is connected, so there’s nothing to test yet.')).toBeTruthy()
    fireEvent.click(runButton())
    expect(runMock).not.toHaveBeenCalled()
  })
  it('a publish run that could not confirm the site caught up says so; a confirmed one does not', () => {
    show(ready(fixtureRun({ trigger: 'publish', siteFresh: null })))
    expect(screen.getByText('Your site may not have updated yet. Test again in a minute.')).toBeTruthy()
    cleanup()
    show(ready(fixtureRun({ trigger: 'publish', siteFresh: true })))
    expect(screen.queryByText(/may not have updated/)).toBeNull()
  })
})
