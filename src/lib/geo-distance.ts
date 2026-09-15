/**
 * Great-circle distance, and the rules that make a city "major" (Sam, 2026-09-14). One module the
 * page (lib/analytics-major-cities.ts) and the data builder (scripts/build-major-cities.ts) both
 * import, so the radius the anchors were built with is the radius visitors are counted with.
 */
export const EARTH_R_MI = 3958.8
/** A major city has at least this many people. */
export const MAJOR_CITY_MIN_POP = 250_000
/** How far a major city reaches — the note under the list says so. */
export const MAJOR_CITY_RADIUS_MI = 50

/** Great-circle miles between two places; across the antimeridian, the short way. */
export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const t = Math.PI / 180
  const s = Math.sin(((bLat - aLat) * t) / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(((bLon - aLon) * t) / 2) ** 2
  return 2 * EARTH_R_MI * Math.asin(Math.sqrt(Math.min(1, s)))
}
