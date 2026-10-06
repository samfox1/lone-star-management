// The numbers a chart decides before it draws: where the axis tops out, what
// "up 28%" means on hover, and how a day is named.
import { describe, expect, it } from 'vitest'
import { axisTicks, dayDelta, dayLabel, monotoneSegments, niceCeil, rankFloor, rankTicks, smoothPath, weekdayLabel } from '@/lib/chart'

describe('niceCeil', () => {
  it('lands the axis top on a number a person can read back', () => {
    expect(niceCeil(136)).toBe(150)
    expect(niceCeil(61)).toBe(80)
    expect(niceCeil(7)).toBe(8)
    expect(niceCeil(217)).toBe(250)
    expect(niceCeil(1111)).toBe(1200)
    expect(niceCeil(50)).toBe(50)
    expect(niceCeil(100)).toBe(100)
  })

  it('CRITICAL: never sits below the peak — a clipped spike is a lie by omission', () => {
    for (const v of [1, 3, 9, 11, 49, 51, 99, 101, 136, 217, 999, 1001]) {
      expect(niceCeil(v), String(v)).toBeGreaterThanOrEqual(v)
    }
  })

  it('CRITICAL: never wastes the box — the peak reaches at least the top gridline but one', () => {
    // 217 → 500 was the bug: the line lived in the bottom two fifths of the chart.
    for (const v of [1, 2, 3, 7, 61, 136, 217, 480, 1111]) {
      const top = niceCeil(v)
      expect(v / top, String(v)).toBeGreaterThan(0.6)
    }
  })

  it('gives an all-zero series a floor of 1 rather than a divide-by-zero', () => {
    expect(niceCeil(0)).toBe(1)
    expect(niceCeil(-5)).toBe(1)
    expect(niceCeil(NaN)).toBe(1)
  })
})

describe('axisTicks', () => {
  it('CRITICAL: every gridline lands on a round number, or the axis cannot be read back', () => {
    expect(axisTicks(136)).toEqual([50, 100, 150])
    expect(axisTicks(217)).toEqual([50, 100, 150, 200, 250])
    expect(axisTicks(61)).toEqual([20, 40, 60, 80])
    expect(axisTicks(7)).toEqual([2, 4, 6, 8])
    expect(axisTicks(1111)).toEqual([200, 400, 600, 800, 1000, 1200])
  })

  it('picks the NEAREST of 1 / 2 / 5 / 10, and each boundary falls the same way', () => {
    // 30 / 4 = 7.5 is a 10, not a 5: three gridlines, not six.
    expect(axisTicks(30)).toEqual([10, 20, 30])
    // The three boundaries exactly: 1.5 is a 2, 3 is a 5, 7 is a 10.
    expect(axisTicks(6)).toEqual([2, 4, 6])
    expect(axisTicks(12)).toEqual([5, 10, 15])
    expect(axisTicks(28)).toEqual([10, 20, 30])
  })

  it('CRITICAL: a count axis never draws a fractional gridline — a one-view week is 1, not 0.2 … 1', () => {
    expect(axisTicks(1)).toEqual([1])
    expect(axisTicks(2)).toEqual([1, 2])
    expect(axisTicks(3)).toEqual([1, 2, 3])
    for (const v of [1, 2, 3, 4, 5]) {
      for (const t of axisTicks(v)) expect(Number.isInteger(t), `${v} → ${t}`).toBe(true)
    }
  })

  it('ends exactly on the axis top, so the top gridline is the ceiling', () => {
    for (const v of [1, 3, 7, 61, 136, 217, 999, 1111]) {
      expect(axisTicks(v).at(-1), String(v)).toBe(niceCeil(v))
    }
  })
})

describe('dayDelta', () => {
  it('is the fractional change on the previous day', () => {
    expect(dayDelta(106, 136)).toBeCloseTo(0.283, 3)
    expect(dayDelta(100, 50)).toBe(-0.5)
    expect(dayDelta(10, 10)).toBe(0)
  })

  it('CRITICAL: refuses to invent a percentage against nothing', () => {
    // The first day has no yesterday; a yesterday of zero makes any % infinite.
    expect(dayDelta(undefined, 40)).toBeNull()
    expect(dayDelta(0, 40)).toBeNull()
    expect(dayDelta(0, 0)).toBeNull()
  })
})

describe('dayLabel', () => {
  it('names a UTC day by reading the string, so it never shifts a day west of Greenwich', () => {
    expect(dayLabel('2026-09-12')).toBe('Sep 12')
    expect(dayLabel('2026-01-05')).toBe('Jan 5')
    expect(dayLabel('2026-12-31')).toBe('Dec 31')
  })
})

/** Each segment's numbers: [c1x, c1y, c2x, c2y, x, y]. */
const nums = (seg: string) => seg.replace(/^C\s*/, '').split(/[\s,]+/).map(Number)

describe('monotoneSegments — the smooth line', () => {
  const pts: [number, number][] = [[0, 100], [10, 20], [20, 60], [30, 60], [40, 0]]

  it('CRITICAL: passes through every point — one segment per gap, each ending ON the next point', () => {
    const segs = monotoneSegments(pts)
    expect(segs).toHaveLength(pts.length - 1)
    segs.forEach((seg, i) => {
      const n = nums(seg)
      expect(n[4]).toBeCloseTo(pts[i + 1][0], 1)
      expect(n[5]).toBeCloseTo(pts[i + 1][1], 1)
    })
  })

  it('CRITICAL: never overshoots — between two days the curve stays within their values (a quiet day after a busy one never dips past zero)', () => {
    // A curve lies inside its control points' hull, so controls within the two ends' range prove it.
    const spiky: [number, number][] = [[0, 400], [10, 400], [20, 0], [30, 380], [40, 400], [50, 0], [60, 0], [70, 210]]
    const segs = monotoneSegments(spiky)
    segs.forEach((seg, i) => {
      const [, c1y, , c2y] = nums(seg)
      const lo = Math.min(spiky[i][1], spiky[i + 1][1]), hi = Math.max(spiky[i][1], spiky[i + 1][1])
      for (const y of [c1y, c2y]) {
        expect(y).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(y).toBeLessThanOrEqual(hi + 1e-6)
      }
    })
  })

  it('a flat run stays flat, and a turning point is level (no bump past the peak)', () => {
    const [, , flat] = monotoneSegments(pts).map(nums)
    expect(flat[1]).toBeCloseTo(60, 6)
    expect(flat[3]).toBeCloseTo(60, 6)
    // [10, 20] is a turning point: the line arrives and leaves level there.
    const [into, out] = monotoneSegments(pts).map(nums)
    expect(into[3]).toBeCloseTo(20, 6)
    expect(out[1]).toBeCloseTo(20, 6)
  })

  it('bends: a steady climb between two steeper ones is not drawn as straight lines', () => {
    const climb: [number, number][] = [[0, 100], [10, 90], [20, 40], [30, 30]]
    const mid = nums(monotoneSegments(climb)[1])
    const straight = 90 + (40 - 90) / 3 // where a straight line's first third would sit
    expect(Math.abs(mid[1] - straight)).toBeGreaterThan(1)
  })

  it('CRITICAL: lands exactly where the monotone method says — a steady climb (no limiting needed)', () => {
    // Slopes per gap 1, 2, 3; each point's slope is the mean of its two gaps (1, 1.5, 2.5, 3,
    // the ends taking their one gap's). A control point sits a third of a gap away along that slope.
    expect(monotoneSegments([[0, 0], [10, 10], [20, 30], [30, 60]])).toEqual([
      'C3.3,3.3 6.7,5.0 10.0,10.0', // 0 + 1×10/3,  10 − 1.5×10/3
      'C13.3,15.0 16.7,21.7 20.0,30.0', // 10 + 1.5×10/3,  30 − 2.5×10/3
      'C23.3,38.3 26.7,50.0 30.0,60.0', // 30 + 2.5×10/3,  60 − 3×10/3
    ])
  })

  it('CRITICAL: a steep climb into a shallow one is reined in (Fritsch–Carlson), so the curve cannot bulge past the top', () => {
    // Gaps rise 10 then 2 per unit. The middle point's mean slope 6 is 3× the shallow gap's:
    // a² + b² = 3² + 1² = 10 > 9, so both ends of that gap scale by 3/√10 ≈ 0.9487 — the
    // middle slope to 5.6921, the last to 1.8974. The first gap's far control uses the reined slope.
    expect(monotoneSegments([[0, 0], [10, 100], [20, 120]])).toEqual([
      'C3.3,33.3 6.7,81.0 10.0,100.0', // 100 − 5.6921×10/3 = 81.03
      'C13.3,119.0 16.7,113.7 20.0,120.0', // 100 + 18.97 = 118.97;  120 − 1.8974×10/3 = 113.68
    ])
  })

  it('two points are one straight gap', () => {
    expect(monotoneSegments([[0, 0], [30, 30]])).toEqual(['C10.0,10.0 20.0,20.0 30.0,30.0'])
  })

  it('uneven gaps: each control point is a third of ITS gap away', () => {
    // Gaps of 30 and 10, both rising 1 per unit: a straight line, so the controls sit on it.
    expect(monotoneSegments([[0, 0], [30, 30], [40, 40]])).toEqual([
      'C10.0,10.0 20.0,20.0 30.0,30.0',
      'C33.3,33.3 36.7,36.7 40.0,40.0',
    ])
  })

  it('fewer than two points is no line', () => {
    expect(monotoneSegments([])).toEqual([])
    expect(monotoneSegments([[5, 5]])).toEqual([])
  })
})

describe('smoothPath', () => {
  it('starts at the first point and joins every segment', () => {
    const pts: [number, number][] = [[0, 10], [5, 0], [10, 10]]
    expect(smoothPath(pts)).toBe(`M0.0,10.0 ${monotoneSegments(pts).join(' ')}`)
    expect(smoothPath([[3, 4]])).toBe('M3.0,4.0')
    expect(smoothPath([])).toBe('')
  })
})

describe('weekdayLabel', () => {
  it('names the day of the week, read off the string in UTC — never the day before west of Greenwich', () => {
    expect(weekdayLabel('2026-09-07')).toBe('Mon, Sep 7')
    expect(weekdayLabel('2026-10-04')).toBe('Sun, Oct 4')
    expect(weekdayLabel('2026-12-31')).toBe('Thu, Dec 31')
    expect(weekdayLabel('2027-01-01')).toBe('Fri, Jan 1')
  })
})

describe('a spot axis (#1 at the top)', () => {
  it('CRITICAL: the floor is the spot below the lowest one held, never above #3 (a site at #1 or #2 still has room to fall)', () => {
    expect(rankFloor([1.2, 1.4])).toBe(3)
    expect(rankFloor([2.3, 2.9])).toBe(4) // 2.9 + a quarter → 3.15 → #4
    expect(rankFloor([2.7])).toBe(3) // 2.7 + 0.25 = 2.95 → #3
    expect(rankFloor([7.8])).toBe(9)
    expect(rankFloor([])).toBe(3)
  })
  it('names every spot up to six, then every second, then every fifth — always from #1', () => {
    expect(rankTicks(3)).toEqual([1, 2, 3])
    expect(rankTicks(6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(rankTicks(9)).toEqual([1, 2, 4, 6, 8])
    expect(rankTicks(12)).toEqual([1, 2, 4, 6, 8, 10, 12])
    expect(rankTicks(31)).toEqual([1, 5, 10, 15, 20, 25, 30])
  })
})
