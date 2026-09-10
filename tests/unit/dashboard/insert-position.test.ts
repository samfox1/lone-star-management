// Where a NEW row lands in a list: merch goes to the front, a tour date slots by date
//   among the dates already there, even after the manager has dragged the list.
/**
 * Sam, 2026-09-10: "for adding tour dates, it should append in the correct part of the
 * list (fitting around the other dates) — if its the earliest it should go before the
 * next earliest. if its in the middle of two dates, it should be in the middle. merch
 * should just get added to the front/top of the list."
 *
 * Both rules are PURE here and run inside `createContent`. Two modes matter:
 *  - nobody has dragged: sort_order is null everywhere, the door and the site order by
 *    date (tour) or newest-first (merch) on their own, and these return null — nothing to
 *    renumber, and a spurious renumber would flip a list into manual mode.
 *  - the manager HAS dragged (any row carries sort_order): their order is the order, and
 *    the new row has to be placed INTO it rather than dumped at the end.
 */
import { describe, expect, it } from 'vitest'
import { frontSortOrder, slotByDate } from '@/lib/insert-position'

describe('frontSortOrder — merch goes on top', () => {
  it('CRITICAL: with a dragged list, the new row goes one before the current first', () => {
    expect(frontSortOrder([3, 1, 2])).toBe(0)
    expect(frontSortOrder([0, 1])).toBe(-1)
  })
  it('with an undragged list (all null), nothing is assigned — newest-first already puts it on top', () => {
    expect(frontSortOrder([null, null])).toBeNull()
    expect(frontSortOrder([])).toBeNull()
  })
  it('a mixed list counts only the numbered rows', () => {
    expect(frontSortOrder([null, 5, null, 7])).toBe(4)
  })
})

describe('slotByDate — a tour date fits around the others', () => {
  const rows = [
    { id: 'a', date: '2026-10-01', sort_order: 0 },
    { id: 'b', date: '2026-10-15', sort_order: 1 },
    { id: 'c', date: '2026-11-01', sort_order: 2 },
    { id: 'tba', date: null, sort_order: 3 }, // undated, dragged to the end
  ]
  it('CRITICAL: the earliest goes BEFORE the next earliest', () => {
    expect(slotByDate(rows, 'new', '2026-09-01')).toEqual(['new', 'a', 'b', 'c', 'tba'])
  })
  it('CRITICAL: a date between two dates goes between them', () => {
    expect(slotByDate(rows, 'new', '2026-10-20')).toEqual(['a', 'b', 'new', 'c', 'tba'])
  })
  it('the latest goes after the last DATED row, before any undated ones', () => {
    expect(slotByDate(rows, 'new', '2026-12-01')).toEqual(['a', 'b', 'c', 'new', 'tba'])
  })
  it('the same date as an existing row goes after it', () => {
    expect(slotByDate(rows, 'new', '2026-10-15')).toEqual(['a', 'b', 'new', 'c', 'tba'])
  })
  it('an undated new row is appended at the end', () => {
    expect(slotByDate(rows, 'new', null)).toEqual(['a', 'b', 'c', 'tba', 'new'])
  })
  it('CRITICAL: an undragged list (no sort_order anywhere) is left alone — null, no renumber', () => {
    const fresh = rows.map((r) => ({ ...r, sort_order: null }))
    expect(slotByDate(fresh, 'new', '2026-10-20')).toBeNull()
  })
  it('the new row is placed against the DRAGGED order, not a re-sort by date', () => {
    // The manager put c (Nov) before a (Oct). Their order wins; the new Oct-20 date
    // goes after the last row dated on or before it in THAT order.
    const dragged = [
      { id: 'c', date: '2026-11-01', sort_order: 0 },
      { id: 'a', date: '2026-10-01', sort_order: 1 },
      { id: 'b', date: '2026-10-15', sort_order: 2 },
    ]
    expect(slotByDate(dragged, 'new', '2026-10-20')).toEqual(['c', 'a', 'b', 'new'])
  })
})
