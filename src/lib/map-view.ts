/**
 * The map's window (Sam, 2026-09-14: "a simple way to zoom and move — an artist from
 * the US is focusing on US cities, not a global presence"). A view is a rectangle in
 * map units, the SVG's viewBox; the frame's aspect is kept, it never shows outside the
 * map, and it is never smaller than the map lets it be. Pure, so every rule is pinned.
 *
 * Opening view: the audience's bounding box with room around it, zoomed no further than
 * FIT_K_MAX — one city is not a reason to fill the frame with a suburb. The user can
 * go to K_MAX by hand.
 */
export type View = { x: number; y: number; w: number; h: number }
/** The map's extent, and (optionally) the FRAME's shape as width ÷ height when it differs from the map's —
 *  a taller frame letterboxes the world view and fills with anything closer (Sam, 2026-09-14: one box for map and globe). */
export type Bounds = { width: number; height: number; aspect?: number }
export type Point = { x: number; y: number }
export type Box = { minX: number; maxX: number; minY: number; maxY: number }

/** The deepest zoom the map OPENS at; the deepest the user can reach by hand. */
export const FIT_K_MAX = 4
export const K_MAX = 10
/** Room around the audience, as a share of its extent on each side. */
const FIT_PAD = 0.35

const aspectOf = (b: Bounds) => b.aspect ?? b.width / b.height

/** The smallest window in the frame's shape that shows the whole map, centred: bands where the frame is taller or wider. */
export function worldView(b: Bounds): View {
  const aspect = aspectOf(b)
  const w = Math.max(b.width, b.height * aspect)
  const h = w / aspect
  return { x: (b.width - w) / 2, y: (b.height - h) / 2, w, h }
}

/** The frame's shape, no wider than the world view, no deeper than K_MAX; inside the map where it fits, centred where it does not. */
export function clampView(v: View, b: Bounds): View {
  const aspect = aspectOf(b)
  const world = worldView(b)
  const w = Math.min(Math.max(v.w, b.width / K_MAX), world.w)
  const h = w / aspect
  const x = w >= b.width ? (b.width - w) / 2 : Math.min(Math.max(v.x, 0), b.width - w)
  const y = h >= b.height ? (b.height - h) / 2 : Math.min(Math.max(v.y, 0), b.height - h)
  return { x, y, w, h }
}

/** Centre the frame on (cx, cy) at width w. */
function around(cx: number, cy: number, w: number, b: Bounds): View {
  const h = w / aspectOf(b)
  return clampView({ x: cx - w / 2, y: cy - h / 2, w, h }, b)
}

/** Frame a box with room around it (`pad` of its extent each side), centred, no deeper than `kMax`. */
export function fitBox(box: Box, b: Bounds, kMax: number, pad = FIT_PAD): View {
  const aspect = aspectOf(b)
  const spanW = (box.maxX - box.minX) * (1 + 2 * pad)
  const spanH = (box.maxY - box.minY) * (1 + 2 * pad)
  // Wide enough for the box in both directions, and no deeper than the cap.
  const w = Math.max(spanW, spanH * aspect, b.width / kMax)
  return around((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, w, b)
}

export function boxOf(points: Point[]): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** The opening view: the audience's box, no deeper than FIT_K_MAX. */
export function fitView(points: Point[], b: Bounds): View {
  if (points.length === 0) return worldView(b)
  return fitBox(boxOf(points), b, FIT_K_MAX)
}

/** A window set for one shape, shown in another (a country's frame, set in the map's shape, shown in the
 *  box's): all of it in view, centred on it, no deeper than K_MAX. Keeping its corner and re-cutting the
 *  other side, which is all clampView does, cropped the bottom of a tall country. */
export function fitWindow(v: View, b: Bounds): View {
  return fitBox({ minX: v.x, maxX: v.x + v.w, minY: v.y, maxY: v.y + v.h }, b, K_MAX, 0)
}

/** Scale the window by `factor` about `at` (a map point): what was under the pointer stays there. */
export function zoomView(v: View, factor: number, at: Point, b: Bounds): View {
  const w = v.w / factor
  const h = v.h / factor
  const fx = (at.x - v.x) / v.w
  const fy = (at.y - v.y) / v.h
  return clampView({ x: at.x - fx * w, y: at.y - fy * h, w, h }, b)
}

export function panView(v: View, dx: number, dy: number, b: Bounds): View {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, b)
}

/** 0 up to `from`, 1 from `to`, a straight climb between: a layer that appears as the map zooms. */
export function fadeIn(k: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (k - from) / (to - from)))
}

/** The closest point within `reach` of `at` (a distance, not a box); null when none is. Ties go to the first. */
export function nearestPoint<P extends Point>(points: P[], at: Point, reach: number): P | null {
  let best: P | null = null
  let bestD = reach * reach
  for (const p of points) {
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2
    if (d < bestD) { best = p; bestD = d }
  }
  return best
}
