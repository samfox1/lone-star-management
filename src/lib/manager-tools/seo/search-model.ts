import { dayLabel } from '@/lib/chart'
import { countryFromA3 } from './country-a3'
import {
  pacificDay,
  type CouldntAsk,
  type EngineStats,
  type SearchDay,
  type SearchEngineId,
  type SearchPeriod,
  type SearchPeriodKey,
  type SearchRow,
  type SearchStats,
} from './search-stats'

/**
 * THE SEARCH TAB'S WORDS AND SHAPES ("How fans find you", Sam 2026-10-02, prototypes/
 * search_tab_20261002.html). PURE: search-stats.ts's normalised answer in, what the artist reads
 * out. The page (tools/seo/search/search-tab.tsx) draws these and decides nothing.
 *
 * Sam's two changes to the mock (2026-10-02):
 *   • "Both" shows Google and Bing SIDE BY SIDE, never added together: each engine's own four
 *     numbers, one daily line per engine on ONE date axis (`alignDays`), and the lists with an
 *     engine column (`sideBySideRows`).
 *   • Bing's empty answer for a new site says it USUALLY takes up to two weeks: no date promised
 *     (`engineNote`).
 *
 * Strict tests: tests/unit/manager-tools/seo/search-model.test.ts.
 */

/* ── the switches ───────────────────────────────────────────────────────────────────── */

/** The engine switch, in its order. `both` is the default (the tab's own address). */
export const ENGINE_VIEWS = ['both', 'google', 'bing'] as const
export type EngineView = (typeof ENGINE_VIEWS)[number]

/** The `?e=` value as a view; anything else (missing, junk, "__proto__") is `both`. */
export function engineViewOf(v: string | null | undefined): EngineView {
  return (ENGINE_VIEWS as readonly string[]).includes(v ?? '') ? (v as EngineView) : 'both'
}

/** The engines a view shows, Google first. */
export function enginesOf(view: EngineView): SearchEngineId[] {
  return view === 'both' ? ['google', 'bing'] : [view]
}

export const ENGINE_NAME: Readonly<Record<SearchEngineId, string>> = { google: 'Google', bing: 'Bing' }

/** The period switch's words. A Record over the periods, so a new one is a compile error here. */
export const PERIOD_WORDS: Readonly<Record<SearchPeriodKey, string>> = { '28d': '28 days', '3m': '3 months' }

/* ── the numbers ────────────────────────────────────────────────────────────────────── */

/** A count with its thousands: 1,200. */
export function countWords(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * The click rate as a whole percent. Never a rounding that says something false: a rate above
 * zero is never "0%" (it is "<1%"), and a rate below one is never "100%" (it is ">99%"). No
 * impressions is "—", never 0%.
 */
export function rateWords(ctr: number | null): string {
  if (ctr === null) return '—'
  if (ctr >= 1) return '100%'
  const pct = Math.round(ctr * 100)
  if (pct === 0 && ctr > 0) return '<1%'
  if (pct === 100) return '>99%'
  return `${pct}%`
}

/**
 * The click rate in plain words under the percent: "1 in 4 clicked". Above one in two, "1 in N"
 * would round a 70% down to "1 in 1": it says "most clicked"; every one is "all clicked". No
 * rate or no clicks: nothing (the percent already says 0% or —).
 */
export function oneInWords(ctr: number | null): string | null {
  if (ctr === null || !(ctr > 0)) return null
  if (ctr >= 1) return 'all clicked'
  if (ctr > 0.5) return 'most clicked'
  return `1 in ${countWords(Math.round(1 / ctr))} clicked`
}

/** What the average spot means, under it. */
export const SPOT_HINT = '1 = top result'

/** The average spot: one decimal, a whole number without ".0" (2.5, 1, 12). None: "—". */
export function spotWords(position: number | null): string {
  if (position === null || !Number.isFinite(position)) return '—'
  const tenths = Math.round(position * 10)
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)
}

/**
 * The searches the list leaves out, said out loud (search-stats.ts `unlisted`): "+ 3 clicks ·
 * 15 seen from rare searches". A side that is zero is left out; nothing left out says nothing.
 */
export function rareWords(unlisted: { clicks: number; impressions: number }): string | null {
  const parts: string[] = []
  if (unlisted.clicks > 0) parts.push(`${countWords(unlisted.clicks)} ${unlisted.clicks === 1 ? 'click' : 'clicks'}`)
  if (unlisted.impressions > 0) parts.push(`${countWords(unlisted.impressions)} seen`)
  return parts.length ? `+ ${parts.join(' · ')} from rare searches` : null
}

/** "Since Sep 29" over the daily line when the numbers start after the period does (a new site). */
export function sinceWords(coverage: { from: string } | null, period: SearchPeriod): string | null {
  return coverage && coverage.from > period.start ? `Since ${dayLabel(coverage.from)}` : null
}

/* ── an engine with no numbers: never a page of zeros ───────────────────────────────── */

/** How long a new site usually waits for its first numbers. Bing: "usually up to 2 weeks" (Sam,
 *  2026-10-02: no exact date promised). Google: its first days show within a few. */
const NEW_SITE = {
  google: { days: 7, words: 'usually within a few days' },
  bing: { days: 14, words: 'usually within 2 weeks' },
} as const satisfies Record<SearchEngineId, { days: number; words: string }>

/** Why Tapir couldn't ask, in a few words, and whether asking again now could help (a refusal,
 *  an error or a timeout is never cached, so the next ask is a real one). A Record over the
 *  states: a new one is a compile error here until it has words. */
const COULDNT: Readonly<Record<CouldntAsk, (engine: SearchEngineId) => { bits: string[]; retry: boolean }>> = {
  quota: (e) => (e === 'bing' ? { bits: ["Bing's daily limit", 'try tomorrow'], retry: false } : { bits: ["Google's limit", 'try later'], retry: false }),
  error: () => ({ bits: ['Something went wrong'], retry: true }),
  timeout: () => ({ bits: ['No answer in time'], retry: true }),
  no_key: () => ({ bits: ['Not set up yet'], retry: false }),
  not_registered: () => ({ bits: ['Site not added yet'], retry: false }),
}

export type EngineNote = {
  /** `none`: the engine answered with nothing; `cant`: it couldn't be asked. */
  kind: 'none' | 'cant'
  title: string
  /** Short pieces, shown with a dot between them. */
  bits: string[]
  /** Offer "Try again". */
  retry: boolean
}

const DAY_MS = 86_400_000

/**
 * What to say for an engine with no numbers, or null when it has some.
 *
 *   no_data, site added within the engine's usual wait   No numbers yet · New site · added Sep 30 ·
 *                                                         usually within 2 weeks
 *   no_data otherwise (or the date unknown)              No numbers · None in these 28 days
 *   couldn't ask                                         Couldn't ask Bing · Bing's daily limit · …
 *
 * `addedAt` is site_verifications.verified_at; "today" is the period's last day (Search Console's
 * Pacific day), so the page says the same thing on the server and in the browser.
 */
export function engineNote(e: EngineStats, addedAt: string | null): EngineNote | null {
  if (e.state === 'ok') return null
  if (e.state === 'no_data') {
    const added = addedAt && Number.isFinite(Date.parse(addedAt)) ? pacificDay(Date.parse(addedAt)) : null
    const age = added === null ? null : (Date.parse(`${e.period.end}T00:00:00Z`) - Date.parse(`${added}T00:00:00Z`)) / DAY_MS
    const wait = NEW_SITE[e.engine]
    if (added !== null && age !== null && age >= 0 && age < wait.days) {
      return { kind: 'none', title: 'No numbers yet', bits: ['New site', `added ${dayLabel(added)}`, wait.words], retry: false }
    }
    return { kind: 'none', title: 'No numbers', bits: [`None in these ${PERIOD_WORDS[e.period.key]}`], retry: false }
  }
  const why = COULDNT[e.state](e.engine)
  return { kind: 'cant', title: `Couldn't ask ${ENGINE_NAME[e.engine]}`, bits: why.bits, retry: why.retry }
}

/** The small dot beside an engine on the switch: amber for no numbers yet, red for couldn't ask. */
export function engineDot(e: EngineStats): { tone: 'pending' | 'red'; label: string } | null {
  if (e.state === 'ok') return null
  return e.state === 'no_data' ? { tone: 'pending', label: 'No numbers yet' } : { tone: 'red', label: "Couldn't ask" }
}

/* ── side by side: one date axis ────────────────────────────────────────────────────── */

export type EngineDay = { clicks: number; impressions: number; final: boolean }
export type DayPair = { date: string; google: EngineDay | null; bing: EngineDay | null }

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

/**
 * Both engines' days on ONE axis, never added together: every day from the first either engine
 * has to the last, and each engine's own numbers on it. An engine is null on a day outside its
 * own run (before its first day or after its last), never a made-up zero, so its line stops there.
 * Inside its run a day it doesn't list is a real zero day (the engines leave those out).
 */
export function alignDays(series: Partial<Record<SearchEngineId, SearchDay[] | null>>): DayPair[] {
  const runs = (['google', 'bing'] as const).map((engine) => {
    const days = [...(series[engine] ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    return { engine, byDay: new Map(days.map((d) => [d.date, d])), from: days[0]?.date ?? null, to: days[days.length - 1]?.date ?? null }
  })
  const froms = runs.flatMap((r) => (r.from ? [r.from] : [])).sort()
  const tos = runs.flatMap((r) => (r.to ? [r.to] : [])).sort()
  if (!froms.length) return []
  const out: DayPair[] = []
  for (let day = froms[0]; day <= tos[tos.length - 1]; day = nextDay(day)) {
    const on = (r: (typeof runs)[number]): EngineDay | null => {
      if (!r.from || !r.to || day < r.from || day > r.to) return null
      const d = r.byDay.get(day)
      return d ? { clicks: d.clicks, impressions: d.impressions, final: d.final } : { clicks: 0, impressions: 0, final: true }
    }
    out.push({ date: day, google: on(runs[0]), bing: on(runs[1]) })
  }
  return out
}

/* ── the daily line ─────────────────────────────────────────────────────────────────── */

export type ChartSeries = {
  key: string
  engine: SearchEngineId
  metric: 'clicks' | 'impressions'
  label: string
  /** One per day of the axis; null where this engine has no day (not drawn). */
  values: (number | null)[]
  /** false: the engine is still counting that day (drawn dashed and lighter). */
  final: boolean[]
  tone: 'accent' | 'ink'
  /** Clicks are the thick line, Seen the thin one. */
  thick: boolean
  /** The soft fill under the line (one engine shown: its clicks, as the Analytics page). */
  fill: boolean
  /** Lighter (Seen, beside both engines). */
  faded: boolean
}

export type Chart = { days: string[]; series: ChartSeries[]; stillCounting: boolean }

/**
 * The daily line for a view. One engine: Clicks in blue over Seen in ink, the Analytics page's
 * colours. Both: each engine in its own colour (Google blue, Bing ink), Clicks thick and Seen
 * thin, on one date axis (`alignDays`). Only engines with numbers are drawn. Seen is listed
 * first so Clicks draws on top.
 */
export function chartOf(view: EngineView, stats: Partial<Record<SearchEngineId, SearchStats>>): Chart {
  const engines = enginesOf(view).filter((e) => stats[e])
  const pairs = alignDays(Object.fromEntries(engines.map((e) => [e, stats[e]!.series])))
  const both = view === 'both'
  const series: ChartSeries[] = []
  for (const metric of ['impressions', 'clicks'] as const) {
    for (const engine of engines) {
      const day = (p: DayPair) => p[engine]
      series.push({
        key: `${engine}-${metric}`,
        engine,
        metric,
        label: metric === 'clicks' ? 'Clicks' : 'Seen',
        values: pairs.map((p) => day(p)?.[metric] ?? null),
        final: pairs.map((p) => day(p)?.final ?? true),
        tone: both ? (engine === 'google' ? 'accent' : 'ink') : metric === 'clicks' ? 'accent' : 'ink',
        thick: metric === 'clicks',
        fill: !both && metric === 'clicks',
        faded: both && metric === 'impressions',
      })
    }
  }
  return { days: pairs.map((p) => p.date), series, stillCounting: series.some((s) => s.values.some((v, i) => v !== null && !s.final[i])) }
}

/* ── the lists ──────────────────────────────────────────────────────────────────────── */

export type EngineRow = SearchRow & { engine: SearchEngineId }

/**
 * One list for both engines, side by side: each engine's own rows (never summed), a search both
 * engines list next to each other, Google first. The pairs go busiest first by either engine's
 * row (clicks, then seen, then the words), so the list reads like each engine's own.
 */
export function sideBySideRows(lists: Partial<Record<SearchEngineId, readonly SearchRow[] | null>>): EngineRow[] {
  const groups = new Map<string, EngineRow[]>()
  for (const engine of ['google', 'bing'] as const) {
    for (const r of lists[engine] ?? []) groups.set(r.key, [...(groups.get(r.key) ?? []), { ...r, engine }])
  }
  const best = (rows: EngineRow[]) => rows.reduce((a, b) => (b.clicks > a.clicks || (b.clicks === a.clicks && b.impressions > a.impressions) ? b : a))
  return [...groups.entries()]
    .sort(([ka, a], [kb, b]) => {
      const x = best(a)
      const y = best(b)
      return y.clicks - x.clicks || y.impressions - x.impressions || (ka < kb ? -1 : ka > kb ? 1 : 0)
    })
    .flatMap(([, rows]) => rows)
}

/** The bar's two lengths, as percents of the list's busiest row: grey for seen, blue for clicks
 *  inside it. Anything above zero shows at least a sliver (2%). */
export function barOf(row: { clicks: number; impressions: number }, maxSeen: number): { seen: number; clicks: number } {
  const max = Math.max(1, maxSeen, row.impressions, row.clicks)
  const pct = (n: number) => (n > 0 ? Math.max(2, (n / max) * 100) : 0)
  return { seen: pct(Math.max(row.impressions, row.clicks)), clicks: pct(row.clicks) }
}

/**
 * A page row's words and link: "Home" for the site's root, else its path ("/music"), with the
 * address under it. The link is re-checked here, at the edge where it is drawn: http(s) with no
 * credentials, or no link at all (search-stats.ts checked it once; this is the second check).
 */
export function pageWords(url: string): { name: string; sub: string; href: string | null } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { name: url, sub: '', href: null }
  }
  const safe = (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  let path = u.pathname
  try {
    path = decodeURI(u.pathname)
  } catch {
    // A malformed escape: show it as it came.
  }
  const name = path === '/' ? 'Home' : path.replace(/\/$/, '')
  return { name, sub: `${u.host.replace(/^www\./, '')}${path}`, href: safe ? u.href : null }
}

/** A country row's name: Google's alpha-3 code as the Analytics page names it. */
export const countryWords = countryFromA3

const DEVICE: Readonly<Record<string, string>> = { mobile: 'Phone', desktop: 'Computer', tablet: 'Tablet' }

/** A device row's name. */
export function deviceWords(key: string): string {
  return DEVICE[key] ?? key
}

/** How many rows a list shows before "+ N more". */
export const LIST_SHOWN = { query: 10, page: 10, country: 8, device: 3 } as const
