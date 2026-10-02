/**
 * THE SEO / GEO OVERVIEW: what the Overview tab shows, and ALL of it real.
 *
 *   failing    the latest stored run's fails and couldn't-checks, most important first
 *   timeline   publishes (the publish history, `publish_moments`) and test runs (stored runs,
 *              each with what changed since the run before it). Nothing else: there is NO
 *              weekly schedule yet (the dashboard is not hosted), so there are no "weekly test"
 *              events to show and none are invented (LAUNCH_CHECKLIST.md, "SEO/GEO tests").
 *   visits     the last 30 days' visitors from web search and from AI assistants, from our own
 *              analytics (`analytics_sources`, the Analytics page's reader and buckets).
 *
 * THE RULE: a number that could not be read is `null`, never 0. `null` reads "couldn't read";
 * 0 would read "nobody came", which is a claim.
 *
 * UNUSED FOR NOW: the Overview tab that read this was removed on 2026-09-29; it is kept for the
 * stashed "AI visibility" page (TODO.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEARCH_SOURCES, isSearchHost } from '@/lib/analytics-sources'
import { analyticsWindow } from '@/lib/analytics'
import { SITE_FREE_TESTS } from './defs'
import { currentRun, latestRun, recentRuns, type SeoRunSummary, type StoredSeoRun } from './store'
import type { SeoRunReach, SeoRunTrigger, SeoTestId, SeoTestResult, SeoTestStatus } from './types'

/**
 * Most important first. A `Record` over the union, so a new test id is a compile error until it
 * is placed here. The order: nothing else matters if search engines are told to skip the site or
 * cannot open it; then whether AI can read it; then who you are; then how it looks when shared;
 * then the facts; the outside-Tapir chores last.
 */
export const SEO_TEST_PRIORITY: Record<SeoTestId, number> = {
  allowed: 0, google: 1, bing: 2, words: 3, chatgpt: 4, claude: 5, perplexity: 6, others: 7, list: 8,
  title: 9, desc: 10, bio: 11, place: 12, genre: 13, card: 14,
  share: 15, preview: 16,
  profiles: 17, apple: 18, shows: 19, releases: 20, alt: 21,
  mb: 22, bingwm: 23,
}

/** The site answered, or the run does not say (an older run, no site): its results stand. */
const siteAnswered = (reach: SeoRunReach | null | undefined): boolean => !reach || reach.state === 'answered'

/** Fails first, then couldn't-checks, each in priority order. Passes and tests that do not
 *  apply (`na`) are left out: neither is something to fix. When the site did NOT answer
 *  (`reach`), only the tests that never read it are listed: "we couldn't reach your site" is said
 *  once by the page, not turned into twenty to-dos. */
export function failingInPriority(results: readonly SeoTestResult[], reach: SeoRunReach | null = null): SeoTestResult[] {
  const rank = (r: SeoTestResult) => (r.status === 'fail' ? 0 : 1) * 100 + (SEO_TEST_PRIORITY[r.id] ?? 99)
  const answered = siteAnswered(reach)
  return results
    .filter((r) => r.status === 'fail' || r.status === 'unknown')
    .filter((r) => answered || SITE_FREE_TESTS.has(r.id))
    .sort((a, b) => rank(a) - rank(b))
}

export type SeoTestChange = { id: SeoTestId; from: SeoTestStatus; to: SeoTestStatus }

/** What changed from one run to the next, in priority order. A test absent from either run
 *  (it did not exist yet) is not a change; `na` to anything else (or back) is. */
export function runChanges(prev: SeoRunSummary, next: SeoRunSummary): SeoTestChange[] {
  const out: SeoTestChange[] = []
  for (const [id, to] of Object.entries(next.statuses) as [SeoTestId, SeoTestStatus][]) {
    const from = prev.statuses[id]
    if (from && from !== to) out.push({ id, from, to })
  }
  return out.sort((a, b) => SEO_TEST_PRIORITY[a.id] - SEO_TEST_PRIORITY[b.id])
}

export type SeoTimelineEvent =
  | { kind: 'publish'; at: string; changed: number }
  | {
      kind: 'test'
      at: string
      runId: string
      trigger: SeoRunTrigger
      passed: number
      total: number
      siteFresh: boolean | null
      /** Did the site answer? Anything but `answered` (or null): the page says "We couldn't reach
       *  your site" for this run, and `changes` is [] (nothing it could read changed). Always set
       *  by buildTimeline; optional only so events built elsewhere stay valid. */
      reach?: SeoRunReach | null
      /** Since the last earlier run that reached the site. null = the first run we have, so
       *  nothing to compare. */
      changes: SeoTestChange[] | null
    }

export type PublishMomentRow = { publishedAt: string; entities: number }

/**
 * Publishes and runs, newest first, inside the window. `runs` arrive newest first and may hold
 * ONE run older than the window, read only so the oldest run in it has something to compare to.
 */
export function buildTimeline(runs: readonly SeoRunSummary[], moments: readonly PublishMomentRow[], sinceMs: number, max = 20): SeoTimelineEvent[] {
  const events: SeoTimelineEvent[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    if (!(Date.parse(run.ranAt) >= sinceMs)) continue
    const reach = run.reach ?? null
    // A run that did not reach the site changed nothing it could read; the next one is compared
    // with the last run that DID reach it, so an outage is not reported as twenty changes twice.
    const prev = runs.slice(i + 1).find((r) => siteAnswered(r.reach))
    events.push({
      kind: 'test', at: run.ranAt, runId: run.id, trigger: run.trigger, passed: run.passed, total: run.total, siteFresh: run.siteFresh, reach,
      changes: !siteAnswered(reach) ? [] : prev ? runChanges(prev, run) : null,
    })
  }
  for (const m of moments) {
    if (Date.parse(m.publishedAt) >= sinceMs) events.push({ kind: 'publish', at: m.publishedAt, changed: m.entities })
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max)
}

export type SourceVisitRow = { source: string; referrer_host: string; visitors: number }

/**
 * Visitors from web search and from AI assistants, by the Analytics page's own buckets: search
 * = the `kind: 'search'` sources plus any search host the door left in `other` (ringsOf's fold);
 * AI = the `ai` bucket. Summed per (source, host) row, exactly as the Analytics page sums them.
 */
export function searchAndAiVisits(rows: readonly SourceVisitRow[]): { search: number; ai: number } {
  let search = 0
  let ai = 0
  for (const r of rows) {
    const n = Number(r.visitors) || 0
    if ((SEARCH_SOURCES as readonly string[]).includes(r.source)) search += n
    else if (r.source === 'other' && r.referrer_host && isSearchHost(r.referrer_host)) search += n
    else if (r.source === 'ai') ai += n
  }
  return { search, ai }
}

export type SeoOverview = {
  /** The newest finished run, or null when there is none. `undefined` never: see `readable`. */
  latest: Omit<StoredSeoRun, 'results'> | null
  /** The run in progress (a publish's run waits for the site first), if any. */
  running: { ranAt: string; trigger: SeoRunTrigger } | null
  /** The latest run's fails and couldn't-checks, most important first. null = unreadable. */
  failing: SeoTestResult[] | null
  /** null = the runs or the publish history could not be read (a half timeline would hide
   *  publishes that happened). */
  timeline: SeoTimelineEvent[] | null
  /** The newest publish moment, so the page can say "after you published". null = none or
   *  unreadable. */
  lastPublishedAt: string | null
  visits: { days: 30; search: number | null; ai: number | null }
  /** false = the latest run could not be read (so `latest: null` is not "never tested"). */
  readable: boolean
}

export async function readSeoOverview(supabase: SupabaseClient, artistId: string, opts: { now?: number } = {}): Promise<SeoOverview> {
  const nowMs = opts.now ?? Date.now()
  const window = analyticsWindow(30, nowMs)
  const sinceMs = Date.parse(`${window.since}T00:00:00Z`)

  const [latestRes, runsRes, momentsRes, sourcesRes, running] = await Promise.all([
    latestRun(supabase, artistId).then((v) => ({ ok: true as const, v }), () => ({ ok: false as const })),
    recentRuns(supabase, artistId, 21).then((v) => ({ ok: true as const, v }), () => ({ ok: false as const })),
    Promise.resolve(supabase.rpc('publish_moments', { p_artist_id: artistId })).then(
      (r) => (r.error ? { ok: false as const } : { ok: true as const, v: ((r.data ?? []) as { published_at: string; entities: number }[]).map((m) => ({ publishedAt: String(m.published_at), entities: Number(m.entities) })) }),
      () => ({ ok: false as const }),
    ),
    Promise.resolve(supabase.rpc('analytics_sources', { p_artist_id: artistId, p_since: window.since, p_until: window.until })).then(
      (r) => (r.error || !Array.isArray(r.data) ? { ok: false as const } : { ok: true as const, v: r.data as SourceVisitRow[] }),
      () => ({ ok: false as const }),
    ),
    currentRun(supabase, artistId, nowMs),
  ])

  let latest: SeoOverview['latest'] = null
  let failing: SeoOverview['failing'] = null
  if (latestRes.ok) {
    if (latestRes.v) {
      const { results, ...rest } = latestRes.v
      latest = rest
      failing = failingInPriority(results, latestRes.v.reach ?? null)
    } else {
      failing = []
    }
  }
  const visits = sourcesRes.ok ? searchAndAiVisits(sourcesRes.v) : null

  return {
    latest,
    running,
    failing,
    timeline: runsRes.ok && momentsRes.ok ? buildTimeline(runsRes.v, momentsRes.v, sinceMs) : null,
    lastPublishedAt: momentsRes.ok ? (momentsRes.v[0]?.publishedAt ?? null) : null,
    visits: { days: 30, search: visits ? visits.search : null, ai: visits ? visits.ai : null },
    readable: latestRes.ok,
  }
}
