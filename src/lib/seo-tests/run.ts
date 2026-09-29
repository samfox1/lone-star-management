/**
 * ONE RUN of the 24 SEO / GEO tests: claim → read what Tapir knows → gather the evidence ONCE →
 * run every test in SEO_TEST_IDS order → store. The page only ever reads what this stored.
 *
 * What a run guarantees, each pinned by tests/unit/seo-tests/run.test.ts:
 *   • ONE AT A TIME, and a cool-down for "Test again", enforced by the DATABASE (the claim in
 *     store.ts; the rules live in the migration). A refused claim gathers nothing and fetches
 *     nothing, so a hammered button cannot hammer the artist's site or MusicBrainz.
 *   • ONE TEST CANNOT SINK THE RUN. Every test is wrapped: a throw, or an answer that is not a
 *     result for that test, becomes `unknown` ("this test broke") and the other 23 stand.
 *   • A TIME BUDGET for the whole gather. Whatever has not answered by then is `unknown` with
 *     "ran out of time", never `pass` and never `fail` (types.ts, honesty rule 1).
 *   • NO SITE is not a crash: 24 × `unknown`, "no site is connected", and nothing is fetched.
 *   • STALE SITE is recorded, not hidden: `site_fresh` (fresh.ts) says whether the live site was
 *     showing the latest publish when the run looked.
 *
 * The engine (the evidence gatherers and the 24 tests, written beside this file by other hands)
 * is INJECTED: `deps.engine`, else `./engine` loaded on first use. Unit tests run on fakes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { siteFreshness } from './fresh'
import { readKnown as readKnownDefault } from './known'
import { claimRun, failRun, finishRun } from './store'
import { SEO_TEST_IDS, type SeoEvidence, type SeoKnown, type SeoRunTrigger, type SeoTest, type SeoTestId, type SeoTestResult } from './types'

/** What `gatherSiteEvidence` answers: the site's side of the evidence (everything but the share
 *  picture, MusicBrainz and what Tapir knows, which the run adds). */
export type SitePages = Omit<SeoEvidence, 'shareImage' | 'musicbrainz' | 'known'>

/** Passed to every gatherer. `signal` aborts when the run's budget runs out. */
export type GatherOptions = { fetcher?: typeof fetch; signal?: AbortSignal }

export type SeoEngine = {
  gatherSiteEvidence: (origin: string, opts: GatherOptions) => Promise<SitePages>
  fetchShareImage: (homeHtml: string | null, origin: string, opts: GatherOptions) => Promise<SeoEvidence['shareImage']>
  lookupMusicBrainz: (known: SeoKnown, opts: GatherOptions) => Promise<SeoEvidence['musicbrainz']>
  tests: Partial<Record<SeoTestId, SeoTest>>
  /** The Apple Music storefront fix: the link moved to the US store, or null when there is
   *  nothing to move (apple-storefront.ts `appleStorefrontFix(url)?.fixed`). */
  appleStorefrontFix: (url: string) => string | null
}

export async function loadEngine(): Promise<SeoEngine> {
  return (await import('./engine')).SEO_ENGINE
}

/** The whole gather (pages, share picture, MusicBrainz) must answer inside this. Each fetch has
 *  its own 10 s timeout (guarded-fetch); this bounds the sum. */
export const SEO_RUN_BUDGET_MS = 90_000

export type RunDeps = {
  engine?: SeoEngine
  readKnown?: (supabase: SupabaseClient, artistId: string, opts: { now?: number }) => Promise<SeoKnown>
  /** Every publish moment for the artist (publish_moments), for the stale-site verdict. */
  readMoments?: (supabase: SupabaseClient, artistId: string) => Promise<string[]>
  fetcher?: typeof fetch
  budgetMs?: number
  now?: () => number
  /** From the publish hook: what waiting for the site found. The run's own look wins. */
  freshness?: { fresh: boolean | null }
  /** A sentence to keep with the run (the publish hook's "we couldn't confirm…"). */
  note?: string | null
}

export type SeoRunOutcome =
  | { ok: true; runId: string; results: SeoTestResult[]; siteFresh: boolean | null; note: string | null }
  | { ok: false; reason: 'busy' | 'cooldown' | 'denied' | 'error'; error: string; retryInS?: number | null }

/* ── results the run writes itself ──────────────────────────────────────────────────── */

export function unknownResult(id: SeoTestId, value: string, sentence: string, limits?: string): SeoTestResult {
  return { id, status: 'unknown', value, sentence, evidence: [], ...(limits ? { limits } : {}) }
}

const BROKE = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'this test broke before it could check, so we don’t know yet.', 'A fault in the test itself, not in your site.')
const NOT_READY = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'this test isn’t ready yet.')
const NO_SITE = (id: SeoTestId) => unknownResult(id, 'No site', 'no site is connected, so there was nothing to check.')
const NO_ANSWER = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'your site didn’t answer in time, so we couldn’t check this.')
const OUT_OF_TIME = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'we ran out of time before this part answered.')

const STATUSES = new Set(['pass', 'fail', 'unknown'])

/** A result FOR THIS TEST, in the contract's shape. Anything else is a broken test. */
function isResultFor(r: unknown, id: SeoTestId): r is SeoTestResult {
  if (!r || typeof r !== 'object' || typeof (r as { then?: unknown }).then === 'function') return false
  const x = r as Record<string, unknown>
  return x.id === id && STATUSES.has(x.status as string) && typeof x.value === 'string' && typeof x.sentence === 'string' && Array.isArray(x.evidence)
}

/** Run every test, in SEO_TEST_IDS order. Never throws. */
export function runAllTests(tests: Partial<Record<SeoTestId, SeoTest>>, evidence: SeoEvidence): SeoTestResult[] {
  return SEO_TEST_IDS.map((id) => {
    const test = tests[id]
    if (typeof test !== 'function') return NOT_READY(id)
    try {
      const r = test(evidence)
      return isResultFor(r, id) ? r : BROKE(id)
    } catch {
      return BROKE(id)
    }
  })
}

/* ── the gather, inside the budget ──────────────────────────────────────────────────── */

const TIMEOUT = Symbol('timeout')
const FAILED = Symbol('failed')
type Late = typeof TIMEOUT | typeof FAILED

/** Which tests a missing part of the evidence leaves unanswerable. */
const DEPENDS: Record<'shareImage' | 'musicbrainz', SeoTestId[]> = { shareImage: ['share'], musicbrainz: ['mb'] }

type Gathered =
  | { ok: true; evidence: SeoEvidence; missed: ('shareImage' | 'musicbrainz')[]; timedOut: boolean }
  | { ok: false; timedOut: boolean }

async function gather(engine: SeoEngine, known: SeoKnown, origin: string, deps: { fetcher?: typeof fetch; deadline: number; now: () => number }): Promise<Gathered> {
  const controller = new AbortController()
  const opts: GatherOptions = { fetcher: deps.fetcher, signal: controller.signal }
  const timers: ReturnType<typeof setTimeout>[] = []
  /** The promise's value, or TIMEOUT at the deadline, or FAILED if it threw. */
  const within = <T>(p: Promise<T>): Promise<T | Late> =>
    Promise.race([
      p.then((v) => v, () => FAILED as Late),
      new Promise<Late>((resolve) => {
        timers.push(setTimeout(() => resolve(TIMEOUT), Math.max(0, deps.deadline - deps.now())))
      }),
    ])
  const start = <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return Promise.resolve(f())
    } catch (e) {
      return Promise.reject(e)
    }
  }
  try {
    const mb = within(start(() => engine.lookupMusicBrainz(known, opts)))
    const pages = await within(start(() => engine.gatherSiteEvidence(origin, opts)))
    if (pages === TIMEOUT || pages === FAILED) return { ok: false, timedOut: pages === TIMEOUT }
    const home = pages.plain?.find((p) => p.path === '/')?.html ?? null
    const [share, brainz] = await Promise.all([within(start(() => engine.fetchShareImage(home, origin, opts))), mb])
    const missed: ('shareImage' | 'musicbrainz')[] = []
    if (share === TIMEOUT || share === FAILED) missed.push('shareImage')
    if (brainz === TIMEOUT || brainz === FAILED) missed.push('musicbrainz')
    const evidence: SeoEvidence = {
      ...pages,
      // A share picture we never finished fetching is NOT "the page names none": the `share`
      // result is replaced with `unknown` below, whatever the test made of this null.
      shareImage: share === TIMEOUT || share === FAILED ? null : share,
      musicbrainz:
        brainz === TIMEOUT || brainz === FAILED
          ? { looked: false, artistUrl: null, matchedOn: null, error: brainz === TIMEOUT ? 'ran out of time' : 'the lookup failed' }
          : brainz,
      known,
    }
    return { ok: true, evidence, missed, timedOut: share === TIMEOUT || brainz === TIMEOUT }
  } finally {
    for (const t of timers) clearTimeout(t)
    controller.abort() // stragglers stop; a gatherer that honours the signal frees its sockets
  }
}

/* ── the run ────────────────────────────────────────────────────────────────────────── */

/** Every publish moment for the artist, newest first; [] when unreadable (the stale-site
 *  verdict then says "couldn't tell", never "fresh"). */
export async function readPublishMoments(supabase: SupabaseClient, artistId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('publish_moments', { p_artist_id: artistId })
  if (error) return []
  return ((data ?? []) as { published_at?: unknown }[]).map((r) => String(r.published_at ?? '')).filter(Boolean)
}

/**
 * Run the tests for one artist and store the run. Never throws. The caller has already checked
 * the signed-in manager owns the artist (test-actions.ts); RLS and the claim trigger check again.
 */
export async function runSeoTests(supabase: SupabaseClient, artistId: string, trigger: SeoRunTrigger, deps: RunDeps = {}): Promise<SeoRunOutcome> {
  const now = deps.now ?? Date.now
  const claim = await claimRun(supabase, artistId, trigger)
  if (!claim.ok) return { ok: false, reason: claim.reason, error: claim.error, retryInS: claim.retryInS }
  const deadline = now() + (deps.budgetMs ?? SEO_RUN_BUDGET_MS)

  try {
    const known = await (deps.readKnown ?? readKnownDefault)(supabase, artistId, { now: now() })
    let results: SeoTestResult[]
    let siteFresh: boolean | null = null
    const notes: string[] = deps.note ? [deps.note] : []

    if (!known.siteUrl) {
      results = SEO_TEST_IDS.map(NO_SITE)
    } else {
      const engine = deps.engine ?? (await loadEngine())
      const [got, moments] = await Promise.all([
        gather(engine, known, known.siteUrl, { fetcher: deps.fetcher, deadline, now }),
        (deps.readMoments ?? readPublishMoments)(supabase, artistId).catch(() => [] as string[]),
      ])
      if (!got.ok) {
        results = SEO_TEST_IDS.map(got.timedOut ? OUT_OF_TIME : NO_ANSWER)
        notes.push(got.timedOut ? 'Your site took too long to answer, so nothing could be checked.' : 'We couldn’t read your site, so nothing could be checked.')
      } else {
        results = runAllTests(engine.tests, got.evidence)
        for (const part of got.missed) {
          for (const id of DEPENDS[part]) {
            const at = results.findIndex((r) => r.id === id)
            if (at >= 0) results[at] = OUT_OF_TIME(id)
          }
        }
        if (got.timedOut) notes.push('Part of the check ran out of time.')
        const verdict = siteFreshness(got.evidence.sitemap?.lastmods, known.published?.publishedAt ?? null, moments)
        siteFresh = verdict ?? deps.freshness?.fresh ?? null
        if (siteFresh === false && !deps.note) notes.push('Your site was still showing an older publish when we tested.')
      }
    }

    const saved = await finishRun(supabase, claim.runId, {
      results,
      siteUrl: known.siteUrl,
      siteFresh,
      publishedAt: known.published?.publishedAt ?? null,
      note: notes.length ? notes.join(' ') : null,
    })
    if (!saved.ok) return { ok: false, reason: 'error', error: saved.error }
    return { ok: true, runId: claim.runId, results, siteFresh, note: notes.length ? notes.join(' ') : null }
  } catch {
    await failRun(supabase, claim.runId, 'The test couldn’t finish.')
    return { ok: false, reason: 'error', error: 'The test couldn’t finish. Try again in a minute.' }
  }
}
