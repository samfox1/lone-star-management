/** Compact number for dashboard figures: 942, 1.2K, 3.4M. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/**
 * Fractional change of a series' second half vs its first half (0.042 = +4.2%).
 * null when there's no baseline to compare against (no data yet).
 */
export function seriesTrend(series: number[]): number | null {
  if (series.length < 2) return null
  const h = Math.floor(series.length / 2)
  const prev = series.slice(0, h).reduce((a, b) => a + b, 0)
  const recent = series.slice(h).reduce((a, b) => a + b, 0)
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
