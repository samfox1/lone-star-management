// @vitest-environment jsdom
// The SEO / GEO Test tab: the list, the dropdown under a row, every state, evidence as text.
/**
 * Sam, 2026-09-28: round 2's Test list with round 5's dropdown under the row. Tiers (AGENTS.md):
 * STRICT for the counts, the filters and what the header claims (a site that is down is never a
 * score; "N of M" leaves `na` out) and for evidence rendered as TEXT (a hostile site's
 * `<img onerror>` / `</script>` must never become an element); LIGHT for the rest.
 *
 * The runs are the REAL ENGINE's output over made-up sites (seo-run-fixture.ts), so every
 * expectation here is DERIVED from those results, never a sentence copied from them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import { SEO_TEST_IDS, type SeoTestId, type SeoTestResult } from '@/lib/seo-tests/types'
import { TestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { SEO_EDIT_TARGETS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { applySeoFixAction, runSeoTestsAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { HOSTILE_IMG, HOSTILE_SCRIPT, ORIGIN, SCENARIO_NAMES, engineResults, fixtureHistory, fixtureResults, fixtureRun, type Scenario } from './seo-run-fixture'

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
  render(<TestTab artistId="a1" data={data} currentSite={props.currentSite === undefined ? ORIGIN : props.currentSite} initialOpen={props.initialOpen} />)

const rowButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-test-row]'))
const rowIds = () => rowButtons().map((b) => b.id.replace('seo-test-row-', '')).sort()
const row = (id: string) => document.getElementById(`seo-test-row-${id}`) as HTMLButtonElement
const region = (id: string) => document.getElementById(row(id).getAttribute('aria-controls')!)!
const nameOf = (id: string) => SEO_TEST_DEFS.find((d) => d.id === id)!.name
const runButton = () => screen.getByRole('button', { name: /^(test again|test now|testing…)$/i }) as HTMLButtonElement
const heading = () => screen.getByRole('heading', { level: 2 }).textContent
const idsWith = (rs: SeoTestResult[], status: SeoTestResult['status']) => rs.filter((r) => r.status === status).map((r) => r.id).sort()
const firstWith = (rs: SeoTestResult[], pred: (r: SeoTestResult) => boolean) => rs.find(pred)!

describe('the header claims only what the run shows', () => {
  it('CRITICAL: "N of M tests pass" leaves `na` out of both sides; need-you and couldn’t-check sit beside it', () => {
    const rs = engineResults('visualArtist') // the engine's own `na`s
    const pass = idsWith(rs, 'pass').length
    const fail = idsWith(rs, 'fail').length
    const na = idsWith(rs, 'na').length
    const unknown = idsWith(rs, 'unknown').length
    expect(na).toBeGreaterThan(0)
    expect(unknown).toBeGreaterThan(0)
    show(ready(fixtureRun({}, rs)))
    expect(heading()).toBe(`${pass} of ${SEO_TEST_IDS.length - na} tests pass`)
    // The line under it, in order: what needs you (if anything), then what couldn't be checked.
    const detail = [...(fail ? [`${fail} need${fail === 1 ? 's' : ''} you`] : []), `${unknown} couldn’t be checked`].join(' · ')
    expect(screen.getByText(new RegExp(`^${detail}( · |$)`))).toBeTruthy()
    expect(screen.queryByText(/^All /)).toBeNull()
  })
  it('CRITICAL: a site that timed out or answered error 500 is said ONCE; no score, no rows to open, no to-dos', () => {
    for (const s of ['siteDown', 'site500'] as const) {
      show(ready(scenarioRun(s)))
      expect(heading(), s).toBe('We couldn’t reach your site')
      expect(screen.getByText(/^It may be down, so nothing else was checked/)).toBeTruthy()
      expect(document.body.textContent, s).not.toMatch(/tests? pass|need(s)? you/)
      expect(rowButtons(), s).toHaveLength(0)
      expect(screen.queryByRole('group', { name: 'Show' }), s).toBeNull()
      expect(runButton().disabled, s).toBe(false) // testing again is the one thing to do
      cleanup()
    }
  })
  it('a run that recorded an error answer says so from its `reach`, even over results that look fine', () => {
    show(ready(fixtureRun({ reach: { state: 'server-error', status: 500 } }, engineResults('healthy'))))
    expect(heading()).toBe('Your site answered with an error')
    expect(document.body.textContent).not.toMatch(/tests? pass/)
    expect(rowButtons()).toHaveLength(0)
  })
  it('0 of 0 is not a score: every test `na` reads "None of the tests apply to you"', () => {
    show(ready(fixtureRun({}, fixtureResults(Object.fromEntries(SEO_TEST_IDS.map((id) => [id, { status: 'na' }]))))))
    expect(heading()).toBe('None of the tests apply to you')
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
  it('CRITICAL: Needs you / Passing / Couldn’t check each hold exactly their rows, and together every scored row once', () => {
    const rs = engineResults('needsWork')
    show(ready(fixtureRun({}, rs)))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
    const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
    pick('Needs you')
    expect(rowIds()).toEqual(idsWith(rs, 'fail'))
    pick('Passing')
    expect(rowIds()).toEqual(idsWith(rs, 'pass'))
    pick('Couldn’t check')
    expect(rowIds()).toEqual(idsWith(rs, 'unknown'))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(rowButtons()).toHaveLength(SEO_TEST_IDS.length)
    // Each count is spoken with a space: "Needs you 6", never "Needs you6".
    expect(screen.getByRole('button', { name: `Needs you ${idsWith(rs, 'fail').length}` })).toBeTruthy()
  })
  it('an emptied filter says so instead of a blank page; "Couldn’t check" appears only when there is one', () => {
    const rs = fixtureResults({ bingwm: { status: 'pass' } }, 'visualArtist')
    expect(idsWith(rs, 'fail')).toEqual([])
    show(ready(fixtureRun({}, rs)))
    expect(screen.queryByRole('button', { name: /^Couldn’t check/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Needs you/ }))
    expect(rowButtons()).toHaveLength(0)
    expect(screen.getByText('Nothing needs you')).toBeTruthy()
  })
  it('a filter that hides the open row closes it', () => {
    const rs = engineResults('needsWork')
    const passing = idsWith(rs, 'pass')[0]
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(passing))
    fireEvent.click(screen.getByRole('button', { name: /^Needs you/ }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(row(passing).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the dropdown under a row', () => {
  it('opens under its row, one at a time, wired for assistive tech', () => {
    const rs = engineResults('needsWork')
    const [a, b] = rs.filter((r) => r.status === 'fail' && !r.lead).map((r) => r.id)
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(a))
    expect(row(a).getAttribute('aria-expanded')).toBe('true')
    expect(within(region(a)).getByText('Not yet:')).toBeTruthy()
    fireEvent.click(row(b))
    expect(row(a).getAttribute('aria-expanded')).toBe('false')
    expect(row(b).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(row(b))
    expect(row(b).getAttribute('aria-expanded')).toBe('false')
  })
  it('keyboard: rows are real buttons (Enter / Space toggle natively), Esc closes and returns focus, arrows move between rows', () => {
    show(ready())
    expect(row('google').tagName).toBe('BUTTON')
    fireEvent.click(row('google'))
    const inside = within(region('google')).getByRole('button', { name: 'Show the details' })
    inside.focus()
    fireEvent.keyDown(inside, { key: 'Escape' })
    expect(row('google').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(row('google'))
    fireEvent.keyDown(row('google'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(SEO_TEST_IDS[1]))
    fireEvent.keyDown(row(SEO_TEST_IDS[1]), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row('google'))
  })
  it('each status opens with its own lead, and the whole sentence reads (no cut, however long)', () => {
    // The engine's sentences are capped at 500 characters (store.ts capResult). Its longest
    // today are shorter, so one fail carries several of its real sentences joined, ~260+.
    const real = SCENARIO_NAMES.flatMap((n) => engineResults(n)).map((r) => r.sentence)
    const long = [...new Set(real)].sort((a, b) => b.length - a.length).slice(0, 4).join(' ').slice(0, 480)
    const base = [...engineResults('trainingBlocked').filter((r) => r.id !== 'genre'), firstWith(engineResults('visualArtist'), (r) => r.id === 'genre')]
    const failId = firstWith(base, (r) => r.status === 'fail').id
    const rs = base.map((r) => (r.id === failId ? { ...r, sentence: long } : r))
    show(ready(fixtureRun({}, rs)))
    const says = (id: string) => {
      fireEvent.click(row(id))
      return region(id).querySelector('p')!.textContent
    }
    const fail = firstWith(rs, (r) => r.status === 'fail')
    expect(says(fail.id)).toBe(`${fail.lead === 'Almost' ? 'Almost:' : 'Not yet:'} ${fail.sentence}`)
    expect(fail.sentence.length).toBeGreaterThan(250) // read whole: no clamp, no ellipsis
    expect(says('bingwm')).toMatch(/^Couldn’t check: /)
    expect(says('genre')).toMatch(/^Doesn’t apply: /)
    const pass = firstWith(rs, (r) => r.status === 'pass')
    expect(says(pass.id)).toBe(pass.sentence.charAt(0).toUpperCase() + pass.sentence.slice(1))
  })
  it('test names wrap: never cut with "…" (the six bot rows differ only in their last words)', () => {
    show(ready())
    for (const el of Array.from(document.querySelectorAll('[data-test-name]'))) expect(el.className, el.textContent!).not.toMatch(/(^|\s)(truncate|whitespace-nowrap|line-clamp-\d)(\s|$)/)
    expect(screen.getByText(nameOf('others'))).toBeTruthy()
  })
  it('a deep link (?open=) opens that test’s dropdown on arrival', () => {
    show(ready(), { initialOpen: 'bio' })
    expect(row('bio').getAttribute('aria-expanded')).toBe('true')
  })
})

describe('the actions, as icons', () => {
  it('edit: a pencil to the tab that holds the setting, named by the result', () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.action?.kind === 'edit')
    const a = r.action as Extract<NonNullable<SeoTestResult['action']>, { kind: 'edit' }>
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    expect(screen.getByRole('link', { name: a.label }).getAttribute('href')).toBe(`/artists/a1/${SEO_EDIT_TARGETS[a.target]}`)
  })
  it('CRITICAL: outside: a new tab, noopener, https only — a stored javascript: link renders nothing', () => {
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
  it('fix: the wrench makes the change, says "publish to finish", and refreshes so the Publish bar rises', async () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.action?.kind === 'fix')
    const label = r.action!.label
    fixMock.mockResolvedValue({ ok: true, changed: 1 })
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText('Fixed · publish to finish')
    expect(fixMock).toHaveBeenCalledWith('a1', 'apple-storefront')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: label })).toBeNull()
  })
  it('a refused fix says why and leaves the wrench', async () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => x.action?.kind === 'fix')
    fixMock.mockResolvedValue({ ok: false, error: 'No Apple Music link needs this fix.' })
    render(<Toaster />)
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    fireEvent.click(screen.getByRole('button', { name: r.action!.label }))
    await screen.findByText('No Apple Music link needs this fix.')
    expect(screen.getByRole('button', { name: r.action!.label })).toBeTruthy()
  })
  it('the per-test refresh says what it does: it tests EVERYTHING again', async () => {
    runMock.mockResolvedValue({ ok: true, run: fixtureRun() })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(row('google'))
    fireEvent.click(screen.getByRole('button', { name: 'Test everything again' }))
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
  })
  it('other sites’ checkers live behind "Show the details", not in the header', () => {
    show(ready())
    expect(screen.queryByRole('link', { name: /Rich Results/ })).toBeNull()
    fireEvent.click(row('card'))
    fireEvent.click(within(region('card')).getByRole('button', { name: 'Show the details' }))
    const link = screen.getByRole('link', { name: /Rich Results Test/ })
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('href')).toContain(encodeURIComponent(`${ORIGIN}/`))
  })
})

describe('evidence is text', () => {
  it('CRITICAL: html a hostile site sent renders as characters, never as elements', () => {
    const rs = engineResults('hostile')
    // The engine really did carry the site's html into the evidence.
    expect(JSON.stringify(rs)).toContain(HOSTILE_IMG)
    expect(JSON.stringify(rs)).toContain(HOSTILE_SCRIPT)
    show(ready(fixtureRun({}, rs)))
    for (const [id, hostile] of [['title', HOSTILE_IMG], ['desc', HOSTILE_SCRIPT]] as const) {
      fireEvent.click(row(id))
      fireEvent.click(within(region(id)).getByRole('button', { name: 'Show the details' }))
      expect(region(id).textContent, id).toContain(hostile)
      expect(document.querySelector('img[src="x"]'), id).toBeNull()
      expect(document.querySelector('[onerror]'), id).toBeNull()
      expect(document.querySelectorAll('script'), id).toHaveLength(0)
    }
  })
  it('the details say what we did, what we saw and what the test can’t see', () => {
    const rs = engineResults('needsWork')
    const r = firstWith(rs, (x) => !!x.limits && x.evidence.length > 0)
    show(ready(fixtureRun({}, rs)))
    fireEvent.click(row(r.id))
    fireEvent.click(within(region(r.id)).getByRole('button', { name: 'Show the details' }))
    expect(within(region(r.id)).getByText(SEO_TEST_DEFS.find((d) => d.id === r.id)!.tested)).toBeTruthy()
    expect(within(region(r.id)).getAllByText(r.evidence[0].value).length).toBeGreaterThan(0)
    expect(within(region(r.id)).getByText('What this test can’t see')).toBeTruthy()
  })
})

describe('the states', () => {
  it('tests not on yet: a plain "coming soon", nothing to press, rows marked as untested', () => {
    show({ state: 'off' })
    expect(heading()).toBe('Site tests are coming soon')
    expect(screen.getByText('Nothing for you to do.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /test/i })).toBeNull()
    expect(rowButtons()).toHaveLength(0)
    expect(document.querySelectorAll('[data-mark="untested"]')).toHaveLength(SEO_TEST_IDS.length)
  })
  it('couldn’t read: said, with a way to try again', () => {
    show({ state: 'error' })
    expect(heading()).toBe('Couldn’t read the test results')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalled()
  })
  it('never tested: one control, and it runs the first test', async () => {
    runMock.mockResolvedValue({ ok: true, run: fixtureRun() })
    show(ready(null))
    expect(heading()).toBe('Not tested yet')
    fireEvent.click(screen.getByRole('button', { name: 'Test now' }))
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
    await screen.findByText(/tests pass$/)
  })
  it('running: rows keep their last result, dimmed and out of reach; the control is off; a plain progress line', async () => {
    let finish: (v: Awaited<ReturnType<typeof runSeoTestsAction>>) => void = () => {}
    runMock.mockReturnValue(new Promise((r) => (finish = r)))
    const rs = engineResults('needsWork')
    const fail = firstWith(rs, (r) => r.status === 'fail')
    show(ready(fixtureRun({ ranAt: LONG_AGO }, rs)))
    fireEvent.click(runButton())
    expect(heading()).toBe('Testing your site…')
    expect(screen.getByText(/^Checking your site · \d+ s$/)).toBeTruthy()
    expect(runButton().disabled).toBe(true)
    expect(row('google').closest('[inert]')).not.toBeNull()
    expect(within(row(fail.id)).getByText(fail.value)).toBeTruthy()
    await act(async () => finish({ ok: true, run: fixtureRun({ ranAt: LONG_AGO }, rs) }))
    expect(row('google').closest('[inert]')).toBeNull()
  })
  it('CRITICAL: two fast clicks start ONE run', async () => {
    runMock.mockReturnValue(new Promise(() => {}))
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    const b = runButton()
    act(() => {
      b.click()
      b.click()
    })
    expect(runMock).toHaveBeenCalledTimes(1)
  })
  it('cool-down, from the answer’s reason: "You can test again in N s", control off', async () => {
    runMock.mockResolvedValue({ ok: false, reason: 'cooldown', error: 'Any words at all.', retryInS: 42 })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(runButton())
    await screen.findByText(/^You can test again in 4[23] s$/)
    expect(runButton().disabled).toBe(true)
  })
  it('cool-down, known before asking: a run that started under a minute ago', () => {
    show(ready(fixtureRun({ ranAt: new Date(Date.now() - 18_000).toISOString() })))
    expect(screen.getByText(/^You can test again in \d+ s$/)).toBeTruthy()
    expect(runButton().disabled).toBe(true)
  })
  it('a browser clock far behind the server never locks the button for an hour', () => {
    show(ready(fixtureRun({ ranAt: new Date(Date.now() + 60 * 60_000).toISOString() })))
    expect(screen.queryByText(/You can test again/)).toBeNull()
    expect(runButton().disabled).toBe(false)
  })
  it('another run going (a publish’s): said once, control off, and we look again every few seconds', () => {
    vi.useFakeTimers()
    show(ready(fixtureRun({ ranAt: LONG_AGO }), { running: { ranAt: '2026-01-01T00:10:00.000Z', trigger: 'publish' } }))
    expect(screen.getByText('A test is already running. It will show here when it finishes.')).toBeTruthy()
    expect(runButton().disabled).toBe(true)
    act(() => vi.advanceTimersByTime(5000))
    expect(refresh).toHaveBeenCalled()
  })
  it('"already running" is read from the reason, whatever the words', async () => {
    runMock.mockResolvedValue({ ok: false, reason: 'busy', error: 'Reworded entirely.', retryInS: null })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(runButton())
    await screen.findByText('A test is already running. It will show here when it finishes.')
  })
  it('the run failed: its sentence, and Test again stays on', async () => {
    runMock.mockResolvedValue({ ok: false, reason: 'error', error: 'The test couldn’t finish. Try again in a minute.' })
    show(ready(fixtureRun({ ranAt: LONG_AGO })))
    fireEvent.click(runButton())
    await screen.findByText('The test couldn’t finish. Try again in a minute.')
    expect(runButton().disabled).toBe(false)
  })
  it('a failed attempt is still said after a reload; an older failure is not', () => {
    show(ready(fixtureRun({ ranAt: LONG_AGO }), { lastFailed: { ranAt: '2026-01-02T00:00:00.000Z', note: null } }))
    expect(screen.getByText(/^Your last test, .+, couldn’t finish\./)).toBeTruthy()
    cleanup()
    show(ready(fixtureRun({ ranAt: '2026-01-03T00:00:00.000Z' }), { lastFailed: { ranAt: '2026-01-02T00:00:00.000Z', note: null } }))
    expect(screen.queryByText(/couldn’t finish/)).toBeNull()
  })
  it('no site connected: said ONCE at the top, not 24 times; no run offered', () => {
    const rs = engineResults('healthy').map((r) => ({ ...r, status: 'unknown' as const, value: 'no site', sentence: 'no site is connected, so there was nothing to check.' }))
    show(ready(fixtureRun({ siteUrl: '' }, rs)), { currentSite: null })
    expect(heading()).toBe('No site connected')
    expect(screen.queryAllByText('no site')).toHaveLength(0)
    expect(rowButtons()).toHaveLength(0)
    fireEvent.click(runButton())
    expect(runButton().disabled).toBe(true)
    expect(runMock).not.toHaveBeenCalled()
  })
  it('never tested and no site: nothing to run, and it says why', () => {
    show(ready(null), { currentSite: null })
    expect(screen.getByText('No site is connected, so there’s nothing to test yet.')).toBeTruthy()
    fireEvent.click(runButton())
    expect(runMock).not.toHaveBeenCalled()
  })
  it('"may not have updated yet" shows for a fresh publish run, not for a confirmed one, not days later', () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString()
    show(ready(fixtureRun({ trigger: 'publish', siteFresh: null, ranAt: recent })))
    expect(screen.getByText('Your site may not have updated yet. Test again in a minute.')).toBeTruthy()
    cleanup()
    show(ready(fixtureRun({ trigger: 'publish', siteFresh: true, ranAt: recent })))
    expect(screen.queryByText(/may not have updated/)).toBeNull()
    cleanup()
    show(ready(fixtureRun({ trigger: 'publish', siteFresh: null, ranAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })))
    expect(screen.queryByText(/may not have updated/)).toBeNull()
  })
  it('a run over 30 days old says how old', () => {
    show(ready(fixtureRun({ ranAt: new Date(Date.now() - 45 * 86_400_000).toISOString() })))
    expect(screen.getByText('Last tested 6 weeks ago. Test again to see where you stand now.')).toBeTruthy()
  })
  it('a run of an address the site no longer has says the results are for the old one', () => {
    show(ready(fixtureRun({ siteUrl: 'https://old-address.com' })), { currentSite: 'https://www.new-address.com' })
    expect(screen.getByText('These results are for old-address.com, an old address. Test again to check www.new-address.com.')).toBeTruthy()
  })
})
