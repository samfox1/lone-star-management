/**
 * Where a NEW row lands in a list (PRESENCE_PLAN.md S2/S3).
 *
 * Sam, 2026-09-10: a tour date should "append in the correct part of the list (fitting
 * around the other dates)"; merch "should just get added to the front/top of the list".
 *
 * Both are pure over what `createContent` already has, and both return null when there
 * is nothing to do — which is the common case: until the manager drags a list, no row
 * carries a sort_order, and the door and the site order by date (tour) or newest-first
 * (merch) on their own. Assigning a number then would flip the list into manual mode
 * behind the manager's back, which is worse than doing nothing.
 */

/** Merch: one before the current first, or null when the list has never been dragged. */
export function frontSortOrder(existing: readonly (number | null)[]): number | null {
  const numbered = existing.filter((n): n is number => n !== null)
  return numbered.length ? Math.min(...numbered) - 1 : null
}

export type DatedRow = { id: string; date: string | null; sort_order: number | null }

/**
 * Tour: the full id order with the new row slotted in, or null when the list has never
 * been dragged. The manager's order is the frame — rows sorted by their sort_order, nulls
 * last — and the new row goes after the LAST row dated on or before its own date. So it
 * lands between its date-neighbours in a chronological list, and still lands somewhere
 * sensible in a list the manager has rearranged. An undated new row goes at the end.
 */
export function slotByDate(rows: readonly DatedRow[], newId: string, newDate: string | null): string[] | null {
  if (!rows.some((r) => r.sort_order !== null)) return null
  const ordered = [...rows].sort((a, b) => {
    const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER
    const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return (a.date ?? '').localeCompare(b.date ?? '')
  })
  const ids = ordered.map((r) => r.id)
  if (!newDate) return [...ids, newId]
  let at = 0
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].date !== null && ordered[i].date! <= newDate) at = i + 1
  }
  ids.splice(at, 0, newId)
  return ids
}
