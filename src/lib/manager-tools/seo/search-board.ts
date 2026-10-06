import { dayDelta } from '@/lib/chart'
import { ENGINE_NAME, alignDays, enginesOf, type EngineView } from './search-model'
import { nameSpot } from './search-spot'
import type { EngineStats, SearchEngineId, SearchPeriod, SearchStats } from './search-stats'

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
export type BoardLine = {
  key: string
  engine: SearchEngineId
  metric?: 'seen' | 'clicks'
  label: string
  values: (number | null)[]
  /** Seen / clicked lines: whether each day is finished (Google still counts its last ~2). */
  final?: boolean[]
  /** The first day index THIS line is still being counted, from which it is dotted (Google's;
   *  Bing's lines never are: review, 2026-10-06). */
  partialFrom?: number
  tone: Tone
  thick?: boolean
}
export type Board = { days: string[]; lines: BoardLine[] }

const TONE: Record<SearchEngineId, Tone> = { google: 'ink', bing: 'grey' }

/** The first day index at or after an engine's first preliminary day, if it has one in view. */
function partialOf(days: string[], preliminaryFrom: string | null): { partialFrom?: number } {
  const i = preliminaryFrom === null ? -1 : days.findIndex((d) => d >= preliminaryFrom)
  return i === -1 ? {} : { partialFrom: i }
}

/** Every day from `from` to `to`, both included. */
function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** The ranking: each engine's spot when someone searches the artist's name
 *  (search-spot.ts `nameSpot`), on EVERY day from the first reading (or `startAt`, the day the
 *  site was added, when earlier) to the last; null where an engine has no reading. Every day, so a
 *  reading sits at its own date and a pin has a day to land on (review, 2026-10-06). */
export function spotBoard(view: EngineView, stats: Partial<Record<SearchEngineId, SearchStats>>, name: string, startAt?: string): Board {
  const per = enginesOf(view)
    .filter((e) => stats[e])
    .map((e) => ({ e, points: new Map(nameSpot(stats[e]!.searchDays, name).map((p) => [p.date, p.spot])) }))
    .filter((x) => x.points.size > 0)
  // Side by side only when both have a line: one engine alone reads as that engine.
  const both = per.length > 1
  const read = [...new Set(per.flatMap((x) => [...x.points.keys()]))].sort()
  if (!read.length) return { days: [], lines: [] }
  const first = startAt && startAt < read[0] ? startAt : read[0]
  const days = dayRange(first, read[read.length - 1])
  const lines = per.map(({ e, points }): BoardLine => ({
    // "Google ranking" (Sam, 2026-10-06), one engine or both.
    key: `${e}-spot`, engine: e, label: `${ENGINE_NAME[e]} ranking`,
    values: days.map((d) => points.get(d) ?? null), tone: both ? TONE[e] : 'ink',
    ...partialOf(days, stats[e]!.preliminaryFrom),
  }))
  return { days, lines }
}

/**
 * Seen in search and clicked, by day, for the engines SWITCHED ON (the chart's own Google / Bing
 * toggles, Sam 2026-10-06), each over its own days (search-model.ts `alignDays`). An engine
 * switched on with nothing yet (a new site, `no_data`) is a line at zero across the board's days,
 * or across the whole period when no engine has any ("If data isnt available yet for it, it can
 * just stay at 0"); one Tapir couldn't ask draws nothing: a zero there would be a guess.
 */
export function reachBoard(on: readonly SearchEngineId[], answers: Partial<Record<SearchEngineId, EngineStats>>): Board {
  const order = (['google', 'bing'] as const).filter((e) => on.includes(e))
  const withData = order.filter((e) => answers[e]?.state === 'ok')
  const zero = order.filter((e) => answers[e]?.state === 'no_data')
  const drawn = order.filter((e) => withData.includes(e) || zero.includes(e))
  const series = (e: SearchEngineId) => (answers[e] as { state: 'ok'; stats: SearchStats }).stats.series
  const pairs = alignDays(Object.fromEntries(withData.map((e) => [e, series(e)])))
  const days = pairs.length ? pairs.map((p) => p.date) : zero.length ? periodDays((answers[zero[0]] as { period: SearchPeriod }).period) : []
  const both = drawn.length > 1
  const lines: BoardLine[] = []
  for (const metric of ['seen', 'clicks'] as const) {
    for (const e of drawn) {
      const field = metric === 'seen' ? 'impressions' : 'clicks'
      lines.push({
        key: `${e}-${metric}`, engine: e, metric,
        label: both ? `${ENGINE_NAME[e]} ${metric}` : metric === 'seen' ? `Seen in ${ENGINE_NAME[e]}` : `Clicks from ${ENGINE_NAME[e]}`,
        values: zero.includes(e) ? days.map(() => 0) : pairs.map((p) => p[e]?.[field] ?? null),
        final: zero.includes(e) ? days.map(() => true) : pairs.map((p) => p[e]?.final ?? true),
        ...(zero.includes(e) ? {} : partialOfFinal(pairs.map((p) => p[e]?.final ?? true))),
        tone: both ? TONE[e] : metric === 'seen' ? 'ink' : 'grey',
        ...(both && metric === 'clicks' ? { thick: true } : {}),
      })
    }
  }
  return { days, lines }
}

/** The first unfinished day of a line, from which it is dotted. */
function partialOfFinal(final: boolean[]): { partialFrom?: number } {
  const i = final.indexOf(false)
  return i === -1 ? {} : { partialFrom: i }
}

/** Every day of a period, first to last. */
function periodDays(p: SearchPeriod): string[] {
  return dayRange(p.start, p.end)
}

/** The numbers beside the seen / clicked chart, per line: the total (every day, the unfinished
 *  ones too: what they hold is real), the average per day and the change, the last week against
 *  the first, over FINISHED days only (the review, 2026-10-06: a flat 100 a day read as ▼16.4%
 *  because Google's last two days were still being counted). */
export type ReachFact = { key: string; total: number; perDay: number; growth: number | null }

export function reachFacts(lines: readonly BoardLine[]): ReachFact[] {
  return lines.map((l) => {
    const sum = (xs: number[]) => xs.reduce((n, v) => n + v, 0)
    const finished = l.values.map((v, i) => (l.final?.[i] === false ? null : v))
    const done = finished.filter((v): v is number => v !== null)
    return {
      key: l.key,
      total: sum(l.values.filter((v): v is number => v !== null)),
      perDay: done.length ? sum(done) / done.length : 0,
      growth: weekGrowth(finished),
    }
  })
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
