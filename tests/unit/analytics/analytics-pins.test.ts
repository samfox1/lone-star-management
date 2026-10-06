// The moments the Analytics chart pins, worked out from the window's own numbers. A pin is a
// claim about the data ("Busiest day: 253 views"), so each one is pinned to the rule that makes it.
import { describe, expect, it } from 'vitest'
import { analyticsPins } from '@/lib/analytics-pins'

const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(8 + i).padStart(2, '0')}`) // Sep 8..17
const flat = (n: number) => days.map(() => n)

describe('analyticsPins', () => {
  it('CRITICAL: the busiest day by views, with its count — the first of a tie', () => {
    const views = [5, 9, 40, 12, 40, 3, 0, 1, 2, 2]
    const pins = analyticsPins({ days, views, bots: flat(0) })
    expect(pins).toEqual([{ day: '2026-09-10', kind: 'busiest', series: 'views', title: 'Busiest day: 40 views', note: '' }])
  })

  it('no busiest day in a window of nothing, or one too short to have a "busiest"', () => {
    expect(analyticsPins({ days, views: flat(0), bots: flat(0) })).toEqual([])
    expect(analyticsPins({ days: days.slice(0, 6), views: [1, 2, 9, 3, 1, 1], bots: [0, 0, 0, 0, 0, 0] })).toEqual([])
    // Seven days is enough.
    expect(analyticsPins({ days: days.slice(0, 7), views: [1, 2, 9, 3, 1, 1, 1], bots: flat(0).slice(0, 7) }).map((p) => p.day)).toEqual(['2026-09-10'])
  })

  it('CRITICAL: the day counting began, only when it falls INSIDE the window (not on its first day, not before, not after)', () => {
    const at = (countedSince: string) => analyticsPins({ days, views: flat(0), bots: flat(0), countedSince })
    expect(at('2026-09-12')).toEqual([{ day: '2026-09-12', kind: 'counting', series: 'visitors', title: 'Visitors counted from here', note: 'and bots filtered' }])
    expect(at('2026-09-17')).toHaveLength(1) // the last day
    expect(at('2026-09-08')).toEqual([]) // the window's first day: everything in view was counted
    expect(at('2026-09-01')).toEqual([])
    expect(at('2026-09-18')).toEqual([])
  })

  it('CRITICAL: a bot spike — the most bots on a day, at least 10 and at least three times the usual day', () => {
    const bots = [1, 2, 1, 0, 32, 1, 2, 1, 0, 0] // 40 over 10 days: 4 a day; 32 is 8×
    expect(analyticsPins({ days, views: flat(0), bots })).toEqual([
      { day: '2026-09-12', kind: 'bots', series: 'bots', title: '32 bot visits filtered', note: 'kept out of every number' },
    ])
  })

  it('no bot pin for a small day (under 10) or a steady stream (under 3× the usual)', () => {
    expect(analyticsPins({ days, views: flat(0), bots: [0, 0, 0, 0, 9, 0, 0, 0, 0, 0] })).toEqual([])
    // 12 is the most, but the usual day is 6: only 2×.
    expect(analyticsPins({ days, views: flat(0), bots: [6, 6, 6, 6, 12, 6, 0, 6, 6, 6] })).toEqual([])
    // The edges count: exactly 10 (over a usual 1), and exactly 3× (15 over a usual 50/10 = 5).
    expect(analyticsPins({ days, views: flat(0), bots: [0, 0, 10, 0, 0, 0, 0, 0, 0, 0] }).map((p) => p.kind)).toEqual(['bots'])
    expect(analyticsPins({ days, views: flat(0), bots: [15, 5, 5, 5, 5, 5, 5, 5, 0, 0] }).map((p) => p.kind)).toEqual(['bots'])
  })

  it('CRITICAL: bots before counting began are not counted toward the usual day', () => {
    // Counted from Sep 13 (index 5). Before it the rows carry no bot flag: those zeros are not "quiet days".
    const bots = [0, 0, 0, 0, 0, 4, 4, 13, 4, 4] // counted: 4,4,13,4,4 → usual 5.8; 13 < 3×5.8
    expect(analyticsPins({ days, views: flat(0), bots, countedSince: '2026-09-13' }).map((p) => p.kind)).toEqual(['counting'])
  })

  it('no bot pin at all when the whole window is before counting began — whatever its rows say', () => {
    expect(analyticsPins({ days, views: flat(0), bots: [0, 0, 0, 40, 0, 0, 0, 0, 0, 0], countedSince: '2026-09-20' })).toEqual([])
  })

  it('every pin in day order', () => {
    const pins = analyticsPins({
      days, countedSince: '2026-09-11',
      views: [1, 1, 1, 1, 1, 1, 1, 1, 50, 1], bots: [0, 0, 0, 30, 0, 0, 0, 0, 0, 0],
    })
    expect(pins.map((p) => [p.day, p.kind])).toEqual([['2026-09-11', 'counting'], ['2026-09-11', 'bots'], ['2026-09-16', 'busiest']])
  })
})
