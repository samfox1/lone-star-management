/**
 * How the Analytics side panels' tables sort (Every day, Every source, Every country):
 * pure, so the rule is pinned without a DOM (components/ui/detail-table.tsx draws them).
 */
export type SortDir = 'asc' | 'desc'
/** What a column sorts by. `null` is "nothing here": a day before a metric was counted. */
export type SortValue = number | string | null

/**
 * The rows, sorted by one column. Numbers as numbers (20 above 5), words alphabetically
 * ignoring case (a `2026-09-12` day sorts by date this way too). A row with nothing to sort
 * by goes LAST whichever way, so flipping a column never fills its top with blanks. Ties
 * keep the order they came in. The input is not touched.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  // Array.prototype.sort is stable (ES2019), so a tie — a comparison of 0 — keeps its order.
  return rows
    .map((row) => ({ row, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? 0 : a.v === null ? 1 : -1
      const by = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base' })
      return sign * by
    })
    .map((x) => x.row)
}

/** How a column sorts the first time it is picked: biggest first for numbers, A to Z for words. */
export function firstDir(sample: SortValue): SortDir {
  return typeof sample === 'string' ? 'asc' : 'desc'
}

/** A part of a whole as a percent with one decimal; a dash when there is no whole. */
export function shareLabel(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}
