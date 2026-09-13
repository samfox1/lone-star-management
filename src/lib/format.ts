/** Compact number for dashboard figures: 942, 1.2K, 3.4M. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/**
 * Fractional change of a series' second half vs its first half (0.042 = +4.2%).
 * null when there's no baseline to compare against (no data yet).
 *
 * THE HALVES MUST BE THE SAME LENGTH, which is the whole reason for the `-h` below.
 * An odd-length series has no exact middle, and the obvious split — `slice(0, h)` against
 * `slice(h)` — puts the extra day in the RECENT half and then compares a 3-day sum with a
 * 4-day sum. Ten views every day for a week read as +33.3%. Nobody saw it while every
 * caller passed 30 days; the analytics window filter added a 7-day option (2026-09-12)
 * and every flat week started climbing.
 *
 * So the middle day of an odd series is dropped: it belongs to neither half, and leaving
 * it out is the only split that reports a flat series as flat.
 */
export function seriesTrend(series: number[]): number | null {
  if (series.length < 2) return null
  const h = Math.floor(series.length / 2)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const prev = sum(series.slice(0, h))
  const recent = sum(series.slice(-h))
  if (prev === 0) return recent > 0 ? 1 : null
  return (recent - prev) / prev
}

export type Trend = { label: string; dir: 'up' | 'down' | 'flat' }

/** Present a fractional trend as a signed percent + direction. null → neutral 0.0%. */
export function formatTrend(t: number | null): Trend {
  if (t === null) return { label: '0.0%', dir: 'flat' }
  const pct = t * 100
  const dir = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat'
  return { label: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, dir }
}

/** Text colour for a trend %: blue up, red down, faint flat. */
export function trendTextClass(dir: Trend['dir']): string {
  return dir === 'up' ? 'text-accent' : dir === 'down' ? 'text-accent-red' : 'text-ink-faint'
}

/** Line colour for a trend sparkline: red only when clearly down, else ink. */
export function trendLineClass(dir: Trend['dir']): string {
  return dir === 'down' ? 'text-accent-red' : 'text-ink'
}
