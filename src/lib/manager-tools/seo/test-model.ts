/**
 * THE TEST TAB'S ARITHMETIC AND WORDS, pure. The page never decides a result (lib/seo-tests
 * types.ts): everything here is a read of a stored run. No DOM, no clock of its own (times come
 * in as arguments), so every number and sentence the tab shows is testable without rendering.
 *
 * COUNTS (Sam's header, round 2: "19 of 24 tests pass" · "5 need you"):
 *   pass       status 'pass'                        → the "Passing" filter
 *   need you   status 'fail'                        → the "Needs you" filter
 *   unknown    "couldn't check": NOT a pass and not a fail; said beside the score and given
 *              its own filter, "Couldn't check", so every row sits in exactly one filter
 *   na         "doesn't apply": left out of both sides of "19 of 24" (types.ts SeoTestStatus);
 *              shown only under All
 * So pass + need + couldn't = the score's M, and All = M + doesn't-apply.
 * (Since 2026-09-29 the tab itself shows no filter, only All: `groupsFor(results, 'all')`. The
 * filter rules stay here, tested, for whatever next lists the tests by status.)
 * Derived from `results`, never from the row's stored `passed` / `total`: the stored total counts
 * `na` results, and the page must not.
 */
import { SEO_TEST_DEFS, SEO_TEST_GROUPS, SITE_FREE_TESTS } from '@/lib/seo-tests/defs'
import { SEO_MANUAL_COOLDOWN_S, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoRunReach, SeoTestAction, SeoTestDef, SeoTestGroup, SeoTestId, SeoTestResult, SeoTestStatus } from '@/lib/seo-tests/types'
import { SEO_EDIT_TARGETS } from './sections'

export type TestFilter = 'all' | 'need' | 'pass' | 'unknown'

export type RunCounts = { pass: number; fail: number; unknown: number; na: number; applicable: number }

const KNOWN: readonly SeoTestStatus[] = ['pass', 'fail', 'unknown', 'na']

export function countResults(results: readonly SeoTestResult[]): RunCounts {
  const c: RunCounts = { pass: 0, fail: 0, unknown: 0, na: 0, applicable: 0 }
  for (const r of results) {
    if (!KNOWN.includes(r.status)) continue
    c[r.status]++
    if (r.status !== 'na') c.applicable++
  }
  return c
}

const FILTER_STATUS: Record<Exclude<TestFilter, 'all'>, SeoTestStatus> = { need: 'fail', pass: 'pass', unknown: 'unknown' }

export function matchesFilter(result: SeoTestResult | null, filter: TestFilter): boolean {
  if (filter === 'all') return true
  return !!result && result.status === FILTER_STATUS[filter]
}

/** What an emptied filter says instead of a blank page. */
export const EMPTY_FILTER: Record<Exclude<TestFilter, 'all'>, string> = {
  need: 'Nothing needs you',
  pass: 'Nothing passing yet',
  unknown: 'Every test could be checked',
}

/* ── the headline: ONE helper for every place a run is summed up ────────────────────── */

/** Tests that read ONLY the home page's own html (its title, summary, fact card). */
const HOME_PAGE_TESTS: readonly SeoTestId[] = ['title', 'desc', 'card']

/**
 * THE SITE DIDN'T ANSWER (review 2026-09-29, P1: a site that timed out read "1 thing needs you:
 * Create your MusicBrainz page"; one that answered error 500 read nine to-dos about a "settings
 * file"). Decided from STATUSES only, so rewording a test's sentences cannot break it: the three
 * tests that read nothing but the home page could not check it, and no test that needs the site
 * passed. A site that is up passes at least one of those (a title, a fact card, a bot's visit),
 * whatever else is wrong with it. Stands in for a run-level "did the home page answer" field the
 * engine does not store yet.
 */
export function isUnreachable(results: readonly SeoTestResult[]): boolean {
  if (!results.length) return false
  const by = new Map(results.map((r) => [r.id, r.status]))
  const homeUnread = HOME_PAGE_TESTS.every((id) => by.get(id) === 'unknown')
  const siteAnswered = results.some((r) => r.status === 'pass' && !SITE_FREE_TESTS.has(r.id))
  return homeUnread && !siteAnswered
}

export type RunHeadline =
  /** The run had no site to test. */
  | { kind: 'no-site'; title: string; detail: string[] }
  /** The site didn't answer: one plain thing, no score. */
  | { kind: 'unreachable'; title: string; detail: string[] }
  /** Nothing passed or failed, but the site did answer: no score either. */
  | { kind: 'unchecked'; title: string; detail: string[] }
  /** Every test was `na`: 0 of 0 is not a score. */
  | { kind: 'none-apply'; title: string; detail: string[] }
  | { kind: 'score'; title: string; detail: string[] }

/** What each way of NOT answering reads as (the run's `reach`, 2026-09-29). */
const NOT_ANSWERED: Record<Exclude<SeoRunReach['state'], 'answered'>, { title: string; detail: string }> = {
  'no-answer': { title: 'We couldn’t reach your site', detail: 'It may be down, so nothing else was checked' },
  'server-error': { title: 'Your site answered with an error', detail: 'It may be down, so nothing else was checked' },
  refused: { title: 'Your site turned our visit away', detail: 'So nothing else could be checked' },
}

/**
 * THE HEADLINE for a run, the same words wherever a run is summed up. The score is always
 * "N of M tests pass" (M leaves `na` out); never "All M pass", which read true while tests
 * couldn't be checked (review P2). `detail` is what sits beside it, in order: "5 need you",
 * "1 couldn't be checked". `headlineLine` joins them for one-line places.
 *
 * Whether the site answered is read from the run's own `reach` FIRST (what the run saw when it
 * opened the home page). Only a run without one (an older run, or a run whose own code broke)
 * falls back to the statuses rule (`isUnreachable`).
 */
export function runHeadline(run: Pick<StoredSeoRun, 'results' | 'siteUrl'> & { reach?: SeoRunReach | null }): RunHeadline {
  if (hasNoSite(run)) return { kind: 'no-site', title: 'No site connected', detail: [] }
  const reach = run.reach ?? null
  if (reach && reach.state !== 'answered' && NOT_ANSWERED[reach.state]) {
    const w = NOT_ANSWERED[reach.state]
    return { kind: 'unreachable', title: w.title, detail: [w.detail] }
  }
  if (!reach && isUnreachable(run.results)) return { kind: 'unreachable', title: NOT_ANSWERED['no-answer'].title, detail: [NOT_ANSWERED['no-answer'].detail] }
  const c = countResults(run.results)
  if (c.applicable === 0) return { kind: 'none-apply', title: 'None of the tests apply to you', detail: [] }
  if (c.pass === 0 && c.fail === 0) return { kind: 'unchecked', title: 'We couldn’t check your site this time', detail: [] }
  const detail: string[] = []
  if (c.fail) detail.push(`${c.fail} need${c.fail === 1 ? 's' : ''} you`)
  if (c.unknown) detail.push(`${c.unknown} couldn’t be checked`)
  return { kind: 'score', title: c.applicable === 1 ? `${c.pass} of 1 test passes` : `${c.pass} of ${c.applicable} tests pass`, detail }
}

/** "23 of 24 tests pass · 1 couldn’t be checked". */
export function headlineLine(h: RunHeadline): string {
  return [h.title, ...h.detail].join(' · ')
}

/** Do the rows carry results worth opening? Not when the run had no site or the site didn't
 *  answer: 24 rows of "couldn't check" would bury the one thing that matters. */
export function rowsAreResults(h: RunHeadline): boolean {
  return h.kind !== 'no-site' && h.kind !== 'unreachable'
}

export type TestRow = { def: SeoTestDef; result: SeoTestResult | null }
export type TestGroupView = { id: SeoTestGroup; label: string; rows: TestRow[]; pass: number; applicable: number }

/**
 * The four groups in page order (defs.ts), each with its rows under the filter and its count
 * over ALL its rows ("9 of 10" does not change with the filter). A group the filter empties is
 * left out. A test the run has no result for (it did not exist yet, or its result was dropped
 * as malformed) still gets its row, with no result: it is never shown as a pass or a fail.
 */
export function groupsFor(results: readonly SeoTestResult[], filter: TestFilter): TestGroupView[] {
  const byId = new Map<SeoTestId, SeoTestResult>()
  for (const r of results) if (!byId.has(r.id)) byId.set(r.id, r)
  const out: TestGroupView[] = []
  for (const g of SEO_TEST_GROUPS) {
    const all: TestRow[] = SEO_TEST_DEFS.filter((d) => d.group === g.id).map((def) => ({ def, result: byId.get(def.id) ?? null }))
    const counts = countResults(all.flatMap((r) => (r.result ? [r.result] : [])))
    const rows = all.filter((r) => matchesFilter(r.result, filter))
    if (rows.length) out.push({ id: g.id, label: g.label, rows, pass: counts.pass, applicable: counts.applicable })
  }
  return out
}

/** The bold words in front of a result's sentence. A pass reads plain. */
export function leadOf(r: Pick<SeoTestResult, 'status' | 'lead'>): string | null {
  switch (r.status) {
    case 'fail':
      return r.lead === 'Almost' ? 'Almost:' : 'Not yet:'
    case 'unknown':
      return 'Couldn’t check:'
    case 'na':
      return 'Doesn’t apply:'
    default:
      return null
  }
}

/** The sentence as shown: after a lead it stays as the engine wrote it (lower-case start);
 *  standing alone (a pass) it starts with a capital. */
export function sentenceOf(r: Pick<SeoTestResult, 'status' | 'lead' | 'sentence'>): string {
  const s = r.sentence ?? ''
  return leadOf(r) ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** A run tested with no site connected: every result is "no site". Said once, not 24 times. */
export function hasNoSite(run: Pick<StoredSeoRun, 'siteUrl'>): boolean {
  return !run.siteUrl
}

/**
 * The live site may not have been showing the latest publish (store.ts `siteFresh`): a run
 * after a publish that could not confirm the site had caught up, or any run that saw it had not.
 */
export function isStale(run: Pick<StoredSeoRun, 'siteFresh' | 'trigger'>): boolean {
  return run.siteFresh === false || (run.trigger === 'publish' && run.siteFresh !== true)
}

/** "Your site may not have updated yet" is news only for a while: after an hour, "test again in
 *  a minute" would have been done or not needed (review: it stayed on days-old runs). */
const STALE_FOR_MS = 60 * 60_000

export function showStale(run: Pick<StoredSeoRun, 'siteFresh' | 'trigger' | 'ranAt'>, nowMs: number): boolean {
  const at = Date.parse(run.ranAt)
  return isStale(run) && Number.isFinite(at) && nowMs - at < STALE_FOR_MS
}

/** A run older than this is said to be old (review: no age limit, no "this is old" line). */
const OLD_AFTER_DAYS = 30

/** "6 weeks ago" for a run older than OLD_AFTER_DAYS, else null. */
export function oldRunText(ranAt: string, nowMs: number): string | null {
  const at = Date.parse(ranAt)
  if (!Number.isFinite(at)) return null
  const days = Math.floor((nowMs - at) / 86_400_000)
  if (days <= OLD_AFTER_DAYS) return null
  if (days < 7 * 9) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

/** The host a person reads, "www.skeenmusic.com", or '' for a bad address. */
export function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return ''
  }
}

/** The run tested another address than the artist's site has now (review N12). Compared by
 *  origin; no current site is a different state (no site connected), not a change. */
export function siteChanged(runSiteUrl: string, currentSite: string | null): boolean {
  if (!runSiteUrl || !currentSite) return false
  try {
    return new URL(runSiteUrl).origin !== new URL(currentSite).origin
  } catch {
    return false
  }
}

/** When "Test again" opens after a run started at `ranAt` (ms), or null. The database is the
 *  authority (a manual run within 60 s of the last one is refused); this only says so early. */
export function cooldownEnd(ranAt: string | null | undefined): number | null {
  const t = ranAt ? Date.parse(ranAt) : NaN
  return Number.isFinite(t) ? t + SEO_MANUAL_COOLDOWN_S * 1000 : null
}

/** Whole seconds left until `end`, 0 when passed. Never more than the cool-down itself: a
 *  browser clock that is behind the server's would otherwise read "3660 s" (review N5). */
export function secondsLeft(end: number | null, nowMs: number): number {
  if (end == null) return 0
  const s = Math.ceil((end - nowMs) / 1000)
  return s > SEO_MANUAL_COOLDOWN_S ? 0 : Math.max(0, s)
}

export type RunRefusal = { kind: 'cooldown'; retryInS: number } | { kind: 'busy'; error: string } | { kind: 'failed'; error: string }

/**
 * What a refused or failed "Test again" means, from the claim's own `reason` (test-actions.ts
 * passes it through). Only an answer WITHOUT a reason (an older server) is read from its words.
 */
export function classifyRunError(res: { error: string; reason?: string | null; retryInS?: number | null }): RunRefusal {
  const wait = typeof res.retryInS === 'number' && res.retryInS > 0 ? Math.min(res.retryInS, SEO_MANUAL_COOLDOWN_S) : SEO_MANUAL_COOLDOWN_S
  if (res.reason === 'cooldown') return { kind: 'cooldown', retryInS: wait }
  if (res.reason === 'busy') return { kind: 'busy', error: res.error }
  if (res.reason) return { kind: 'failed', error: res.error || 'The test couldn’t finish.' }
  if (/a moment ago/i.test(res.error)) return { kind: 'cooldown', retryInS: wait }
  if (/already running/i.test(res.error)) return { kind: 'busy', error: res.error }
  return { kind: 'failed', error: res.error || 'The test couldn’t finish.' }
}

/** A pencil's destination: the tab or tool that holds the setting. */
export function editHref(artistId: string, target: Extract<SeoTestAction, { kind: 'edit' }>['target']): string {
  return `/artists/${artistId}/${SEO_EDIT_TARGETS[target]}`
}

/** An outside link, only if it is https (store.ts keeps only https; checked again here, at the
 *  edge where it becomes an href, so a stored `javascript:` can never reach one). */
export function safeHttps(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/* ── the open row's card ────────────────────────────────────────────────────────────── */

/** One line of WHAT WE SAW. `repeat`: the line above has the same label, so the card shows the
 *  label once and lines this value up under it (a list of pages reads as one list, not the
 *  same word five times). */
export type EvidenceRow = { label: string; value: string; repeat: boolean }

/**
 * A result's evidence as the card shows it. Stored evidence is what a site sent, so anything
 * can be in it: a row that isn't an object, a label that isn't text. Each becomes a plain
 * string here (never html; the card renders it as React text).
 */
export function evidenceRows(evidence: unknown): EvidenceRow[] {
  if (!Array.isArray(evidence)) return []
  const out: EvidenceRow[] = []
  for (const e of evidence as unknown[]) {
    const row = e && typeof e === 'object' ? (e as { label?: unknown; value?: unknown }) : {}
    const label = String(row.label ?? '')
    const value = String(row.value ?? '')
    out.push({ label, value, repeat: out.length > 0 && out[out.length - 1].label === label })
  }
  return out
}

/** The running test's clock: "0:07", "1:32". Whole seconds; never below 0:00. */
export function clockText(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ── times, in the manager's own time zone ──────────────────────────────────────────── */

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

function dayWord(at: Date, now: Date, locale?: string): { word: string; relative: boolean } {
  if (sameDay(at, now)) return { word: 'today', relative: true }
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(at, y)) return { word: 'yesterday', relative: true }
  const opts: Intl.DateTimeFormatOptions = at.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  return { word: at.toLocaleDateString(locale, opts), relative: false }
}

const clock = (at: Date, locale?: string) => at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })

/** "today at 9:14 PM", "yesterday at 6:00 AM", "Sep 21 at 9:14 PM". '' for a bad date. */
export function whenText(iso: string, now: Date, locale?: string): string {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return ''
  return `${dayWord(at, now, locale).word} at ${clock(at, locale)}`
}

/** A history dot's label: "Today, 9:14 PM · passed". */
export function dotText(iso: string, status: SeoTestStatus, now: Date, locale?: string): string {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return STATUS_WORD[status]
  const { word, relative } = dayWord(at, now, locale)
  const day = relative ? word.charAt(0).toUpperCase() + word.slice(1) : word
  return `${day}, ${clock(at, locale)} · ${STATUS_WORD[status]}`
}

const STATUS_WORD: Record<SeoTestStatus, string> = {
  pass: 'passed',
  fail: 'needed you',
  unknown: 'couldn’t check',
  na: 'didn’t apply',
}

/* ── checking it yourself: other tools, under "What we saw" ─────────────────────────── */

/**
 * The outside checkers the old top row offered ("Test with": Rich Results Test, Schema
 * validator, PageSpeed, Search Console, Bing Webmaster), now beside the test each one checks,
 * in the open row's card under "What we saw", where a product name is allowed (review N4: five
 * jargon names sat in the header). `site` is the address the run tested.
 */
export function checkItYourself(id: SeoTestId, site: string): { label: string; href: string }[] {
  const enc = encodeURIComponent(`${site.replace(/\/+$/, '')}/`)
  const rich = { label: 'Google’s Rich Results Test', href: `https://search.google.com/test/rich-results?url=${enc}` }
  const schema = { label: 'Schema.org validator', href: `https://validator.schema.org/#url=${enc}` }
  const console_ = { label: 'Google Search Console', href: 'https://search.google.com/search-console' }
  const bing = { label: 'Bing Webmaster Tools', href: 'https://www.bing.com/webmasters' }
  const speed = { label: 'Google PageSpeed Insights', href: `https://pagespeed.web.dev/analysis?url=${enc}` }
  const BY: Partial<Record<SeoTestId, { label: string; href: string }[]>> = {
    google: [console_],
    allowed: [console_],
    list: [console_],
    bing: [bing],
    bingwm: [bing],
    words: [speed],
    card: [rich, schema],
    genre: [schema],
    place: [schema],
    profiles: [schema],
    shows: [rich],
    releases: [schema],
  }
  return site ? (BY[id] ?? []) : []
}
