// The SEO / GEO Overview: failing tests most-important first, a timeline of real records only, and visit counts that are null (never 0) when unreadable.
/**
 * src/lib/seo-tests/overview.ts. Pinned:
 *   • the priority covers every test exactly once (derived from SEO_TEST_IDS, not hand-listed);
 *   • failing = fails before couldn't-checks, each by priority; passes left out;
 *   • a run's changes are against the run BEFORE it; the first run we have says null, not [];
 *   • the timeline is publishes + runs only, inside the window, newest first;
 *   • visits use the Analytics page's buckets (search fold incl. unbucketed search hosts; AI);
 *   • any read that fails is null, never 0, and a half timeline is never returned.
 */
import { describe, expect, it } from 'vitest'
import { SEO_TEST_PRIORITY, buildTimeline, failingInPriority, readSeoOverview, runChanges, searchAndAiVisits } from '@/lib/seo-tests/overview'
import type { SeoRunSummary } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoTestResult } from '@/lib/seo-tests/types'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const A = 'artist-1'
const r = (id: SeoTestResult['id'], status: SeoTestResult['status']): SeoTestResult => ({ id, status, value: '', sentence: '', evidence: [] })
const summary = (id: string, ranAt: string, statuses: SeoRunSummary['statuses']): SeoRunSummary => ({
  id, artistId: A, ranAt, finishedAt: ranAt, trigger: 'manual', siteUrl: 'https://x.example', passed: 0, total: 24, siteFresh: true, publishedAt: null, note: null, statuses,
})

describe('priority and failing', () => {
  it('every test has exactly one rank', () => {
    expect(Object.keys(SEO_TEST_PRIORITY).sort()).toEqual([...SEO_TEST_IDS].sort())
    expect(new Set(Object.values(SEO_TEST_PRIORITY)).size).toBe(SEO_TEST_IDS.length)
  })

  it('CRITICAL: fails first, then couldn\'t-checks, each most-important first; passes left out', () => {
    const out = failingInPriority([r('alt', 'fail'), r('title', 'pass'), r('mb', 'unknown'), r('allowed', 'fail'), r('google', 'unknown'), r('bio', 'fail')])
    expect(out.map((x) => x.id)).toEqual(['allowed', 'bio', 'alt', 'google', 'mb'])
  })

  it('CRITICAL: a test that does not apply (`na`) is not failing: left out like a pass', () => {
    const out = failingInPriority([r('genre', 'na'), r('mb', 'na'), r('title', 'fail'), r('apple', 'unknown')])
    expect(out.map((x) => x.id)).toEqual(['title', 'apple'])
  })
})

describe('timeline', () => {
  it('a run\'s changes are against the run before it, most important first', () => {
    const prev = summary('r1', '2026-09-27T10:00:00Z', { title: 'fail', bio: 'fail', google: 'pass' })
    const next = summary('r2', '2026-09-28T10:00:00Z', { title: 'pass', bio: 'fail', google: 'fail', card: 'pass' })
    expect(runChanges(prev, next)).toEqual([
      { id: 'google', from: 'pass', to: 'fail' },
      { id: 'title', from: 'fail', to: 'pass' },
    ])
  })

  it('CRITICAL: only publishes and runs, inside the window, newest first; the first run we have says null', () => {
    const since = Date.parse('2026-09-01T00:00:00Z')
    const runs = [
      summary('r3', '2026-09-28T10:00:00Z', { title: 'pass' }),
      summary('r2', '2026-09-20T10:00:00Z', { title: 'fail' }),
      summary('r1', '2026-08-20T10:00:00Z', { title: 'fail' }), // before the window: read only for r2's diff
    ]
    const moments = [
      { publishedAt: '2026-09-28T09:59:00Z', entities: 3 },
      { publishedAt: '2026-08-01T00:00:00Z', entities: 1 },
    ]
    const events = buildTimeline(runs, moments, since)
    expect(events.map((e) => `${e.kind}@${e.at}`)).toEqual(['test@2026-09-28T10:00:00Z', 'publish@2026-09-28T09:59:00Z', 'test@2026-09-20T10:00:00Z'])
    const r3 = events[0]
    expect(r3.kind === 'test' && r3.changes).toEqual([{ id: 'title', from: 'fail', to: 'pass' }])
    const r2 = events[2]
    expect(r2.kind === 'test' && r2.changes).toEqual([]) // compared to r1: nothing changed
    // A test's history may mix statuses: `na` → fail is a change like any other.
    expect(runChanges(summary('a', '2026-09-27T10:00:00Z', { genre: 'na' }), summary('b', '2026-09-28T10:00:00Z', { genre: 'fail' }))).toEqual([{ id: 'genre', from: 'na', to: 'fail' }])
    const lone = buildTimeline([summary('r9', '2026-09-28T10:00:00Z', { title: 'pass' })], [], since)
    expect(lone[0].kind === 'test' && lone[0].changes).toBeNull()
  })
})

describe('a run where the site did not answer (`reach`)', () => {
  const since = Date.parse('2026-09-01T00:00:00Z')
  const down = { state: 'no-answer' as const, status: null }

  it('CRITICAL: gives no to-dos that depend on reading the site; only a test that never reads it (MusicBrainz) stays', () => {
    const results = [r('title', 'unknown'), r('google', 'fail'), r('mb', 'fail'), r('bio', 'unknown')]
    expect(failingInPriority(results, { state: 'server-error', status: 503 }).map((x) => x.id)).toEqual(['mb'])
    expect(failingInPriority(results, down).map((x) => x.id)).toEqual(['mb'])
    // Answered, or an older run with no reach at all: every failing test, as before.
    expect(failingInPriority(results, { state: 'answered', status: 200 }).map((x) => x.id)).toEqual(['google', 'mb', 'title', 'bio'])
    expect(failingInPriority(results, null).map((x) => x.id)).toEqual(['google', 'mb', 'title', 'bio'])
  })

  it('CRITICAL: the timeline carries its reach and lists NO changes for it ("We couldn\'t reach your site", not 20 tests "now unknown")', () => {
    const runs = [
      { ...summary('r3', '2026-09-28T10:00:00Z', { title: 'pass' }), reach: { state: 'answered' as const, status: 200 } },
      { ...summary('r2', '2026-09-20T10:00:00Z', { title: 'unknown', google: 'unknown' }), reach: down },
      { ...summary('r1', '2026-09-10T10:00:00Z', { title: 'fail', google: 'pass' }), reach: { state: 'answered' as const, status: 200 } },
    ]
    const events = buildTimeline(runs, [], since)
    const byId = Object.fromEntries(events.map((e) => [e.kind === 'test' ? e.runId : e.at, e]))
    const r2 = byId.r2
    expect(r2.kind === 'test' && r2.reach).toEqual(down)
    expect(r2.kind === 'test' && r2.changes).toEqual([])
    // The next reached run is compared with the last run that DID reach the site.
    const r3 = byId.r3
    expect(r3.kind === 'test' && r3.changes).toEqual([{ id: 'title', from: 'fail', to: 'pass' }])
  })
})

describe('visits from search and AI', () => {
  it('uses the Analytics page\'s buckets: Google/Bing + unbucketed search hosts; the ai bucket', () => {
    expect(
      searchAndAiVisits([
        { source: 'google', referrer_host: 'google.com', visitors: 5 },
        { source: 'bing', referrer_host: 'bing.com', visitors: 2 },
        { source: 'other', referrer_host: 'duckduckgo.com', visitors: 1 },
        { source: 'other', referrer_host: 'someblog.example', visitors: 9 },
        { source: 'ai', referrer_host: 'chatgpt.com', visitors: 3 },
        { source: 'instagram', referrer_host: 'instagram.com', visitors: 40 },
      ]),
    ).toEqual({ search: 8, ai: 3 })
  })
})

type World = { runsError?: boolean; momentsError?: boolean; sourcesError?: boolean; latest?: Record<string, unknown> | null }

function world({ runsError = false, momentsError = false, sourcesError = false, latest = null }: World = {}) {
  return fakeClient((c: Call): Reply => {
    if (c.table === 'seo_test_runs') {
      if (runsError) return { error: { message: 'boom' } }
      if (c.terminal === 'maybeSingle' && c.cols?.includes('results')) return { data: latest }
      if (c.terminal === 'maybeSingle') return { data: null } // currentRun: nothing running
      return { data: [] }
    }
    if (c.op === 'rpc' && c.table === 'publish_moments') return momentsError ? { error: { message: 'boom' } } : { data: [{ published_at: '2026-09-28T09:59:00Z', entities: 2 }] }
    if (c.op === 'rpc' && c.table === 'analytics_sources') return sourcesError ? { error: { message: 'boom' } } : { data: [] }
    return { data: null }
  })
}

describe('readSeoOverview: a number that cannot be read is null, never 0', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')

  it('CRITICAL: analytics unreadable → both visit counts null; readable and empty → 0', async () => {
    const bad = await readSeoOverview(world({ sourcesError: true }).client, A, { now })
    expect(bad.visits).toEqual({ days: 30, search: null, ai: null })
    const empty = await readSeoOverview(world().client, A, { now })
    expect(empty.visits).toEqual({ days: 30, search: 0, ai: 0 })
  })

  it('CRITICAL: publish history unreadable → no timeline at all (a half one would hide publishes)', async () => {
    const o = await readSeoOverview(world({ momentsError: true }).client, A, { now })
    expect(o.timeline).toBeNull()
    expect(o.lastPublishedAt).toBeNull()
  })

  it('runs unreadable → not "never tested": readable false, failing null', async () => {
    const o = await readSeoOverview(world({ runsError: true }).client, A, { now })
    expect(o.readable).toBe(false)
    expect(o.failing).toBeNull()
    expect(o.timeline).toBeNull()
  })

  it('the analytics window is the last 30 UTC days, today included', async () => {
    const f = world()
    await readSeoOverview(f.client, A, { now })
    expect(f.calls.find((c) => c.table === 'analytics_sources')?.args).toEqual({ p_artist_id: A, p_since: '2026-08-30', p_until: '2026-09-28' })
  })

  it('the latest run\'s failing tests, in priority order', async () => {
    const latest = {
      id: 'r1', artist_id: A, ran_at: '2026-09-28T10:00:00Z', trigger: 'publish', site_url: 'https://x.example', passed: 22, total: 24, summary: {}, site_fresh: true, published_at: null, note: null,
      results: [r('mb', 'unknown'), r('title', 'fail'), r('google', 'pass')],
    }
    const o = await readSeoOverview(world({ latest }).client, A, { now })
    expect(o.failing?.map((x) => x.id)).toEqual(['title', 'mb'])
    expect(o.latest?.trigger).toBe('publish')
    expect(o.lastPublishedAt).toBe('2026-09-28T09:59:00Z')
  })
})
