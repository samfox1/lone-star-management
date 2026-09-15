/**
 * The globe's arithmetic (Sam, 2026-09-14: "a globe, shaped like the earth, that I can
 * click through"). The projection is d3's orthographic; this is everything around it:
 * which side the globe opens on, how a drag turns it, which cities are on the near
 * side, how far it zooms. Pure, so every rule is pinned.
 */
import { geoDistance, geoOrthographic } from 'd3-geo'

/** d3's rotate: [λ, φ] in degrees. The point faced is [-λ, -φ]. */
export type Rotation = [number, number]

export const SCALE_MIN = 1
export const SCALE_MAX = 6
/** Degrees of turn per pixel dragged, at scale 1. */
const DRAG_DEG_PER_PX = 0.25
/** How far the globe tilts toward a pole before it stops. */
const TILT_MAX = 80
/** Where a globe with no audience faces: the prime meridian, a temperate latitude. */
const DEFAULT_FACE: [number, number] = [0, 20]

const rad = Math.PI / 180
const deg = 180 / Math.PI

/**
 * The point the audience is centred on, as a real place on the sphere: each city as a
 * unit vector weighted by its visitors, summed, and turned back into lon/lat. A mean of
 * longitudes would put Tokyo + Los Angeles in Africa.
 */
export function faceOf(points: { lon: number; lat: number; visitors: number }[]): [number, number] {
  let x = 0, y = 0, z = 0
  for (const p of points) {
    const w = Math.max(0, p.visitors)
    const la = p.lat * rad, lo = p.lon * rad
    x += w * Math.cos(la) * Math.cos(lo)
    y += w * Math.cos(la) * Math.sin(lo)
    z += w * Math.sin(la)
  }
  const len = Math.hypot(x, y, z)
  if (len === 0) return DEFAULT_FACE
  return [Math.atan2(y, x) * deg, Math.asin(z / len) * deg]
}

export function rotationTo(face: [number, number]): Rotation {
  return [-face[0], -face[1]]
}

const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

/** Turn the globe by a drag of (dx, dy) screen px: the land follows the pointer, less per px when zoomed in. */
export function dragRotate(r: Rotation, dx: number, dy: number, scale: number): Rotation {
  const s = DRAG_DEG_PER_PX / Math.max(scale, 1e-6)
  const lam = wrap(r[0] + dx * s)
  const phi = Math.min(TILT_MAX, Math.max(-TILT_MAX, r[1] - dy * s))
  return [lam, phi]
}

/** On the hemisphere the globe shows (the limb inclusive). */
export function isNearSide(point: [number, number], r: Rotation): boolean {
  return geoDistance(point, [-r[0], -r[1]]) <= Math.PI / 2 + 1e-9
}

export function zoomScale(scale: number, factor: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * factor))
}

/** The globe's frame is this many viewBox units TALL; its width is that times the box's aspect. */
export const GLOBE_SIZE = 520
/** Air between the sphere at scale 1 and the frame's top and bottom, in viewBox units. */
export const GLOBE_GAP = 12

/** The frame's width for a box of this aspect (width ÷ height). */
export const globeWidth = (aspect: number) => GLOBE_SIZE * aspect

/**
 * d3's orthographic projection for a rotation and zoom, centred in a frame of the box's
 * shape (Sam, 2026-09-14: a square frame inside a wide box cropped the zoomed sphere at
 * the square's sides), the far side clipped. At scale 1 the sphere is the frame's height
 * less the gap; zoomed, it runs out to the box's own edge.
 */
export function globeProjection(r: Rotation, scale: number, aspect = 1) {
  return geoOrthographic()
    .rotate([r[0], r[1]])
    .scale((GLOBE_SIZE / 2 - GLOBE_GAP) * scale)
    .translate([globeWidth(aspect) / 2, GLOBE_SIZE / 2])
    .clipAngle(90)
}
