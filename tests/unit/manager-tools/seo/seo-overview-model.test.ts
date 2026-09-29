// The SEO / GEO Overview's arithmetic: which headline, which to-dos, how the timeline joins a
// publish to the test it set off, and "—" (never 0) for what couldn't be read.
/**
 * Sam, 2026-09-28: round 2's "Overview 3 · Timeline". STRICT where the page could say
 * something untrue: a merged "You published. We tested your site." must be a real pair, an
 * unreadable number must never read 0, a to-do must be a real fail, and the headline's state
 * must follow the reads (testing off / couldn't read / no site / never / needs you / clear).
 * Fixtures are built over SEO_TEST_IDS (tests/components/manager-tools/seo/seo-run-fixture.ts).
 */
import { describe, expect, it } from 'vitest'
import { SEO_TEST_IDS } from '@/lib/seo-tests/types'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoOverview, SeoTimelineEvent } from '@/lib/seo-tests/overview'
import {
  PUBLISH_TEST_WINDOW_MS,
  TODO,
  buildOverview,
  countText,
  eventLine,
  eventTitle,
  headlineText,
  mergeTimeline,
  whenParts,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/overview/model'
import type { TestTabData } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { fixtureHistory, fixtureResults, fixtureRun } from '@tests/components/manager-tools/seo/seo-run-fixture'

const T0 = Date.parse('2026-09-28T21:00:00.000Z')
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

describe('the to-do words', () => {
  it('CRITICAL: every test has to-do words and a mark (a Record over the ids; this pins the runtime too)', () => {
    for (const id of SEO_TEST_IDS) {
      expect(TODO[id]?.title, id).toBeTruthy()
      expect(TODO[id]?.mark, id).toBeTruthy()
    }
    expect(Object.keys(TODO).sort()).toEqual([...SEO_TEST_IDS].sort())
  })
})

describe('mergeTimeline', () => {
  it('CRITICAL: a publish and the test it set off are one moment', () => {
    const out = mergeTimeline([publish(0), test(3)])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('test')
    expect(eventTitle(out[0])).toBe('You published. We tested your site.')
  })
  it('CRITICAL: a test run by hand is never joined, even right after a publish', () => {
    const out = mergeTimeline([publish(0), test(2, 'manual')])
    expect(out.map((e) => e.kind)).toEqual(['test', 'publish'])
    expect(eventTitle(out[0])).toBe('You tested your site.')
    expect(eventTitle(out[1])).toBe('You published.')
  })
  it('CRITICAL: outside the window, or BEFORE the publish, they stay apart', () => {
    const late = mergeTimeline([publish(0), test(PUBLISH_TEST_WINDOW_MS / 60_000 + 1)])
    expect(late.map((e) => e.kind)).toEqual(['test', 'publish'])
    expect(eventTitle(late[0])).toBe('We tested your site after you published.')
    const before = mergeTimeline([publish(10), test(5)])
    expect(before.map((e) => e.kind)).toEqual(['publish', 'test'])
  })
  it('each publish joins ONE test, the nearest one before each test', () => {
    const out = mergeTimeline([publish(0), publish(5), test(6), test(8)])
    // test(8) takes publish(5) (nearest), test(6) then takes publish(0).
    expect(out.map((e) => [e.kind, e.at, e.kind === 'test' ? e.publish?.at ?? null : null])).toEqual([
      ['test', at(8), at(5)],
      ['test', at(6), at(0)],
    ])
  })
  it('newest first', () => {
    const out = mergeTimeline([test(-60, 'manual'), publish(0), test(-120, 'manual')])
    expect(out.map((e) => e.at)).toEqual([at(0), at(-60), at(-120)])
  })
})

describe('event lines', () => {
  it('a publish says what went live; a test says its score', () => {
    expect(eventLine({ kind: 'publish', at: at(0), publish: { kind: 'publish', at: at(0), changed: 1 } })).toBe('1 change went live.')
    expect(eventLine({ kind: 'publish', at: at(0), publish: { kind: 'publish', at: at(0), changed: 4 } })).toBe('4 changes went live.')
    const t = mergeTimeline([test(0, 'manual')])[0]
    expect(eventLine(t)).toBe('19 of 24 tests pass.')
  })
  it('never words a "weekly" test: nothing schedules one yet', () => {
    const t = mergeTimeline([test(0, 'scheduled')])[0]
    expect(eventTitle(t)).not.toMatch(/weekly/i)
  })
})

describe('buildOverview', () => {
  it('CRITICAL: testing not switched on → "off", and it still carries the visits and the last publish', () => {
    const v = buildOverview({ tab: { state: 'off' }, overview: overview({ timeline: null, lastPublishedAt: at(0), failing: null, readable: false }), siteConnected: true })
    expect(v.headline).toEqual({ kind: 'off' })
    expect(headlineText(v.headline)).toBe('Testing isn’t switched on yet')
    expect(v.visits).toEqual({ search: 112, ai: 0 })
    expect(v.events).toBeNull()
    expect(v.lastPublishedAt).toBe(at(0))
    expect(v.todo).toEqual([])
  })
  it('CRITICAL: a failed overview read is null everywhere, never 0', () => {
    const v = buildOverview({ tab: ready(), overview: null, siteConnected: true })
    expect(v.visits).toEqual({ search: null, ai: null })
    expect(v.events).toBeNull()
    expect(countText(v.visits.search)).toBe('—')
    expect(countText(0)).toBe('0')
  })
  it('no site connected / couldn’t read / never tested', () => {
    expect(buildOverview({ tab: ready(), overview: overview(), siteConnected: false }).headline.kind).toBe('noSite')
    expect(buildOverview({ tab: { state: 'error' }, overview: overview(), siteConnected: true }).headline.kind).toBe('error')
    const never = buildOverview({ tab: ready(null as never), overview: overview(), siteConnected: true })
    expect(never.headline).toEqual({ kind: 'never', tests: SEO_TEST_DEFS.length })
    // A run from before a site was connected is not a test of the site.
    expect(buildOverview({ tab: ready(fixtureRun({ siteUrl: '' })), overview: overview(), siteConnected: true }).headline.kind).toBe('never')
  })
  it('CRITICAL: the to-dos are exactly the fails, most important first; unknowns are counted, not listed', () => {
    const results = fixtureResults({ card: { status: 'unknown' }, genre: { status: 'na' } })
    const v = buildOverview({ tab: ready(fixtureRun({}, results)), overview: overview(), siteConnected: true })
    const fails = results.filter((r) => r.status === 'fail').map((r) => r.id)
    expect(v.headline).toEqual({ kind: 'needs', fail: fails.length, unknown: 1 })
    expect(v.todo.map((t) => t.id).sort()).toEqual([...fails].sort())
    // Priority (overview.ts SEO_TEST_PRIORITY): the bio before MusicBrainz and Bing Webmaster.
    const ids = v.todo.map((t) => t.id)
    expect(ids.indexOf('bio')).toBeLessThan(ids.indexOf('mb'))
    expect(ids[ids.length - 1]).toBe('bingwm')
    expect(v.todo.find((t) => t.id === 'bio')?.value).toBe('288 of 2,500')
  })
  it('all clear: "All N tests pass", with `na` left out', () => {
    const ok = Object.fromEntries(SEO_TEST_IDS.map((id) => [id, { status: 'pass' as const }]))
    const results = fixtureResults({ ...ok, genre: { status: 'na' } })
    const v = buildOverview({ tab: ready(fixtureRun({}, results)), overview: overview(), siteConnected: true })
    expect(v.headline).toEqual({ kind: 'clear', pass: SEO_TEST_IDS.length - 1, applicable: SEO_TEST_IDS.length - 1, unknown: 0 })
    expect(headlineText(v.headline)).toBe(`All ${SEO_TEST_IDS.length - 1} tests pass`)
    expect(v.todo).toEqual([])
  })
  it('a stale run and a running test are said', () => {
    const v = buildOverview({ tab: ready(fixtureRun({ siteFresh: false })), overview: overview({ running: { ranAt: at(0), trigger: 'publish' } }), siteConnected: true })
    expect(v.stale).toBe(true)
    expect(v.running).toBe(true)
  })
})

describe('whenParts', () => {
  it('today / yesterday / a date, and a time', () => {
    const now = new Date(2026, 8, 28, 22, 0)
    expect(whenParts(new Date(2026, 8, 28, 21, 14).toISOString(), now, 'en-US')).toEqual({ day: 'Today', time: '9:14 PM' })
    expect(whenParts(new Date(2026, 8, 27, 6, 0).toISOString(), now, 'en-US')?.day).toBe('Yesterday')
    expect(whenParts(new Date(2026, 8, 21, 6, 0).toISOString(), now, 'en-US')?.day).toBe('Sep 21')
    expect(whenParts('nope', now)).toBeNull()
  })
})
