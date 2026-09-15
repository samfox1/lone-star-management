// How hot each city glows. Glows stack where they overlap, so a fixed strength per city turned every
// busy region red, and a bigger audience (more cities) only spread the red further (Sam, 2026-09-15:
// "when he gets millions of views, will the whole map be red? Should it be relative?"). The heat is
// RELATIVE to the busiest spot: it reaches dark red, a spot half as busy is clearly cooler, and the
// same audience at any size glows the same. Pure.
import { describe, expect, it } from 'vitest'
import { HEAT_MIN, HEAT_PEAK, heatAlphas, type HeatPoint } from '@/lib/heat'

const pt = (x: number, y: number, visitors: number): HeatPoint => ({ x, y, visitors })
/** The opacity where glows stack at a spot, as SVG composites them: 1 − Π(1 − alpha × the glow's falloff there). */
const stackAt = (points: HeatPoint[], alphas: number[], at: { x: number; y: number }, reach: number) =>
  1 - points.reduce((p, q, i) => p * (1 - alphas[i] * Math.max(0, 1 - Math.hypot(q.x - at.x, q.y - at.y) / reach)), 1)
/** A block of `n` cities, one map unit apart, around (cx, cy). */
const crowd = (n: number, cx: number, cy: number, visitors: number) =>
  Array.from({ length: n }, (_, i) => pt(cx + (i % 10) - 4.5, cy + Math.floor(i / 10) - (Math.ceil(n / 10) - 1) / 2, visitors))

describe('heatAlphas', () => {
  it('nothing in, nothing out', () => {
    expect(heatAlphas([], 10)).toEqual([])
  })

  it('CRITICAL: RELATIVE — the same audience ten thousand times bigger glows exactly the same, so millions of views do not turn the map red', () => {
    const small = [pt(0, 0, 5), pt(3, 0, 2), pt(4, 2, 1), pt(50, 50, 1)]
    const huge = small.map((p) => ({ ...p, visitors: p.visitors * 10_000 }))
    const a = heatAlphas(small, 10), b = heatAlphas(huge, 10)
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9))
  })

  it('CRITICAL: the busiest spot reaches the top of the ramp (dark red) and no further — ten times as many cities crowding it change nothing', () => {
    const reach = 20
    const few = crowd(40, 100, 100, 50)
    const many = crowd(400, 100, 100, 50)
    const peakFew = stackAt(few, heatAlphas(few, reach), { x: 100, y: 100 }, reach)
    const peakMany = stackAt(many, heatAlphas(many, reach), { x: 100, y: 100 }, reach)
    for (const peak of [peakFew, peakMany]) {
      expect(peak).toBeLessThanOrEqual(HEAT_PEAK + 0.01)
      expect(peak).toBeGreaterThan(HEAT_PEAK - 0.08)
    }
    expect(Math.abs(peakMany - peakFew)).toBeLessThan(0.03)
  })

  it('CRITICAL: a spot half as busy is clearly cooler than the peak, and a quarter as busy cooler still — nothing but the busiest saturates', () => {
    const reach = 20
    const points = [...crowd(40, 100, 100, 40), ...crowd(40, 300, 100, 20), ...crowd(40, 500, 100, 10)]
    const a = heatAlphas(points, reach)
    const [peak, half, quarter] = [100, 300, 500].map((x) => stackAt(points, a, { x, y: 100 }, reach))
    expect(half).toBeLessThan(peak - 0.1)
    expect(quarter).toBeLessThan(half - 0.1)
  })

  it('CRITICAL: only cities within reach add to each other — the same two cities glow less each when far apart than when they overlap', () => {
    const apart = heatAlphas([pt(0, 0, 10), pt(100, 0, 10)], 10)
    const close = heatAlphas([pt(0, 0, 10), pt(5, 0, 10)], 10)
    expect(apart[0]).toBeCloseTo(apart[1], 9)
    expect(apart[0]).toBeCloseTo(HEAT_PEAK, 9) // each is its own busiest spot
    expect(close[0]).toBeLessThan(apart[0])
  })

  it('a city with one visitor beside a huge audience still shows, faintly', () => {
    const a = heatAlphas([pt(0, 0, 1_000_000), pt(500, 500, 1)], 10)
    expect(a[1]).toBeCloseTo(HEAT_MIN, 9)
    expect(HEAT_MIN).toBeGreaterThan(0)
    expect(HEAT_MIN).toBeLessThan(0.1)
  })

  it('CRITICAL: a crowd of tiny places far from the big audience does not stack into red — the floor lifts a faint NEIGHBOURHOOD, not each city', () => {
    // A floor per city made a hundred one-visitor towns glow at the floor each, and a hundred floors stack to red.
    const reach = 20
    const points = [pt(0, 0, 1_000_000), ...crowd(100, 500, 500, 1)]
    const faint = stackAt(points, heatAlphas(points, reach), { x: 500, y: 500 }, reach)
    expect(faint).toBeGreaterThanOrEqual(HEAT_MIN - 0.005)
    expect(faint).toBeLessThan(0.15)
  })

  it('CRITICAL: finds every neighbour a scan of all pairs finds — across cell edges too — on a scattered audience', () => {
    // Neighbours are bucketed for speed (thousands of cities, recomputed on zoom); a bucket edge must not hide one.
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const points = Array.from({ length: 300 }, () => pt(rand() * 200, rand() * 100, 1 + Math.floor(rand() * 50)))
    points.push(pt(9.999, 0, 30), pt(10.001, 0, 30)) // straddling a bucket edge at reach 10
    const reach = 10
    const density = points.map((p) => points.reduce((s, q) => s + q.visitors * Math.max(0, 1 - Math.hypot(p.x - q.x, p.y - q.y) / reach), 0))
    const busiest = Math.max(...density)
    const a = heatAlphas(points, reach)
    // The rule, with the densities from the scan: a city's share of the busiest spot, a faint neighbourhood lifted to HEAT_MIN.
    const minShare = Math.log(1 - HEAT_MIN) / Math.log(1 - HEAT_PEAK)
    const rule = (i: number) => 1 - (1 - HEAT_PEAK) ** Math.max(points[i].visitors / busiest, (minShare * points[i].visitors) / density[i])
    a.forEach((v, i) => expect(v, `city ${i}`).toBeCloseTo(rule(i), 9))
  })
})
