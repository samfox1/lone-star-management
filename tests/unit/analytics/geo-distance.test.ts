// Great-circle miles and the major-city rules the page and the data builder share, so the
// builder's radius and the page's radius cannot drift apart.
import { describe, expect, it } from 'vitest'
import { MAJOR_CITY_MIN_POP, MAJOR_CITY_RADIUS_MI, milesBetween } from '@/lib/geo-distance'

describe('milesBetween', () => {
  it('New York to Los Angeles is about 2,450 miles; a place to itself is 0; a degree of latitude is about 69', () => {
    expect(milesBetween(40.75, -73.98, 33.99, -118.18)).toBeGreaterThan(2400)
    expect(milesBetween(40.75, -73.98, 33.99, -118.18)).toBeLessThan(2500)
    expect(milesBetween(12, 34, 12, 34)).toBe(0)
    expect(milesBetween(0, 0, 1, 0)).toBeCloseTo(69.1, 0)
  })

  it('is symmetric, and measures across the antimeridian the short way', () => {
    expect(milesBetween(10, 20, 30, 40)).toBeCloseTo(milesBetween(30, 40, 10, 20), 9)
    expect(milesBetween(0, 179.5, 0, -179.5)).toBeCloseTo(69.1, 0)
  })
})

describe('the major-city rules (Sam, 2026-09-14)', () => {
  it('a major city has at least 250,000 people and reaches 50 miles — the note under the list says so', () => {
    expect(MAJOR_CITY_MIN_POP).toBe(250_000)
    expect(MAJOR_CITY_RADIUS_MI).toBe(50)
  })
})
