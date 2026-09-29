/**
 * THE TEST TAB'S ARITHMETIC AND WORDS, pure. The page never decides a result (lib/seo-tests
 * types.ts): everything here is a read of a stored run. No DOM, no clock of its own (times come
 * in as arguments), so every number and sentence the tab shows is testable without rendering.
 *
 * COUNTS (Sam's header, round 2: "19 of 24 tests pass" · "5 need you"):
 *   pass       status 'pass'
 *   need you   status 'fail' (the "Needs you" filter shows exactly these)
 *   unknown    "couldn't check": NOT a pass and not a fail; said separately, never hidden
 *   na         "doesn't apply": left out of both sides of "19 of 24" (types.ts SeoTestStatus)
 * Derived from `results`, never from the row's stored `passed` / `total`: the stored total counts
 * `na` results, and the page must not.
 */
import { SEO_TEST_DEFS, SEO_TEST_GROUPS } from '@/lib/seo-tests/defs'
import { SEO_MANUAL_COOLDOWN_S, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoTestAction, SeoTestDef, SeoTestGroup, SeoTestId, SeoTestResult, SeoTestStatus } from '@/lib/seo-tests/types'
import { SEO_EDIT_TARGETS } from '../sections'

export type TestFilter = 'all' | 'need' | 'pass'

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

export function matchesFilter(result: SeoTestResult | null, filter: TestFilter): boolean {
  if (filter === 'all') return true
  if (!result) return false
  return filter === 'need' ? result.status === 'fail' : result.status === 'pass'
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

/** When "Test again" opens after a run started at `ranAt` (ms), or null. The database is the
 *  authority (a manual run within 60 s of the last one is refused); this only says so early. */
export function cooldownEnd(ranAt: string | null | undefined): number | null {
  const t = ranAt ? Date.parse(ranAt) : NaN
  return Number.isFinite(t) ? t + SEO_MANUAL_COOLDOWN_S * 1000 : null
}

/** Whole seconds left until `end`, 0 when passed. */
export function secondsLeft(end: number | null, nowMs: number): number {
  return end == null ? 0 : Math.max(0, Math.ceil((end - nowMs) / 1000))
}

export type RunRefusal = { kind: 'cooldown'; retryInS: number } | { kind: 'busy'; error: string } | { kind: 'failed'; error: string }

/**
 * What a refused or failed "Test again" means. runSeoTestsAction passes `retryInS` for the
 * cool-down but not the claim's `reason`, so "busy" is read from its sentence (store.ts
 * claimRun: "A test is already running…"). The report asks for `reason` to be passed through.
 */
export function classifyRunError(res: { error: string; retryInS?: number | null }): RunRefusal {
  if (typeof res.retryInS === 'number' && res.retryInS > 0) return { kind: 'cooldown', retryInS: res.retryInS }
  if (/a moment ago/i.test(res.error)) return { kind: 'cooldown', retryInS: SEO_MANUAL_COOLDOWN_S }
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

export const STATUS_WORD: Record<SeoTestStatus, string> = {
  pass: 'passed',
  fail: 'needed you',
  unknown: 'couldn’t check',
  na: 'didn’t apply',
}
