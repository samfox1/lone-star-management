// The day-bucketing math shared by roster-data.ts (rosterDailyViews, artistDailyViews)
// and entity-sparkline.tsx, pulled into ONE home (CODE_AUDIT.md item I) after three
// near-duplicate copies drifted: roster-data.ts floored "now" to midnight then walked an
// ms-epoch INDEX (`windowStartMs` + `Date.parse` + `Math.round`), while entity-sparkline.tsx
// built its own day list from raw `Date.now()` arithmetic and a string-keyed Map. Both
// "worked" on an ordinary day; the index approach is the one worth pinning here, because a
// row landing exactly on the window's first or last day is the case an index computed from
// a SEPARATE "now" floor can silently misplace by one bucket — a plain day-string list has
// no such edge.
import { describe, expect, it } from 'vitest'
import { dayList, sumByDay } from '@/lib/analytics'

const NOW = Date.parse('2026-09-12T18:00:00Z')

describe('dayList', () => {
  it('the last N UTC-day strings ending today, oldest first', () => {
    expect(dayList(3, NOW)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12'])
  })
  it('a single-day window is just today', () => {
    expect(dayList(1, NOW)).toEqual(['2026-09-12'])
  })
})

describe('sumByDay', () => {
  type Row = { day: string; n: number }
  const days = dayList(3, NOW) // ['2026-09-10', '2026-09-11', '2026-09-12']
  const bucket = (rows: Row[]) => sumByDay(rows, days, (r) => r.day, (r) => r.n)

  it('CRITICAL: a row on the window\'s FIRST day lands in the first bucket, not dropped', () => {
    expect(bucket([{ day: '2026-09-10T00:00:00Z', n: 5 }])).toEqual([5, 0, 0])
  })

  it('CRITICAL: a row one calendar day BEFORE the window is excluded entirely, not folded into day 0', () => {
    // 23:59:59 the day before the window starts — closest possible timestamp to the
    // boundary without being in it. An index built from a midnight floor of a
    // DIFFERENT "now" call than `days` used could round this into bucket 0.
    expect(bucket([{ day: '2026-09-09T23:59:59Z', n: 100 }])).toEqual([0, 0, 0])
  })

  it('CRITICAL: a row on the window\'s LAST day (today) lands in the last bucket, not dropped or overflowed', () => {
    expect(bucket([{ day: '2026-09-12T23:59:59Z', n: 7 }])).toEqual([0, 0, 7])
  })

  it('a row one calendar day AFTER the window is excluded, not folded into the last bucket', () => {
    expect(bucket([{ day: '2026-09-13T00:00:00Z', n: 9 }])).toEqual([0, 0, 0])
  })

  it('days with no rows zero-fill, and multiple rows on one day sum', () => {
    expect(
      bucket([
        { day: '2026-09-11T00:00:00Z', n: 2 },
        { day: '2026-09-11T00:00:00Z', n: 3 },
      ]),
    ).toEqual([0, 5, 0])
  })

  it('the output is always exactly `days.length` long, in the same order as `days`', () => {
    expect(bucket([])).toHaveLength(3)
  })
})
