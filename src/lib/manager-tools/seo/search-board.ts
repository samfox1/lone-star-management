import { dayDelta } from '@/lib/chart'
import { ENGINE_NAME, alignDays, enginesOf, type EngineView } from './search-model'
import { nameSpot } from './search-spot'
import type { SearchEngineId, SearchStats } from './search-stats'

/**
 * What the Search page draws (mock r12, Sam 2026-10-06), as data: the days along the bottom,
 * the lines over them, and the first day still being counted (dotted from there). Pure, so the
 * page only lays it out (search/search-tab.tsx).
 *
 * Beside both engines, each is its own line, never added together (Sam, 2026-10-02 and again
 * 2026-10-06: "both side by side"): the engine is the colour (Google ink, Bing grey), and on the
 * seen / clicks chart the clicks are the heavier lines. Alone (or "Both" with one engine
 * answered), an engine's seen is ink and its clicks grey.
 */
export type Tone = 'ink' | 'grey'
export type BoardLine = { key: string; engine: SearchEngineId; metric?: 'seen' | 'clicks'; label: string; values: (number | null)[]; tone: Tone; thick?: boolean }
export type Board = { days: string[]; lines: BoardLine[]; partialFrom: number | undefined }

const TONE: Record<SearchEngineId, Tone> = { google: 'ink', bing: 'grey' }

/** The first day index still being counted by any of the engines drawn (Google's preliminary
 *  days; Bing has none), or undefined. */
function firstPartial(days: string[], drawn: SearchStats[]): number | undefined {
  const from = drawn.map((s) => s.preliminaryFrom).filter((d): d is string => d !== null).sort()[0]
  const i = from === undefined ? -1 : days.findIndex((d) => d >= from)
  return i === -1 ? undefined : i
}

/** "Your spot on Google": each engine's spot when someone searches the artist's name
 *  (search-spot.ts `nameSpot`), on one row of days; null where an engine has no reading. */
export function spotBoard(view: EngineView, stats: Partial<Record<SearchEngineId, SearchStats>>, name: string): Board {
  const per = enginesOf(view)
    .filter((e) => stats[e])
    .map((e) => ({ e, points: new Map(nameSpot(stats[e]!.searchDays, name).map((p) => [p.date, p.spot])) }))
    .filter((x) => x.points.size > 0)
  // Side by side only when both have a line: one engine alone reads as that engine.
  const both = per.length > 1
  const days = [...new Set(per.flatMap((x) => [...x.points.keys()]))].sort()
  const lines = per.map(({ e, points }): BoardLine => ({
    key: `${e}-spot`, engine: e, label: both ? ENGINE_NAME[e] : `Your spot on ${ENGINE_NAME[e]}`,
    values: days.map((d) => points.get(d) ?? null), tone: both ? TONE[e] : 'ink',
  }))
  return { days, lines, partialFrom: firstPartial(days, per.map((x) => stats[x.e]!)) }
}

/** Seen in search and clicked, by day: each engine over its own days (search-model.ts `alignDays`). */
export function reachBoard(view: EngineView, stats: Partial<Record<SearchEngineId, SearchStats>>): Board {
  const engines = enginesOf(view).filter((e) => stats[e])
  const both = engines.length > 1
  const pairs = alignDays(Object.fromEntries(engines.map((e) => [e, stats[e]!.series])))
  const lines: BoardLine[] = []
  for (const metric of ['seen', 'clicks'] as const) {
    for (const e of engines) {
      const field = metric === 'seen' ? 'impressions' : 'clicks'
      lines.push({
        key: `${e}-${metric}`, engine: e, metric,
        label: both ? `${ENGINE_NAME[e]} ${metric}` : metric === 'seen' ? `Seen in ${ENGINE_NAME[e]}` : `Clicks from ${ENGINE_NAME[e]}`,
        values: pairs.map((p) => p[e]?.[field] ?? null),
        tone: both ? TONE[e] : metric === 'seen' ? 'ink' : 'grey',
        ...(both && metric === 'clicks' ? { thick: true } : {}),
      })
    }
  }
  const days = pairs.map((p) => p.date)
  const partial = pairs.findIndex((p) => engines.some((e) => p[e] && !p[e]!.final))
  return { days, lines, partialFrom: partial === -1 ? undefined : partial }
}

const WEEK = 7

/** The last week of readings against the first, as a fraction (+1 = doubled). Needs two whole
 *  weeks of readings (a null is no reading); null too when the first week was nothing. */
export function weekGrowth(values: readonly (number | null)[]): number | null {
  const readings = values.filter((v): v is number => v !== null)
  if (readings.length < 2 * WEEK) return null
  const sum = (xs: number[]) => xs.reduce((n, v) => n + v, 0)
  return dayDelta(sum(readings.slice(0, WEEK)), sum(readings.slice(-WEEK)))
}
