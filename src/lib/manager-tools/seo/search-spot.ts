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
 * The numbers beside the line, each weighted by how often the site was seen, and BY THE CALENDAR
 * (the review, 2026-10-06: counting readings broke on Bing's weekly rows and on quiet artists):
 *   now      the readings in the last seven days of the line (one day alone swings: today, half
 *            counted, can be a single search at #4 — Skeen on 2026-10-06; Bing: its latest week);
 *   average  every reading;
 *   climbed  the first seven days against the last seven, in places gained (positive: higher),
 *            only once the line spans two whole weeks (Sam: "if the data hasnt been collected
 *            long enough to see this, then remove it").
 */
export type SpotFacts = { now: number; average: number; climbed: number | null; since: string }

const DAY_MS = 86_400_000
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
const weighted = (ps: readonly SpotPoint[]) => ps.reduce((n, p) => n + p.spot * p.seen, 0) / ps.reduce((n, p) => n + p.seen, 0)

export function spotFacts(points: readonly SpotPoint[]): SpotFacts | null {
  if (!points.length) return null
  const first = dayMs(points[0].date), last = dayMs(points[points.length - 1].date)
  const now = weighted(points.filter((p) => dayMs(p.date) > last - 7 * DAY_MS))
  const firstWeek = points.filter((p) => dayMs(p.date) < first + 7 * DAY_MS)
  return {
    now,
    average: weighted(points),
    climbed: last - first >= 13 * DAY_MS ? weighted(firstWeek) - now : null,
    since: points[0].date,
  }
}

/** One search's spot, oldest day first: its little trend line in the list. */
export function searchTrend(rows: readonly SearchDayRow[], key: string): number[] {
  return rows.filter((r) => r.key === key).sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => r.position)
}

/** One search the line is made of, over the period: how often the site was seen for it and its
 *  spot (weighted by the days it was seen). */
export type NameSearch = { key: string; seen: number; spot: number }

/** The searches the "your spot" line is built from, listed under the chart so nobody has to take
 *  the number on trust (Sam, 2026-10-06: "some way to be more transparent about what we are
 *  showing"): every search naming the artist, most seen first, ties by the words. */
export function nameSearches(rows: readonly SearchDayRow[], name: string): NameSearch[] {
  const by = new Map<string, { seen: number; weighted: number }>()
  for (const r of rows) {
    if (!namesArtist(r.key, name)) continue
    const s = by.get(r.key) ?? { seen: 0, weighted: 0 }
    by.set(r.key, { seen: s.seen + r.impressions, weighted: s.weighted + r.position * r.impressions })
  }
  return [...by]
    .map(([key, s]) => ({ key, seen: s.seen, spot: s.weighted / s.seen }))
    .sort((a, b) => b.seen - a.seen || a.key.localeCompare(b.key))
}

/** Whether a search is the name on its own ("Skeen", not "skeen dj"): the hardest one to win, and
 *  the page says plainly when it isn't among the searches. */
export function isBareName(search: string, name: string): boolean {
  const n = words(name)
  return n !== '' && words(search) === n
}
