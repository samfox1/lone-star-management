// The globe's arithmetic: where it faces when it opens, how a drag turns it, what is on
// the near side, and how far it zooms. Pure; the projection itself is d3's orthographic.
import { describe, expect, it } from 'vitest'
import { GLOBE_GAP, GLOBE_SIZE, SCALE_MAX, SCALE_MIN, dragRotate, faceOf, globeProjection, globeWidth, isNearSide, rotationTo, zoomScale, type Rotation } from '@/lib/globe-view'

const p = (lon: number, lat: number, visitors = 1) => ({ lon, lat, visitors })

describe('faceOf — the side the globe opens on', () => {
  it('CRITICAL: faces the audience, weighted by visitors — a US artist sees the US, not the Atlantic', () => {
    const [lon, lat] = faceOf([p(-87.9, 43.0, 100), p(-74.0, 40.7, 50), p(103.8, 1.35, 1)])
    expect(lon).toBeGreaterThan(-95); expect(lon).toBeLessThan(-70)
    expect(lat).toBeGreaterThan(30); expect(lat).toBeLessThan(50)
  })
  it('CRITICAL: is a real point on the sphere, not an average of longitudes — Tokyo and Los Angeles face the Pacific, not Africa', () => {
    const [lon] = faceOf([p(139.7, 35.7), p(-118.2, 34.1)])
    expect(Math.abs(lon)).toBeGreaterThan(150) // the antimeridian side; a naive mean is ~10°E
  })
  it('with nothing placed, faces the prime meridian at a temperate latitude', () => {
    expect(faceOf([])).toEqual([0, 20])
  })
})

describe('rotationTo / dragRotate', () => {
  it('a rotation is the negative of the point it faces', () => {
    expect(rotationTo([-95, 40])).toEqual([95, -40])
  })
  it('CRITICAL: dragging right turns the globe so the land follows the pointer — longitude grows with dx; dragging up shows further south', () => {
    const r0: Rotation = [0, 0]
    const r1 = dragRotate(r0, 100, 0, 1)
    expect(r1[0]).toBeGreaterThan(0)
    expect(r1[1]).toBe(0)
    const r2 = dragRotate(r0, 0, -100, 1)
    expect(r2[1]).toBeGreaterThan(0) // pushing the globe up rolls its top away: the view faces further south
  })
  it('a drag turns less when zoomed in, so the land still follows the pointer', () => {
    expect(dragRotate([0, 0], 100, 0, 3)[0]).toBeCloseTo(dragRotate([0, 0], 100, 0, 1)[0] / 3, 6)
  })
  it('the poles stay in reach but not beyond: the tilt is held within ±80°', () => {
    expect(dragRotate([0, 0], 0, -100000, 1)[1]).toBe(80)
    expect(dragRotate([0, 0], 0, 100000, 1)[1]).toBe(-80)
  })
  it('longitude wraps, so the globe can spin forever', () => {
    const r = dragRotate([170, 0], 100000, 0, 1)
    expect(r[0]).toBeGreaterThanOrEqual(-180)
    expect(r[0]).toBeLessThan(180)
  })
})

describe('isNearSide — what the globe can show', () => {
  it('CRITICAL: a city on the far side is hidden, one on the near side shown, and the edge counts as shown', () => {
    const facingUS = rotationTo([-95, 40])
    expect(isNearSide([-87.9, 43.0], facingUS)).toBe(true) // Chicago
    expect(isNearSide([103.8, 1.35], facingUS)).toBe(false) // Singapore
    // The limb is a great-circle distance of 90°: along the equator that is 90° of longitude.
    const facingEquator = rotationTo([-95, 0])
    expect(isNearSide([-95 + 89.9, 0], facingEquator)).toBe(true) // just inside the limb
    expect(isNearSide([-95 + 90.1, 0], facingEquator)).toBe(false) // just over it
  })
})

describe('zoomScale', () => {
  it('scales by the factor and stops at the limits', () => {
    expect(zoomScale(1, 2)).toBe(2)
    expect(zoomScale(1, 0.1)).toBe(SCALE_MIN)
    expect(zoomScale(1, 100)).toBe(SCALE_MAX)
    expect(SCALE_MIN).toBeLessThanOrEqual(1)
    expect(SCALE_MAX).toBeGreaterThan(SCALE_MIN)
  })
})

describe('globeProjection', () => {
  it('CRITICAL: the faced point lands in the middle of the frame; zooming keeps it there and pushes the rest out', () => {
    const r = rotationTo([-95, 40])
    const [x, y] = globeProjection(r, 1)([-95, 40])!
    expect(x).toBeCloseTo(GLOBE_SIZE / 2, 6)
    expect(y).toBeCloseTo(GLOBE_SIZE / 2, 6)
    const chicago1 = globeProjection(r, 1)([-87.9, 43])!
    const chicago2 = globeProjection(r, 2)([-87.9, 43])!
    expect(chicago2[0] - GLOBE_SIZE / 2).toBeCloseTo(2 * (chicago1[0] - GLOBE_SIZE / 2), 6)
  })
  it('CRITICAL: at scale 1 the sphere is the frame\'s height less the gap, centred in a frame of the box\'s shape', () => {
    const p = globeProjection([0, 0], 1)
    expect(p([90, 0])![0]).toBeCloseTo(GLOBE_SIZE - GLOBE_GAP, 3)
    expect(p([-90, 0])![0]).toBeCloseTo(GLOBE_GAP, 3)
    expect(p([0, 90])![1]).toBeCloseTo(GLOBE_GAP, 3)
    // A 2:1 box: the frame is twice as wide, the sphere sits in its middle.
    const wide = globeProjection([0, 0], 1, 2)
    expect(globeWidth(2)).toBe(GLOBE_SIZE * 2)
    expect(wide([0, 0])![0]).toBeCloseTo(GLOBE_SIZE, 3)
    expect(wide([0, 0])![1]).toBeCloseTo(GLOBE_SIZE / 2, 3)
    expect(wide([-90, 0])![0]).toBeCloseTo(GLOBE_SIZE / 2 + GLOBE_GAP, 3)
  })
})
