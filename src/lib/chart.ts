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
export function niceStep(max: number, lines = 4): number {
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
