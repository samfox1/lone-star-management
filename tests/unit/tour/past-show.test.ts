// Whether a show is in the past: by its DATE, with the stored flag as the override for
//   shows that have no date.
/**
 * Sam, 2026-09-11, on the Tour page: "why do these two dates have the day its on and the
 * ticket link but the rest dont. They should all say past." The row read a stored
 * `is_past` flag — set by the edit modal's "This was an old show" toggle — and a show
 * nobody had flagged kept its day block and ticket button long after the night. The date
 * is the truth; the flag exists for a show with no date, or one the manager wants marked
 * regardless. Skeen's Shows.tsx already moves a completed show to the past row by date;
 * the dashboard now agrees with the site.
 *
 * `today` is passed in (YYYY-MM-DD), never read from the clock here: the page computes it
 * once on the server so a row cannot flip between server and client, and a pure function
 * over a date is testable without faking time.
 */
import { describe, expect, it } from 'vitest'
import { isPastShow, todayIso } from '@/lib/tour'

const TODAY = '2026-09-11'

describe('isPastShow', () => {
  it('CRITICAL: a dated show before today is past, flag or no flag', () => {
    expect(isPastShow({ date: '2026-09-04', is_past: false }, TODAY)).toBe(true)
    expect(isPastShow({ date: '2026-08-15', is_past: false }, TODAY)).toBe(true)
  })
  it('CRITICAL: a show today or later is not past', () => {
    expect(isPastShow({ date: '2026-09-11', is_past: false }, TODAY)).toBe(false)
    expect(isPastShow({ date: '2026-12-01', is_past: false }, TODAY)).toBe(false)
  })
  it('the flag still marks a show past — an undated one, or one the manager insists on', () => {
    expect(isPastShow({ date: null, is_past: true }, TODAY)).toBe(true)
    expect(isPastShow({ date: '2026-12-01', is_past: true }, TODAY)).toBe(true)
  })
  it('an undated, unflagged show is not past', () => {
    expect(isPastShow({ date: null, is_past: false }, TODAY)).toBe(false)
  })
  // One Stryker survivor is EQUIVALENT and recorded here: dropping the `date !== null`
  // guard changes nothing, because `null < '2026-09-11'` is already false in JavaScript
  // (null coerces to 0, the string to NaN). The guard stays for the reader.
  it('todayIso is the UTC calendar date', () => {
    expect(todayIso(new Date('2026-09-11T23:59:00Z'))).toBe('2026-09-11')
    expect(todayIso(new Date('2026-09-12T00:00:01Z'))).toBe('2026-09-12')
  })
})
