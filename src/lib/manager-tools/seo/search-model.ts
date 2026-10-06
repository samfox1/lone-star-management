import { dayLabel } from '@/lib/chart'
import {
  pacificDay,
  type CouldntAsk,
  type EngineStats,
  type SearchDay,
  type SearchEngineId,
  type SearchPeriodKey,
  type SearchRow,
} from './search-stats'

/**
 * THE SEARCH TAB'S WORDS AND SHAPES. PURE: search-stats.ts's normalised answer in, what the
 * artist reads out. The page (tools/seo/search/search-tab.tsx) draws these and decides nothing;
 * the lines themselves are search-board.ts and search-spot.ts.
 *
 * Kept from the first Search tab (Sam, 2026-10-02) through the r12 rebuild (2026-10-06):
 *   • "Both" shows Google and Bing SIDE BY SIDE, never added together: each engine its own line
 *     on ONE date axis (`alignDays`), and the searches list with an engine column
 *     (`sideBySideRows`).
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

/** The page's one title (Sam, 2026-10-06: "Have How Skeen shows up on google all caps"; the
 *  capitals are the style's): which engine, or both. */
export function searchTitle(view: EngineView, name: string): string {
  return `How ${name} shows up ${view === 'both' ? 'in search' : `on ${ENGINE_NAME[view]}`}`
}

/** What the ranking chart under the title shows (Sam, 2026-10-06: "add a little more explanation
 *  about whats going on in these charts"). */
export function searchIntro(view: EngineView, name: string): string {
  const where = view === 'both' ? 'Google and Bing' : ENGINE_NAME[view]
  return `Where your site shows up when someone searches “${name}” on ${where}, day by day. #1 is the top result, so the higher the line, the better.`
}

/** The seen and clicked chart's own header and sentence (Sam, 2026-10-06: "Have a header and
 *  description for the chart below"). */
export function reachTitle(view: EngineView): string {
  return `Seen and clicked ${view === 'both' ? 'in search' : `on ${ENGINE_NAME[view]}`}`
}
export function reachIntro(view: EngineView): string {
  const where = view === 'both' ? 'Google and Bing' : ENGINE_NAME[view]
  return `Seen is how many times ${where} showed your site in its results. Clicks are how many times someone clicked through to it. Dotted days are still being counted.`
}


/** The period's words, for "None in these 28 days". A Record over the periods, so a new one is a
 *  compile error here. */
const PERIOD_WORDS: Readonly<Record<SearchPeriodKey, string>> = { '28d': '28 days', '3m': '3 months' }

/* ── the numbers ────────────────────────────────────────────────────────────────────── */

/** A count with its thousands: 1,200. */
export function countWords(n: number): string {
  return n.toLocaleString('en-US')
}

/** What the average spot means, under it. */
export const SPOT_HINT = '1 = top result'

/** The average spot: one decimal, a whole number without ".0" (2.5, 1, 12). None: "—". */
export function spotWords(position: number | null): string {
  if (position === null || !Number.isFinite(position)) return '—'
  const tenths = Math.round(position * 10)
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)
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

/** How many rows a list shows before "+ N more". */
export const LIST_SHOWN = { query: 10 } as const
