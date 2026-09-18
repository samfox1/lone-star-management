/**
 * A coordinate value shared by the provider clients (bandsintown.ts, ticketmaster.ts):
 * both APIs send lat/lng as strings, and both need the same guard against the
 * `Number('') === 0` footgun, so a missing coordinate never becomes 0,0 on the tour map.
 */

/** Parse a coordinate (an API sends lat/lng as strings); blank/non-numeric → null. */
export function coord(v: string | number | undefined): number | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
