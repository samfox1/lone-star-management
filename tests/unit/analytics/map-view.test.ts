// The map's window: where it opens (on the audience), how it zooms (about the pointer,
// never past the edges or the limits) and how it pans (clamped to the map). Pure.
import { describe, expect, it } from 'vitest'
import { FIT_K_MAX, K_MAX, clampView, fadeIn, fitBox, fitView, fitWindow, nearestPoint, panView, worldView, zoomView, type View } from '@/lib/map-view'

const W = 720, H = 360
const BOUNDS = { width: W, height: H }
const pt = (x: number, y: number) => ({ x, y })
const k = (v: View) => W / v.w

describe('worldView / clampView', () => {
  it('the world is the whole frame', () => {
    expect(worldView(BOUNDS)).toEqual({ x: 0, y: 0, w: W, h: H })
  })
  it('CRITICAL: a view never shows outside the map — it is pushed back in, and never larger than the map', () => {
    expect(clampView({ x: -50, y: -20, w: 360, h: 180 }, BOUNDS)).toEqual({ x: 0, y: 0, w: 360, h: 180 })
    expect(clampView({ x: 500, y: 300, w: 360, h: 180 }, BOUNDS)).toEqual({ x: 360, y: 180, w: 360, h: 180 })
    expect(clampView({ x: 0, y: 0, w: 2000, h: 1000 }, BOUNDS)).toEqual({ x: 0, y: 0, w: W, h: H })
  })
  it('keeps the frame\'s aspect: a view is always as wide-to-tall as the map', () => {
    const v = clampView({ x: 0, y: 0, w: 360, h: 100 }, BOUNDS)
    expect(v.w / v.h).toBeCloseTo(W / H, 6)
  })
})

describe('fitView — where the map opens', () => {
  it('with nothing placed, the world', () => {
    expect(fitView([], BOUNDS)).toEqual(worldView(BOUNDS))
  })
  it('CRITICAL: an audience in one region opens ON that region, with room around it — a US artist sees the US', () => {
    // Four points spread over roughly the US in map units.
    const us = [pt(120, 110), pt(200, 100), pt(180, 150), pt(140, 140)]
    const v = fitView(us, BOUNDS)
    expect(k(v)).toBeGreaterThan(1.5)
    for (const p of us) {
      expect(p.x).toBeGreaterThan(v.x)
      expect(p.x).toBeLessThan(v.x + v.w)
      expect(p.y).toBeGreaterThan(v.y)
      expect(p.y).toBeLessThan(v.y + v.h)
    }
    // Centred on the audience, not on the world.
    expect(v.x + v.w / 2).toBeCloseTo(160, 0)
    expect(v.y + v.h / 2).toBeCloseTo(125, 0)
  })
  it('CRITICAL: one city alone does not zoom to a pixel — the opening zoom is capped', () => {
    const v = fitView([pt(300, 200)], BOUNDS)
    expect(k(v)).toBeCloseTo(FIT_K_MAX, 6)
    expect(v.x + v.w / 2).toBeCloseTo(300, 6)
    expect(v.y + v.h / 2).toBeCloseTo(200, 6)
  })
  it('CRITICAL: a TALL audience is fitted too — north to south counts as much as east to west', () => {
    // Two cities on one meridian, far apart in latitude. A fit that only measured width
    // would open at the cap and crop one of them off the top or bottom.
    const tall = [pt(300, 40), pt(300, 320)]
    const v = fitView(tall, BOUNDS)
    for (const p of tall) {
      expect(p.y).toBeGreaterThan(v.y)
      expect(p.y).toBeLessThan(v.y + v.h)
    }
  })

  it('an audience on both sides of the world opens on the world', () => {
    expect(fitView([pt(100, 100), pt(650, 300)], BOUNDS)).toEqual(worldView(BOUNDS))
  })
  it('an audience near the edge still sits inside the frame', () => {
    const v = fitView([pt(5, 5)], BOUNDS)
    expect(v.x).toBe(0)
    expect(v.y).toBe(0)
  })
})

describe('fitBox — a country\'s frame', () => {
  it('CRITICAL: frames the box with room around it, centred, no deeper than the cap given', () => {
    const box = { minX: 100, maxX: 300, minY: 80, maxY: 200 }
    const v = fitBox(box, BOUNDS, 6, 0.12)
    expect(v.x).toBeLessThan(box.minX)
    expect(v.x + v.w).toBeGreaterThan(box.maxX)
    expect(v.y).toBeLessThan(box.minY)
    expect(v.y + v.h).toBeGreaterThan(box.maxY)
    expect(v.x + v.w / 2).toBeCloseTo(200, 6)
    expect(v.y + v.h / 2).toBeCloseTo(140, 6)
    expect(k(v)).toBeLessThanOrEqual(6)
    // A tiny box stops at the cap rather than filling the frame with nothing.
    expect(k(fitBox({ minX: 300, maxX: 301, minY: 200, maxY: 201 }, BOUNDS, 6, 0.12))).toBeCloseTo(6, 6)
  })
  it('a box wider than the frame is the world', () => {
    expect(fitBox({ minX: 0, maxX: W, minY: 0, maxY: H }, BOUNDS, 6, 0.12)).toEqual(worldView(BOUNDS))
  })
})

describe('zoomView', () => {
  it('CRITICAL: zooms about the given point — what was under the pointer stays under it', () => {
    const v0 = worldView(BOUNDS)
    const at = pt(200, 100)
    const v1 = zoomView(v0, 2, at, BOUNDS)
    expect(k(v1)).toBeCloseTo(2, 6)
    // `at` is at the same fraction of the view before and after.
    expect((at.x - v1.x) / v1.w).toBeCloseTo((at.x - v0.x) / v0.w, 6)
    expect((at.y - v1.y) / v1.h).toBeCloseTo((at.y - v0.y) / v0.h, 6)
  })
  it('zooming out past the world stops at the world; zooming in stops at K_MAX', () => {
    expect(zoomView(worldView(BOUNDS), 0.5, pt(0, 0), BOUNDS)).toEqual(worldView(BOUNDS))
    const deep = zoomView(worldView(BOUNDS), 1000, pt(360, 180), BOUNDS)
    expect(k(deep)).toBeCloseTo(K_MAX, 6)
  })
  it('zooming in at a corner does not leave the map', () => {
    const v = zoomView(worldView(BOUNDS), 3, pt(0, 0), BOUNDS)
    expect(v.x).toBe(0)
    expect(v.y).toBe(0)
  })
})

describe('panView', () => {
  it('moves the window by the given map units, clamped to the map', () => {
    const v = zoomView(worldView(BOUNDS), 2, pt(360, 180), BOUNDS) // centred, 360 × 180
    expect(panView(v, 50, -20, BOUNDS)).toEqual({ x: 230, y: 70, w: 360, h: 180 })
    expect(panView(v, 9999, 9999, BOUNDS)).toEqual({ x: 360, y: 180, w: 360, h: 180 })
  })
  it('the world cannot be panned', () => {
    expect(panView(worldView(BOUNDS), 100, 100, BOUNDS)).toEqual(worldView(BOUNDS))
  })
})

describe('fadeIn — a layer that appears as the map zooms', () => {
  it('is nothing up to `from`, everything from `to`, and climbs between', () => {
    expect(fadeIn(1, 1.5, 3)).toBe(0)
    expect(fadeIn(1.5, 1.5, 3)).toBe(0)
    expect(fadeIn(2.25, 1.5, 3)).toBeCloseTo(0.5, 6)
    expect(fadeIn(3, 1.5, 3)).toBe(1)
    expect(fadeIn(10, 1.5, 3)).toBe(1)
  })
})

describe('nearestPoint — the city under the pointer, with no dot to hit', () => {
  const pts = [pt(100, 100), pt(200, 100), pt(300, 300)]
  it('CRITICAL: the closest point within reach, or nothing — hovering the ocean names no city', () => {
    expect(nearestPoint(pts, pt(196, 103), 10)).toBe(pts[1])
    expect(nearestPoint(pts, pt(150, 100), 10)).toBeNull() // exactly between, both 50 away
    expect(nearestPoint(pts, pt(150, 100), 60)).toBe(pts[0]) // a tie goes to the first
    expect(nearestPoint([], pt(0, 0), 100)).toBeNull()
  })
  it('reach is a distance, not a box: a point 8 across and 8 up is 11.3 away', () => {
    expect(nearestPoint([pt(100, 100)], pt(108, 108), 10)).toBeNull()
    expect(nearestPoint([pt(100, 100)], pt(108, 108), 12)).not.toBeNull()
  })
})

describe('a frame taller than the map — one box for the map and the globe', () => {
  const TALL = { width: W, height: H, aspect: W / 520 }
  it('CRITICAL: the world view is the whole map, centred, with bands above and below', () => {
    const v = worldView(TALL)
    expect(v.w).toBe(W)
    expect(v.h).toBeCloseTo(520, 6)
    expect(v.x).toBe(0)
    expect(v.y).toBeCloseTo((H - 520) / 2, 6)
  })
  it('CRITICAL: zoomed in, the window fills the frame and stays inside the map — no bands once the map is taller than the frame', () => {
    const v = zoomView(worldView(TALL), 3, pt(360, 180), TALL)
    expect(v.w / v.h).toBeCloseTo(W / 520, 6)
    expect(v.y).toBeGreaterThanOrEqual(0)
    expect(v.y + v.h).toBeLessThanOrEqual(H)
    const edge = panView(v, 0, -9999, TALL)
    expect(edge.y).toBe(0)
  })
  it('the opening fit keeps the frame\'s shape, and is centred on the audience in BOTH directions', () => {
    const v = fitView([pt(120, 110), pt(200, 100), pt(180, 150)], TALL)
    expect(v.w / v.h).toBeCloseTo(W / 520, 6)
    const mid = fitView([pt(300, 160), pt(420, 200)], TALL) // well inside the map: nothing to clamp
    expect(mid.x + mid.w / 2).toBeCloseTo(360, 6)
    expect(mid.y + mid.h / 2).toBeCloseTo(180, 6)
  })
  it('CRITICAL: zooming all the way out lands on the world view — bands centred, not stacked at the top', () => {
    const v = zoomView(fitView([pt(120, 110)], TALL), 0.001, pt(120, 110), TALL)
    expect(v).toEqual(worldView(TALL))
  })
})

describe('fitWindow — a window set for one shape, shown in another', () => {
  const us = { x: 100, y: 60, w: 240, h: 143.5 } // a country's frame, set in the map's own 720 × 430 shape
  const see = (outer: View, inner: View) => {
    expect(outer.x).toBeLessThanOrEqual(inner.x + 1e-9)
    expect(outer.y).toBeLessThanOrEqual(inner.y + 1e-9)
    expect(outer.x + outer.w).toBeGreaterThanOrEqual(inner.x + inner.w - 1e-9)
    expect(outer.y + outer.h).toBeGreaterThanOrEqual(inner.y + inner.h - 1e-9)
  }
  it('CRITICAL: in a WIDER box all of the window stays in view, centred on it — keeping its corner and re-cutting the height cropped the bottom of a tall country', () => {
    const b = { width: 720, height: 430, aspect: 2 }
    const v = fitWindow(us, b)
    expect(v.w / v.h).toBeCloseTo(2, 6)
    see(v, us)
    expect(v.x + v.w / 2).toBeCloseTo(us.x + us.w / 2, 6)
    expect(v.y + v.h / 2).toBeCloseTo(us.y + us.h / 2, 6)
  })
  it('CRITICAL: in a TALLER box too', () => {
    const b = { width: 720, height: 430, aspect: 1 }
    const v = fitWindow(us, b)
    expect(v.w / v.h).toBeCloseTo(1, 6)
    see(v, us)
    expect(v.x + v.w / 2).toBeCloseTo(us.x + us.w / 2, 6)
  })
  it('a window already in the box\'s shape is unchanged, and none is deeper than K_MAX', () => {
    const b = { width: 720, height: 360 }
    expect(fitWindow({ x: 350, y: 70, w: 72, h: 36 }, b)).toEqual({ x: 350, y: 70, w: 72, h: 36 })
    expect(W / fitWindow({ x: 350, y: 70, w: 10, h: 5 }, b).w).toBeCloseTo(K_MAX, 6)
  })
})
