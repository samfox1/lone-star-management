/**
 * The SEO / GEO Overview's words and numbers: which headline, which to-dos, how the timeline joins
 * a publish to the test it set off, and "—" (never 0) for what couldn't be read.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model.ts
 *           (buildOverview, TODO, mergeTimeline, eventTitle, eventLine, countText, whenParts)
 * Feature:  SEO / GEO page · Overview tab (Sam, 2026-09-28: round 2's "Overview 3 · Timeline")
 * Tier:     STRICT (AGENTS.md "Test depth"): it decides what the Overview tells the manager is true.
 * Covers:   • one to-do title and mark for every test; the bot to-dos never claim a bot can "read"
 *           • the headline never says every test passed while one couldn't be checked, and says
 *             the SAME score as the Test tab (both use test/model.ts `runHeadline`); `na` left out
 *           • a site that didn't answer (timed out or error 500) is said once, with no to-dos
 *           • things that need you: the fails, most important first; couldn't-checks listed apart
 *           • not switched on, no site, couldn't read, never tested, a moved site, an old run, a
 *             stale run, a newer failed attempt, and when "Test again" is offered
 *           • a failed read is null everywhere and shows "—", never 0
 *           • the timeline joins a publish and the test it set off (only a publish test, only
 *             inside the window, only after the publish), newest first; never a "weekly" test
 * Not here: drawing it (tests/components/manager-tools/seo/overview-tab.test.tsx); reading the
 *           data (tests/unit/seo-tests/runs/overview-data.test.ts); the shared headline rule
 *           (test-tab-model.test.ts).
 * Fixtures: runs from the REAL engine (tests/components/manager-tools/seo/seo-run-fixture.ts
 *           `engineRun`), asserted by status and count, never by a sentence the engine writes;
 *           hand-made timeline events.
 */
import { describe, expect, it } from 'vitest'
import { SEO_TEST_IDS, type SeoTestResult } from '@/lib/seo-tests/types'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoOverview, SeoTimelineEvent } from '@/lib/seo-tests/overview'
import {
  PUBLISH_TEST_WINDOW_MS,
  TODO,
  buildOverview,
  countText,
  eventLine,
  eventTitle,
  headlineSub,
  headlineText,
  mergeTimeline,
  whenParts,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model'
import { headlineLine, runHeadline } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/model'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import type { StoredSeoRun } from '@/lib/seo-tests/store'
import { ORIGIN, engineRun } from '@tests/components/manager-tools/seo/seo-run-fixture'

const T0 = Date.parse('2026-09-28T21:00:00.000Z')
const NOW = Date.parse('2026-09-28T21:30:00.000Z')
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()
const publish = (m: number, changed = 3): SeoTimelineEvent => ({ kind: 'publish', at: at(m), changed })
const test = (m: number, trigger: 'manual' | 'publish' | 'scheduled' = 'publish', over: Partial<Extract<SeoTimelineEvent, { kind: 'test' }>> = {}): SeoTimelineEvent => ({
  kind: 'test',
  at: at(m),
  runId: `run-${m}`,
  trigger,
  passed: 19,
  total: 24,
  siteFresh: true,
  changes: [],
  ...over,
})

const ready = (latest: StoredSeoRun | null, over: Partial<Extract<TestTabData, { state: 'ready' }>> = {}): TestTabData => ({
  state: 'ready',
  latest,
  history: Object.fromEntries(SEO_TEST_IDS.map((id) => [id, []])) as never,
  running: null,
  ...over,
})
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
const build = (tab: TestTabData, over: { overview?: SeoOverview | null; siteUrl?: string | null; nowMs?: number } = {}) =>
  buildOverview({ tab, overview: over.overview === undefined ? overview() : over.overview, siteUrl: over.siteUrl === undefined ? ORIGIN : over.siteUrl, nowMs: over.nowMs ?? NOW })
/** A run with these statuses (the rest pass), over the real engine's healthy run. */
const withStatuses = (statuses: Partial<Record<(typeof SEO_TEST_IDS)[number], SeoTestResult['status']>>) => {
  const run = engineRun('healthy')
  return { ...run, results: run.results.map((r) => (statuses[r.id] ? { ...r, status: statuses[r.id]! } : r)) }
}

describe('the to-do words', () => {
  // One to-do table: every test has a title and a mark, so no failing test shows as a blank row.
  it('CRITICAL: ONE table, every test has a title and a mark', () => {
    for (const id of SEO_TEST_IDS) {
      expect(TODO[id]?.title, id).toBeTruthy()
      expect(TODO[id]?.mark, id).toBeTruthy()
    }
    expect(Object.keys(TODO).sort()).toEqual([...SEO_TEST_IDS].sort())
  })
  // Honest bot to-dos: they ask to let the bot in, never claim it can "read" the site (the tests can't prove that).
  it('the bot to-dos only ask to let the visitor in, never claim it can "read" (the tests can’t prove that)', () => {
    for (const id of ['google', 'bing', 'chatgpt', 'claude', 'perplexity', 'others'] as const) expect(TODO[id].title).not.toMatch(/read/i)
  })
})

describe('the headline, from the real engine', () => {
  // Never "All N pass" while something couldn't be checked; the couldn't-checks are listed apart, not as to-dos.
  it('CRITICAL: a healthy site whose Bing test couldn’t be checked never reads "All N tests pass"', () => {
    const run = engineRun('healthy')
    const unknown = run.results.filter((r) => r.status === 'unknown').length
    expect(unknown).toBeGreaterThan(0) // the engine's Bing test can't fail, only "couldn't check"
    const v = build(ready(run))
    const said = `${headlineText(v.headline)} ${headlineSub(v.headline) ?? ''}`
    expect(said).not.toMatch(/\bAll \d+ tests pass/)
    expect(said).toContain(`${unknown} couldn’t be checked`)
    // The unknowns are listed apart, never as to-dos.
    expect(v.todo.map((t) => t.id)).not.toContain('bingwm')
    expect(v.unknown.map((t) => t.id)).toContain('bingwm')
  })
  // One score: the Overview and the Test tab say the same thing about the same run.
  it('CRITICAL: the Overview says the SAME score as the Test tab for one run', () => {
    for (const run of [engineRun('healthy'), engineRun('visualArtist'), withStatuses({ bio: 'fail', place: 'fail' })]) {
      const v = build(ready(run))
      const tab = headlineLine(runHeadline(run))
      const score = runHeadline(run).title
      expect(`${headlineText(v.headline)} · ${headlineSub(v.headline) ?? ''}`).toContain(score)
      expect(tab).toContain(score)
    }
  })
  // `na` is left out of both sides of "N of M" (a visual artist).
  it('CRITICAL: `na` is left out of both sides (a visual artist)', () => {
    const run = engineRun('visualArtist')
    const na = run.results.filter((r) => r.status === 'na').length
    const pass = run.results.filter((r) => r.status === 'pass').length
    expect(na).toBeGreaterThan(0)
    const v = build(ready(run))
    expect(`${headlineText(v.headline)} ${headlineSub(v.headline) ?? ''}`).toContain(`${pass} of ${SEO_TEST_IDS.length - na} tests pass`)
  })
  // Timed out: one plain sentence, no to-dos, no couldn't-check list.
  it('CRITICAL: a site that timed out is ONE plain thing, with no to-dos and no couldn’t-check list', () => {
    const v = build(ready(engineRun('siteDown')))
    expect(headlineText(v.headline)).toBe('We couldn’t reach your site')
    expect(v.todo).toEqual([])
    expect(v.unknown).toEqual([])
  })
  // Error 500: the same, whatever the rows say, so nothing blames the site's settings for an outage.
  it('CRITICAL: a site that answers error 500 is the same: no to-dos blaming its settings', () => {
    // Whatever the engine says row by row about an error page (it has blamed the site's
    // settings), the Overview says the outage once and lists no to-dos.
    const run = engineRun('site500')
    const v = build(ready(run))
    expect(headlineText(v.headline)).toBe('We couldn’t reach your site')
    expect(v.todo).toEqual([])
  })
  // Things need you: the fails, most important first, with the score and the couldn't-checks beside them.
  it('CRITICAL: things need you: the fails, most important first; the score beside them', () => {
    const run = withStatuses({ bio: 'fail', mb: 'fail', place: 'fail', card: 'unknown' })
    const fails = run.results.filter((r) => r.status === 'fail').map((r) => r.id)
    const v = build(ready(run))
    expect(headlineText(v.headline)).toBe(`${fails.length} things need you`)
    expect(v.todo.map((t) => t.id).sort()).toEqual([...fails].sort())
    // Most important first (overview.ts SEO_TEST_PRIORITY): the bio, then the place, then MusicBrainz.
    const ids = v.todo.map((t) => t.id)
    expect(ids.indexOf('bio')).toBeLessThan(ids.indexOf('place'))
    expect(ids.indexOf('place')).toBeLessThan(ids.indexOf('mb'))
    expect(headlineSub(v.headline)).toBe(`${runHeadline(run).title} · ${run.results.filter((r) => r.status === 'unknown').length} couldn’t be checked`)
    expect(v.unknown.map((t) => t.id)).toContain('card')
  })
  // 0 of 0 is not a score: every test `na` says none apply.
  it('0 of 0 is not a score: every test `na` says none apply, with no lists', () => {
    const run = { ...engineRun('healthy'), results: engineRun('healthy').results.map((r) => ({ ...r, status: 'na' as const })) }
    const v = build(ready(run))
    expect(headlineText(v.headline)).toBe(runHeadline(run).title)
    expect(headlineText(v.headline)).not.toMatch(/0 of 0/)
    expect(v.todo).toEqual([])
  })
})

describe('the other states', () => {
  // Not switched on: calm, and the visits and last publish still show.
  it('CRITICAL: testing not switched on → calm, and it still carries the visits and the last publish', () => {
    const v = build({ state: 'off' }, { overview: overview({ timeline: null, lastPublishedAt: at(0), failing: null, readable: false }) })
    expect(headlineText(v.headline)).toBe('Site tests are coming soon')
    expect(headlineSub(v.headline)).toBe('Nothing for you to do.')
    expect(v.visits).toEqual({ search: 112, ai: 0 })
    expect(v.lastPublishedAt).toBe(at(0))
    expect(v.test.can).toBe(false)
  })
  // A failed read: null everywhere, drawn as "—"; a real 0 still reads 0.
  it('CRITICAL: a failed overview read is null everywhere, never 0', () => {
    const v = build(ready(engineRun('healthy')), { overview: null })
    expect(v.visits).toEqual({ search: null, ai: null })
    expect(v.events).toBeNull()
    expect(countText(v.visits.search)).toBe('—')
    expect(countText(0)).toBe('0')
  })
  // No site, couldn't read, never tested; a run from before the site was connected is not a test of it.
  it('no site / couldn’t read / never tested (a run from before the site was connected is not a test of it)', () => {
    expect(build(ready(engineRun('healthy')), { siteUrl: null }).headline.kind).toBe('noSite')
    expect(build({ state: 'error' }).headline.kind).toBe('error')
    expect(build(ready(null)).headline).toEqual({ kind: 'never', tests: SEO_TEST_DEFS.length })
    expect(build(ready(engineRun('healthy', { siteUrl: '' }))).headline.kind).toBe('never')
  })
  // A moved site: the old site's results are not listed as the manager's to-dos.
  it('CRITICAL: the site’s address changed since the run: the old site’s results are not listed as yours', () => {
    const v = build(ready(withStatuses({ bio: 'fail' })), { siteUrl: 'https://new-site.example.com' })
    expect(v.headline.kind).toBe('moved')
    expect(headlineSub(v.headline)).toContain('new-site.example.com')
    expect(v.todo).toEqual([])
  })
  // Old and stale runs: an old run says how old; a fresh stale run says it may not have updated.
  it('an old run says how old; a fresh stale run says it may not have updated; an old one doesn’t', () => {
    const old = build(ready(engineRun('healthy', { ranAt: new Date(NOW - 45 * 86_400_000).toISOString() })))
    expect(old.oldRun).toMatch(/weeks ago/)
    expect(build(ready(engineRun('healthy', { siteFresh: false, ranAt: at(20) }))).stale).toBe(true)
    expect(build(ready(engineRun('healthy', { siteFresh: false, ranAt: at(-600) }))).stale).toBe(false)
  })
  // A newer failed attempt is said; an older one is not.
  it('a newer failed attempt is said; an older one is not', () => {
    const run = engineRun('healthy', { ranAt: at(0) })
    expect(build(ready(run, { lastFailed: { ranAt: at(10), note: null } })).failedAt).toBe(at(10))
    expect(build(ready(run, { lastFailed: { ranAt: at(-10), note: null } })).failedAt).toBeNull()
  })
  // "Test again" only when a test can run (not while one runs, not with no site).
  it('"Test again" is offered only when a test can run', () => {
    expect(build(ready(engineRun('healthy'))).test.can).toBe(true)
    expect(build(ready(engineRun('healthy'), { running: { ranAt: at(0), trigger: 'publish' } })).test.can).toBe(false)
    expect(build(ready(engineRun('healthy')), { siteUrl: null }).test.can).toBe(false)
  })
})

describe('mergeTimeline', () => {
  // A publish and the test it set off read as one moment.
  it('CRITICAL: a publish and the test it set off are one moment', () => {
    const out = mergeTimeline([publish(0), test(3)])
    expect(out).toHaveLength(1)
    expect(eventTitle(out[0])).toBe('You published. We tested your site.')
  })
  // A test run by hand is never joined to a publish, even right after one.
  it('CRITICAL: a test run by hand is never joined, even right after a publish', () => {
    const out = mergeTimeline([publish(0), test(2, 'manual')])
    expect(out.map((e) => e.kind)).toEqual(['test', 'publish'])
    expect(eventTitle(out[0])).toBe('You tested your site.')
  })
  // Too late, or before the publish: they stay apart.
  it('CRITICAL: outside the window, or BEFORE the publish, they stay apart', () => {
    const late = mergeTimeline([publish(0), test(PUBLISH_TEST_WINDOW_MS / 60_000 + 1)])
    expect(late.map((e) => e.kind)).toEqual(['test', 'publish'])
    expect(mergeTimeline([publish(10), test(5)]).map((e) => e.kind)).toEqual(['publish', 'test'])
  })
  // Each publish joins one test, the nearest one before each test; newest first.
  it('each publish joins ONE test, the nearest one before each test; newest first', () => {
    const out = mergeTimeline([publish(0), publish(5), test(6), test(8)])
    expect(out.map((e) => [e.at, e.kind === 'test' ? (e.publish?.at ?? null) : null])).toEqual([
      [at(8), at(5)],
      [at(6), at(0)],
    ])
  })
  // The lines: what went live, the score, and never a "weekly" test.
  it('lines: what went live, the score; never a "weekly" test', () => {
    expect(eventLine({ kind: 'publish', at: at(0), publish: { kind: 'publish', at: at(0), changed: 1 } })).toBe('1 change went live.')
    expect(eventLine(mergeTimeline([test(0, 'manual')])[0])).toBe('19 of 24 tests pass.')
    expect(eventTitle(mergeTimeline([test(0, 'scheduled')])[0])).not.toMatch(/weekly/i)
  })
})

describe('whenParts', () => {
  // When: today, yesterday or a date, and a time, in the manager's day.
  it('today / yesterday / a date, and a time', () => {
    const now = new Date(2026, 8, 28, 22, 0)
    expect(whenParts(new Date(2026, 8, 28, 21, 14).toISOString(), now, 'en-US')).toEqual({ day: 'Today', time: '9:14 PM' })
    expect(whenParts(new Date(2026, 8, 27, 6, 0).toISOString(), now, 'en-US')?.day).toBe('Yesterday')
    expect(whenParts(new Date(2026, 8, 21, 6, 0).toISOString(), now, 'en-US')?.day).toBe('Sep 21')
    expect(whenParts('nope', now)).toBeNull()
  })
})
