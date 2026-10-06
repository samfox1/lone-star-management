/**
 * "HOW FANS FIND YOU": Google's and Bing's search numbers for an artist's site, in ONE shape
 * (Sam, 2026-10-02). PURE: the answers come in already parsed (search-engines/google.ts
 * `searchAnalytics`, bing.ts `trafficStats` / `queryStats`); the asking lives in
 * search-stats-ask.ts. Only what the Metrics page shows is asked for: the pages, countries and
 * devices lists left with the r12 rebuild, and so did their requests (2026-10-06, Sam: yes).
 *
 * The words, the same for both engines:
 *   impressions  how often the site was SEEN in search results (Bing's and Google's word agree)
 *   clicks       how often someone clicked through to it
 *   ctr          clicks ÷ impressions; null with no impressions (never 0%)
 *   position     the average rank when SEEN (1 = top); null when there is none (never rank 0).
 *                Google gives it per row and for the total. Bing gives it only per search
 *                (AvgImpressionPosition), so Bing's total position is those, weighted by impressions.
 *
 * Honesty rules, each pinned by tests/unit/manager-tools/seo/search-stats.test.ts:
 *   • The headline numbers are the engine's TOTAL. Google hides rare searches (anonymised) and
 *     both engines list only their top rows, so the searches never add up to it: `unlisted` is
 *     what the list leaves out, said out loud.
 *   • An engine Tapir COULDN'T ASK (not registered, no key on the server, quota, an error, out of
 *     time) is a state with no numbers at all, never a page of zeros. An engine that answered
 *     with nothing for the period is `no_data` (a new site: Bing for Skeen on 2026-10-02).
 *   • Google's last ~2 days are preliminary (`preliminaryFrom`, from its metadata); its "today"
 *     comes back 0 / 0 because it hasn't counted it yet, so trailing EMPTY preliminary days are
 *     dropped. Inside the data, a day with no row is a real zero day (the engines leave them out).
 */
import type { BingDay, BingResult, BingTopRow } from '@/lib/search-engines/bing'
import type { GoogleResult, GoogleSearchAnswer, GoogleSearchRequest, GoogleSearchRow } from '@/lib/search-engines/google'
import { DAY } from '@/lib/search-engines/parse'

export type SearchEngineId = 'google' | 'bing'

/** The periods the tab offers, in days, both ends included (Search Console's "Last 28 days" and
 *  "Last 3 months"). */
export const SEARCH_PERIODS = { '28d': 28, '3m': 90 } as const
export type SearchPeriodKey = keyof typeof SEARCH_PERIODS
export type SearchPeriod = { key: SearchPeriodKey; days: number; start: string; end: string }

export const isSearchPeriodKey = (v: unknown): v is SearchPeriodKey => typeof v === 'string' && Object.hasOwn(SEARCH_PERIODS, v)

export type SearchTotals = { clicks: number; impressions: number; ctr: number | null; position: number | null }
/** One day. `final` false = the engine is still counting it (Google's preliminary days). */
export type SearchDay = { date: string; clicks: number; impressions: number; final: boolean }
/** A search, a page (`key` is its address), a country (ISO alpha-3, upper case) or a device. */
export type SearchRow = { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null }

/** One search on one day (Google) or week (Bing): how often the site was seen for it and the
 *  spot it held. Only rows with a spot. What the "your spot" line and each search's trend are
 *  drawn from (search-spot.ts). */
export type SearchDayRow = { key: string; date: string; impressions: number; position: number }

export type SearchStats = {
  engine: SearchEngineId
  period: SearchPeriod
  totals: SearchTotals
  /** Every day from the first with data to the last, oldest first. */
  series: SearchDay[]
  /** Top searches, busiest first (at most TOP). */
  queries: SearchRow[]
  /** Every search's spot per day (Google) or per week (Bing), oldest first, then by search. */
  searchDays: SearchDayRow[]
  /** In the totals but not in the search list: rare searches the engine hides, and any past the top. */
  unlisted: { clicks: number; impressions: number }
  /** The first and last day the engine has numbers for in the period. */
  coverage: { from: string; to: string } | null
  /** The first preliminary day (Google), or null. */
  preliminaryFrom: string | null
  /** A part Google could be done without was refused (GOOGLE_OPTIONAL_PARTS): the rest is shown,
   *  and the answer is not kept, so the missing part is asked for again next time. */
  incomplete?: true
}

export const COULDNT_ASK = ['not_registered', 'no_key', 'quota', 'error', 'timeout'] as const
export type CouldntAsk = (typeof COULDNT_ASK)[number]

/** One engine's answer for the tab. `reason` / `status`: the client's code and HTTP status, for
 *  the operator (never the engine's words). */
export type EngineStats =
  | { engine: SearchEngineId; state: 'ok'; stats: SearchStats }
  | { engine: SearchEngineId; state: 'no_data'; period: SearchPeriod }
  | { engine: SearchEngineId; state: CouldntAsk; period: SearchPeriod; reason?: string; status?: number }

/** How many searches are kept. */
export const TOP = 50

/* ── days ───────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/** Today in Search Console's time zone (Pacific). */
export function pacificDay(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The period ending today (Pacific time), `days` long, both ends included. */
export function searchPeriod(key: SearchPeriodKey, now: number): SearchPeriod {
  const days = SEARCH_PERIODS[key]
  const end = pacificDay(now)
  return { key, days, start: addDays(end, -(days - 1)), end }
}

const inPeriod = (p: SearchPeriod, day: string | null): day is string => day !== null && DAY.test(day) && day >= p.start && day <= p.end

/** Sorted days, duplicates summed, gaps inside filled with zero, trailing empty preliminary days
 *  dropped. */
function dailySeries(days: { date: string; clicks: number; impressions: number }[], preliminaryFrom: string | null): SearchDay[] {
  const byDay = new Map<string, { clicks: number; impressions: number }>()
  for (const d of days) {
    const had = byDay.get(d.date)
    byDay.set(d.date, { clicks: (had?.clicks ?? 0) + d.clicks, impressions: (had?.impressions ?? 0) + d.impressions })
  }
  const final = (day: string) => preliminaryFrom === null || day < preliminaryFrom
  const sorted = [...byDay.keys()].sort()
  while (sorted.length) {
    const last = sorted[sorted.length - 1]
    const n = byDay.get(last)!
    if (final(last) || n.clicks > 0 || n.impressions > 0) break
    sorted.pop()
  }
  if (!sorted.length) return []
  const out: SearchDay[] = []
  for (let day = sorted[0]; day <= sorted[sorted.length - 1]; day = addDays(day, 1)) {
    const n = byDay.get(day) ?? { clicks: 0, impressions: 0 }
    out.push({ date: day, clicks: n.clicks, impressions: n.impressions, final: final(day) })
  }
  return out
}

/* ── rows ───────────────────────────────────────────────────────────────────────────── */

const ctrOf = (clicks: number, impressions: number) => (impressions > 0 ? clicks / impressions : null)

/** The average of `position` weighted by impressions, over the rows that have one. One such row
 *  is passed through as it is (no float noise from multiplying and dividing back). */
function weightedPosition(rows: { impressions: number; position: number | null }[]): number | null {
  const ranked = rows.filter((r): r is { impressions: number; position: number } => r.position !== null && r.impressions > 0)
  if (ranked.length === 1) return ranked[0].position
  const seen = ranked.reduce((n, r) => n + r.impressions, 0)
  return seen > 0 ? ranked.reduce((n, r) => n + r.position * r.impressions, 0) / seen : null
}

type Raw = { key: string; clicks: number; impressions: number; position: number | null }

/** Rows merged by key (summed, position weighted), busiest first, the top `limit`. */
function topRows(rows: Raw[], limit: number): SearchRow[] {
  const byKey = new Map<string, Raw[]>()
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r])
  const merged = [...byKey].map(([key, rs]) => {
    const clicks = rs.reduce((n, r) => n + r.clicks, 0)
    const impressions = rs.reduce((n, r) => n + r.impressions, 0)
    return { key, clicks, impressions, ctr: ctrOf(clicks, impressions), position: weightedPosition(rs) }
  })
  merged.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return merged.slice(0, limit)
}

/** A search as text: no control characters, trimmed, at most 200. */
function searchText(v: string): string | null {
  const t = v.replace(/\p{Cc}/gu, '').trim().slice(0, 200)
  return t || null
}

/** Rows whose key passes `clean`, renamed to the clean key. */
function cleanRows<T extends { clicks: number; impressions: number; position: number | null }>(rows: T[], keyOf: (r: T) => string | null, clean: (v: string) => string | null): Raw[] {
  const out: Raw[] = []
  for (const r of rows) {
    const raw = keyOf(r)
    const key = raw === null ? null : clean(raw)
    if (key !== null) out.push({ key, clicks: r.clicks, impressions: r.impressions, position: r.position })
  }
  return out
}

const sumOf = (rows: { clicks: number; impressions: number }[]) => rows.reduce((n, r) => ({ clicks: n.clicks + r.clicks, impressions: n.impressions + r.impressions }), { clicks: 0, impressions: 0 })

function unlistedOf(totals: SearchTotals, queries: SearchRow[]) {
  const shown = sumOf(queries)
  return { clicks: Math.max(0, totals.clicks - shown.clicks), impressions: Math.max(0, totals.impressions - shown.impressions) }
}

const coverageOf = (series: SearchDay[]) => (series.length ? { from: series[0].date, to: series[series.length - 1].date } : null)

/* ── couldn't ask ───────────────────────────────────────────────────────────────────── */

export function couldntAsk(engine: SearchEngineId, period: SearchPeriod, state: CouldntAsk): EngineStats {
  return { engine, state, period }
}

type Failure = { ok: false; reason: string; status?: number; code?: number; detail?: string }

/** A refusal's state: the engine's quota (Google 429, or 403 saying quota / rate limit; Bing 429
 *  or ErrorCode 4 ThrottleUser / 5 ThrottleHost) means "later"; anything else is an error. */
const isQuota = (f: Failure) => f.status === 429 || f.code === 4 || f.code === 5 || (f.status === 403 && /quota|rate ?limit/i.test(f.detail ?? ''))

/** The engine's state when any of its answers failed (a quota refusal anywhere wins), or null. */
function failed(engine: SearchEngineId, period: SearchPeriod, answers: { ok: boolean }[]): EngineStats | null {
  const fails = answers.filter((a): a is Failure => !a.ok)
  if (!fails.length) return null
  const f = fails.find(isQuota) ?? fails[0]
  return { engine, state: isQuota(f) ? 'quota' : 'error', period, reason: f.reason, ...(f.status === undefined ? {} : { status: f.status }) }
}

/** Search-by-day rows, cleaned: in the period, a real search, seen, and ranked; oldest first. */
function searchDayRows(rows: { key: string | null; date: string | null; impressions: number; position: number | null }[], period: SearchPeriod): SearchDayRow[] {
  const out: SearchDayRow[] = []
  for (const r of rows) {
    const key = r.key === null ? null : searchText(r.key)
    if (key === null || !inPeriod(period, r.date) || r.position === null || r.impressions <= 0) continue
    out.push({ key, date: r.date!, impressions: r.impressions, position: r.position })
  }
  return out.sort((a, b) => (a.date === b.date ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.date < b.date ? -1 : 1))
}

/* ── Google ─────────────────────────────────────────────────────────────────────────── */

/** What Tapir asks Google for one period, in order. `total` first: the asker sends it alone and
 *  asks the rest only if Google answered it (one refusal costs one request, not four).
 *  `searchDay` is every search on every day ([query, date]): the spot line's source. */
export const GOOGLE_PARTS = ['total', 'date', 'query', 'searchDay'] as const
export type GooglePart = (typeof GOOGLE_PARTS)[number]
export type GoogleAnswers = Record<GooglePart, GoogleResult<GoogleSearchAnswer>>
/** The parts Google's answer can stand without: the search-by-day rows only feed the ranking
 *  line, and they are the heaviest request (review, 2026-10-06: one refusal there used to throw
 *  away every number). */
export const GOOGLE_OPTIONAL_PARTS: readonly GooglePart[] = ['searchDay']

const ROW_LIMIT: Record<GooglePart, number> = { total: 1, date: 1000, query: TOP, searchDay: 25000 }
const DIMENSIONS: Record<GooglePart, GoogleSearchRequest['dimensions']> = {
  total: undefined, date: ['date'], query: ['query'], searchDay: ['query', 'date'],
}

/** Each part's request for the period: fresh (preliminary) days included, as Search Console shows. */
export function googleRequests(p: SearchPeriod): Record<GooglePart, GoogleSearchRequest> {
  const req = (part: GooglePart): GoogleSearchRequest => ({ startDate: p.start, endDate: p.end, ...(DIMENSIONS[part] ? { dimensions: DIMENSIONS[part] } : {}), rowLimit: ROW_LIMIT[part], dataState: 'all' })
  return Object.fromEntries(GOOGLE_PARTS.map((part) => [part, req(part)])) as Record<GooglePart, GoogleSearchRequest>
}

const firstKey = (r: GoogleSearchRow) => r.keys[0] ?? null

export function normaliseGoogle(period: SearchPeriod, a: GoogleAnswers): EngineStats {
  const fail = failed('google', period, GOOGLE_PARTS.filter((part) => !GOOGLE_OPTIONAL_PARTS.includes(part)).map((part) => a[part]))
  if (fail) return fail
  const rows = (part: GooglePart) => (a[part] as { ok: true; value: GoogleSearchAnswer }).value.rows
  const total = rows('total')[0]
  const totals: SearchTotals = total
    ? { clicks: total.clicks, impressions: total.impressions, ctr: ctrOf(total.clicks, total.impressions), position: total.impressions > 0 ? total.position : null }
    : { clicks: 0, impressions: 0, ctr: null, position: null }
  if (totals.clicks === 0 && totals.impressions === 0) return { engine: 'google', state: 'no_data', period }

  const preliminaryFrom = (a.date as { ok: true; value: GoogleSearchAnswer }).value.firstIncompleteDate
  const days = rows('date').flatMap((r) => (inPeriod(period, firstKey(r)) ? [{ date: r.keys[0], clicks: r.clicks, impressions: r.impressions }] : []))
  const series = dailySeries(days, preliminaryFrom)
  const queries = topRows(cleanRows(rows('query'), firstKey, searchText), TOP)
  return {
    engine: 'google',
    state: 'ok',
    stats: {
      engine: 'google',
      period,
      totals,
      series,
      queries,
      searchDays: a.searchDay.ok ? searchDayRows(rows('searchDay').map((r) => ({ key: r.keys[0] ?? null, date: r.keys[1] ?? null, impressions: r.impressions, position: r.position })), period) : [],
      ...(a.searchDay.ok ? {} : { incomplete: true as const }),
      unlisted: unlistedOf(totals, queries),
      coverage: coverageOf(series),
      preliminaryFrom,
    },
  }
}

/* ── Bing ───────────────────────────────────────────────────────────────────────────── */

export type BingAnswers = { traffic: BingResult<BingDay[]>; queries: BingResult<BingTopRow[]> }

/**
 * Bing sends every day it has (traffic) and its top searches a row per WEEK; the period
 * picks the days and the weekly rows dated inside it (an undated row can't be placed: left out).
 * Totals are the days' sums; position comes from the searches only (Bing gives no total rank).
 */
export function normaliseBing(period: SearchPeriod, a: BingAnswers): EngineStats {
  const fail = failed('bing', period, [a.traffic, a.queries])
  if (fail) return fail
  const ok = <T>(r: BingResult<T[]>) => (r as { ok: true; value: T[] }).value
  const series = dailySeries(
    ok(a.traffic).filter((d) => inPeriod(period, d.date)),
    null,
  )
  const queryRows = ok(a.queries).filter((r) => inPeriod(period, r.date))
  const queries = topRows(cleanRows(queryRows, (r) => r.key, searchText), TOP)
  const sums = sumOf(series)
  if (sums.clicks === 0 && sums.impressions === 0 && !queries.length) return { engine: 'bing', state: 'no_data', period }
  const totals: SearchTotals = { ...sums, ctr: ctrOf(sums.clicks, sums.impressions), position: weightedPosition(queryRows) }
  return {
    engine: 'bing',
    state: 'ok',
    stats: { engine: 'bing', period, totals, series, queries, searchDays: searchDayRows(queryRows, period), unlisted: unlistedOf(totals, queries), coverage: coverageOf(series), preliminaryFrom: null },
  }
}
