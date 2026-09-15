/**
 * MAJOR CITIES — where the audience is, in the shape a tour is planned in (Sam, 2026-09-14: "focus on
 * major cities that Skeen has a following in so he can have a better idea of where he should tour").
 * Pure and server-side: the city list never reaches the browser.
 *
 * The anchors are src/data/major-cities.json (scripts/build-major-cities.ts; the rules are in
 * lib/geo-distance.ts). A visitor counts toward the NEAREST anchor in their own country within
 * MAJOR_CITY_RADIUS_MI — but only a visitor placed in a CITY: a country- or state-level point is a
 * centroid, not a person near a city, and goes to "Other places". A city the door placed before it
 * stored points (2026-09-14) is matched by name, and by state where one is given, so Portland, Oregon is
 * not Portland, Maine, and Philadelphia, Ohio is nobody's. Whatever no anchor reaches is its country's
 * "Other places", so a country's major cities plus its Other places are exactly its visitors.
 */
import majorCitiesData from '@/data/major-cities.json'
import type { PlaceRow } from './analytics'
import type { Tally } from './analytics-places'
import { MAJOR_CITY_RADIUS_MI, milesBetween } from './geo-distance'

export type Anchor = { name: string; region: string; country: string; lat: number; lon: number; pop: number }
export type MajorCity = { key: string; name: string; region: string; country: string; lat: number; lon: number; visitors: number; views: number }
export type MajorCities = { majorCities: MajorCity[]; other: Record<string, Tally> }

export const ANCHORS: Anchor[] = (majorCitiesData as [string, string, string, number, number, number][])
  .map(([name, region, country, lat, lon, pop]) => ({ name, region, country, lat, lon, pop }))

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** The anchors by country, and by country + normalised name — built once for the real list. */
type Index = { byCountry: Map<string, Anchor[]>; byName: Map<string, Anchor[]> }
function indexOf(anchors: Anchor[]): Index {
  const byCountry = new Map<string, Anchor[]>()
  const byName = new Map<string, Anchor[]>()
  const add = (m: Map<string, Anchor[]>, k: string, a: Anchor) => {
    const list = m.get(k)
    if (list) list.push(a)
    else m.set(k, [a])
  }
  for (const a of anchors) {
    add(byCountry, a.country, a)
    add(byName, `${a.country}|${norm(a.name)}`, a)
  }
  return { byCountry, byName }
}
const ANCHOR_INDEX = indexOf(ANCHORS)

export function majorCitiesOf(places: PlaceRow[], anchors: Anchor[] = ANCHORS): MajorCities {
  const index = anchors === ANCHORS ? ANCHOR_INDEX : indexOf(anchors)
  const found = new Map<Anchor, MajorCity>()
  const other: Record<string, Tally> = {}
  for (const p of places) {
    if (!p.country) continue // Not located: the list's own row, not a place
    const anchor = !norm(p.city)
      ? null
      : p.lat !== null && p.lon !== null
        ? nearest(index.byCountry.get(p.country) ?? [], p.lat, p.lon)
        : byName(index, p.country, p.city, p.region)
    if (!anchor) {
      const o = (other[p.country] ??= { visitors: 0, views: 0 })
      o.visitors += p.visitors
      o.views += p.views
      continue
    }
    const m = found.get(anchor) ?? { key: `${anchor.country}|${anchor.region}|${anchor.name}`, name: anchor.name, region: anchor.region, country: anchor.country, lat: anchor.lat, lon: anchor.lon, visitors: 0, views: 0 }
    m.visitors += p.visitors
    m.views += p.views
    found.set(anchor, m)
  }
  const majorCities = [...found.values()].sort((x, y) => y.visitors - x.visitors || y.views - x.views || x.name.localeCompare(y.name))
  return { majorCities, other }
}

function nearest(anchors: Anchor[], lat: number, lon: number): Anchor | null {
  let best: Anchor | null = null
  let bestMi = MAJOR_CITY_RADIUS_MI
  for (const a of anchors) {
    const mi = milesBetween(lat, lon, a.lat, a.lon)
    if (mi <= bestMi) { best = a; bestMi = mi }
  }
  return best
}

/** A city with no point: the anchor of that name in its state; with no state, the only anchor of that name. */
function byName(index: Index, country: string, city: string, region: string): Anchor | null {
  const named = index.byName.get(`${country}|${norm(city)}`) ?? []
  if (named.length === 0) return null
  if (norm(region)) return named.find((a) => norm(a.region) === norm(region)) ?? null
  return named.length === 1 ? named[0] : null
}
