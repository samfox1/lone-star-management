// The two numbers a chart decides before it draws: where the axis tops out, and
// what "up 28%" means on hover.
import { describe, expect, it } from 'vitest'
import { axisTicks, dayDelta, niceCeil } from '@/lib/chart'

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
    for (const v of [7, 61, 136, 217, 480, 1111]) {
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
