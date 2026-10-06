/**
 * The decisions a chart makes before it draws anything, kept out of the
 * component so they can be pinned without a DOM. The axis here is a COUNT
 * axis — views, visitors, plays — so a gridline is always a whole number.
 */

/**
 * A "round" gridline step for a range: 1, 2 or 5 times a power of ten, the
 * smallest that keeps the axis to about `lines` gridlines, and never below 1.
 *
 *   136 / 4 = 34 → 50      61 / 4 = 15 → 20      7 / 4 = 1.75 → 2      217 / 4 = 54 → 50
 *   2 / 4 = 0.5 → 1 (a count axis draws 1, 2 — never 0.5, 1, 1.5, 2)
 */
function niceStep(max: number, lines = 4): number {
  if (!(max > 0)) return 1
  const raw = max / lines
  const base = 10 ** Math.floor(Math.log10(raw))
  const m = raw / base
  // Round to the NEAREST nice mantissa, not the next one up: 5.4 is a 5, not a
  // 10. Snapping up sent 217 to a step of 100 and a top of 300.
  const mantissa = m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10
  return Math.max(1, mantissa * base)
}

/**
 * The top of a y axis: the first multiple of the nice step at or above `max`.
 *
 *   136 → 150     61 → 80     7 → 8     217 → 250     1,111 → 1,200
 *
 * Never below `max` (a peak must not clip) and never below 1 (an all-zero day
 * still needs a floor to sit on). An earlier version rounded `max` itself to a
 * 1 / 2 / 5 leading digit, which sent 217 to 500 and left the chart drawing in
 * the bottom two fifths of its own box.
 */
export function niceCeil(max: number, lines = 4): number {
  if (!(max > 0)) return 1
  const step = niceStep(max, lines)
  return Math.ceil(max / step) * step
}

/** The gridline values for an axis built by `niceCeil`: every step up to the top. */
export function axisTicks(max: number, lines = 4): number[] {
  const top = niceCeil(max, lines)
  const step = niceStep(max, lines)
  return Array.from({ length: Math.round(top / step) }, (_, i) => (i + 1) * step)
}

/**
 * The change from one value to another, as a fraction of the first — a day
 * against yesterday, a day against the window's average, this window against
 * the last.
 *
 * `null` when there is nothing to compare against — no previous value, or a
 * previous value of zero, where any percentage would be infinite and a reader
 * would learn nothing from it. The caller prints the raw numbers in that case
 * rather than inventing one.
 */
export function dayDelta(prev: number | undefined, cur: number): number | null {
  if (prev === undefined || prev === 0) return null
  return (cur - prev) / prev
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-12` → `Sep 12`. Parsed by hand: `new Date('2026-09-12')` is UTC
 *  midnight, which renders as the day BEFORE anywhere west of Greenwich. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}

/** A point on the drawing, in the drawing's own units: [x, y]. */
export type Pt = readonly [number, number]

/**
 * A smooth line through every point that never overshoots: Fritsch–Carlson monotone
 * cubic interpolation (what d3 calls curveMonotoneX). Between two days the curve stays
 * within their two values, so a quiet day after a busy one never dips below the floor,
 * a flat run stays flat and a peak is never drawn higher than it was — a plain spline
 * would invent all three. The x values must increase.
 *
 * One cubic Bézier per gap, `C c1x,c1y c2x,c2y x,y`, so a caller can draw some gaps
 * solid and the last one dotted (today, still being counted). Fewer than two points is
 * no line.
 */
export function monotoneSegments(pts: readonly Pt[]): string[] {
  const n = pts.length
  if (n < 2) return []
  const h: number[] = []
  const s: number[] = [] // each gap's straight-line slope
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1][0] - pts[i][0])
    s.push(h[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h[i])
  }
  // A point's slope: the mean of its two gaps, or level where the line turns.
  const m: number[] = pts.map((_, i) => (i === 0 ? s[0] : i === n - 1 ? s[n - 2] : s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2))
  // Fritsch–Carlson: the two end slopes of a gap are scaled down until the curve cannot
  // overshoot. A flat gap needs nothing: both its ends are already level (each is a turn,
  // or a line end taking the flat gap's own slope).
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) continue
    const a = m[i] / s[i], b = m[i + 1] / s[i], t = a * a + b * b
    if (t > 9) { const k = 3 / Math.sqrt(t); m[i] = k * a * s[i]; m[i + 1] = k * b * s[i] }
  }
  const f = (v: number) => v.toFixed(1)
  return h.map((gap, i) => {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], third = gap / 3
    return `C${f(x0 + third)},${f(y0 + m[i] * third)} ${f(x1 - third)},${f(y1 - m[i + 1] * third)} ${f(x1)},${f(y1)}`
  })
}

/** The whole smooth line as an SVG path: a move to the first point, then every gap. */
export function smoothPath(pts: readonly Pt[]): string {
  if (!pts.length) return ''
  const start = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  return [start, ...monotoneSegments(pts)].join(' ')
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `2026-09-07` → `Mon, Sep 7`: the day of the week too, for a table of days. Worked out in
 *  UTC from the string, like `dayLabel`, so it is never the day before. */
export function weekdayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dayLabel(day)}`
}

/** The bottom of a spot axis (#1 at the top): the whole spot below the lowest one held, with a
 *  quarter of a place to spare, and never above #3, so a site at #1 still has room to fall. */
export function rankFloor(spots: readonly number[]): number {
  return Math.max(3, Math.ceil(Math.max(1, ...spots) + 0.25))
}

/** The spots a spot axis names, from #1 down to its floor: every one up to six, then every
 *  second, then every fifth (plus #1, the one that matters). */
export function rankTicks(floor: number): number[] {
  const step = floor <= 6 ? 1 : floor <= 12 ? 2 : 5
  const ticks = [1]
  for (let t = step; t <= floor; t += step) if (t > 1) ticks.push(t)
  return ticks
}
