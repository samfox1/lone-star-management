/**
 * The decisions a chart makes before it draws anything, kept out of the
 * component so they can be pinned without a DOM.
 */

/**
 * A "round" gridline step for a range: 1, 2 or 5 times a power of ten, the
 * smallest that keeps the axis to about `lines` gridlines.
 *
 *   136 / 4 = 34 → 50      61 / 4 = 15 → 20      7 / 4 = 1.75 → 2      217 / 4 = 54 → 50
 */
export function niceStep(max: number, lines = 4): number {
  if (!(max > 0)) return 1
  const raw = max / lines
  const base = 10 ** Math.floor(Math.log10(raw))
  const m = raw / base
  // Round to the NEAREST nice mantissa, not the next one up: 5.4 is a 5, not a
  // 10. Snapping up sent 217 to a step of 100 and a top of 300.
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * base
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
  return Math.ceil(max / step - 1e-9) * step
}

/** The gridline values for an axis built by `niceCeil`: every step up to the top. */
export function axisTicks(max: number, lines = 4): number[] {
  const top = niceCeil(max, lines)
  const step = niceStep(max, lines)
  const n = Math.round(top / step)
  return Array.from({ length: n }, (_, i) => Number(((i + 1) * step).toPrecision(12)))
}

/**
 * The change from one day to the next, for the hover readout.
 *
 * `null` when there is nothing to compare against — the first day, or a
 * previous day of zero, where any percentage would be infinite and a reader
 * would learn nothing from it. The readout prints the raw numbers in that
 * case rather than inventing one.
 */
export function dayDelta(prev: number | undefined, cur: number): number | null {
  if (prev === undefined || prev === 0) return null
  return (cur - prev) / prev
}
