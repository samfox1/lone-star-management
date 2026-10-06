import type { SearchDayRow } from './search-stats'

/**
 * "Your spot on Google": where the artist's site sits when someone searches their NAME, day by
 * day (the r12 mock's climbing line, Sam 2026-10-06). From every search's spot per day
 * (`SearchStats.searchDays`, Google's [query, date] rows; Bing's weekly rows).
 *
 * The name, not every search: a site that starts being seen for more searches ("chicago house
 * dj" at #30) pulls the overall average DOWN while it is doing better. The name searches are the
 * ones the artist should own, so they are the line that proves the work is working.
 */

/** A name or a search as words: lower case, accents off, anything but letters and digits a space. */
function words(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Whether a search names the artist: the name's words, whole and in order, anywhere in it
 *  ("dj skeen" names Skeen; "skeena river" does not). A name with no words names nothing. */
export function namesArtist(search: string, name: string): boolean {
  const n = words(name)
  return n !== '' && ` ${words(search)} `.includes(` ${n} `)
}

/** One day on the line: the spot (1 is the top result) and how often the site was seen. */
export type SpotPoint = { date: string; spot: number; seen: number }

/** The spot per day over every search that names the artist, weighted by how often each was
 *  seen that day. Oldest day first. */
export function nameSpot(rows: readonly SearchDayRow[], name: string): SpotPoint[] {
  const days = new Map<string, { seen: number; weighted: number }>()
  for (const r of rows) {
    if (!namesArtist(r.key, name)) continue
    const d = days.get(r.date) ?? { seen: 0, weighted: 0 }
    days.set(r.date, { seen: d.seen + r.impressions, weighted: d.weighted + r.position * r.impressions })
  }
  return [...days]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, spot: d.weighted / d.seen, seen: d.seen }))
}

/**
 * The numbers beside the line, each weighted by how often the site was seen that day:
 *   now      the last week of readings (one day alone swings: today, half counted, can be a
 *            single search at #4 — Skeen on 2026-10-06);
 *   average  every day;
 *   climbed  the first week against the last, in places gained (positive: higher), only once
 *            there are two whole weeks to compare (Sam: "if the data hasnt been collected long
 *            enough to see this, then remove it").
 */
export type SpotFacts = { now: number; average: number; climbed: number | null; since: string }

const WEEK = 7
const weighted = (ps: readonly SpotPoint[]) => ps.reduce((n, p) => n + p.spot * p.seen, 0) / ps.reduce((n, p) => n + p.seen, 0)

export function spotFacts(points: readonly SpotPoint[]): SpotFacts | null {
  if (!points.length) return null
  const now = weighted(points.slice(-WEEK))
  return {
    now,
    average: weighted(points),
    climbed: points.length >= 2 * WEEK ? weighted(points.slice(0, WEEK)) - now : null,
    since: points[0].date,
  }
}

/** One search's spot, oldest day first: its little trend line in the list. */
export function searchTrend(rows: readonly SearchDayRow[], key: string): number[] {
  return rows.filter((r) => r.key === key).sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => r.position)
}
