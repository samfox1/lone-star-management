/**
 * WHERE THEY ARE — the per-artist map data (ANALYTICS_PAGE_PLAN.md, places). Pure and server-side; it
 * reaches the city list, so a client component may import its TYPES only (client-imports.test.ts).
 *
 * Only what varies per artist. The geography — countries, lines, lakes — is the same for everyone: it
 * is baked by scripts/build-map-data.ts into files the browser loads once, where it used to ride in
 * every page's props (~570 KB a request).
 *
 * POINTS: each visitor city the door placed, on the flat map (Mercator, lib/map-projection.ts, the
 * latitude held inside the frame so a pole cannot become Infinity), with its real lon/lat for the globe
 * and a warmth for the heat (0..1: a square root of its visitors, with a floor so one visitor shows).
 *
 * COUNTRIES: every located country with the totals the list shows (lib/analytics-places.ts), how many
 * major cities it has, and a frame — its largest landmass from country-frames.json, or its own points
 * where the atlas has no shape — with that landmass's centre for the globe. A country with neither has
 * no frame, and the views fall back to the world and the audience.
 *
 * MAJOR CITIES (lib/analytics-major-cities.ts): the dots and the list inside a country.
 */
import frames from '@/data/country-frames.json'
import type { PlaceRow } from './analytics'
import { countryTotals, type Tally } from './analytics-places'
import { majorCitiesOf, type MajorCity } from './analytics-major-cities'
import { MAJOR_CITY_RADIUS_MI } from './geo-distance'
import { MAP_H, MAP_W } from './map-constants'
import { projectFlat } from './map-projection'
import { boxOf, fitBox, type Bounds, type Box, type View } from './map-view'

/** The least a one-visitor city glows. */
export const HEAT_FLOOR = 0.25
/** The deepest a country frame goes. */
export const COUNTRY_K_MAX = 6
/** Room around a country: a little, so the country IS the frame. */
const COUNTRY_PAD = 0.12
const BOUNDS: Bounds = { width: MAP_W, height: MAP_H, aspect: MAP_W / MAP_H }
const FRAMES = frames as unknown as Record<string, { box: Box; centroid: [number, number] }>

export type MapPoint = { key: string; country: string; visitors: number; views: number; x: number; y: number; lon: number; lat: number; heat: number }
/** A major city with an audience, placed on the flat map (`x`, `y`); the globe projects `lon` / `lat` itself. */
export type MajorCityDot = MajorCity & { x: number; y: number }
/** A located country: the list's totals, its major-city count, and — when it can have one — its frame and centre. */
export type CountryFocus = { code: string; name: string; visitors: number; views: number; majorCities: number; view: View | null; centroid: [number, number] | null }
export type WorldMapData = {
  /** The flat map's extent, which the views' windows are clamped to. */
  frame: { width: number; height: number }
  points: MapPoint[]
  /** Every country's major cities with an audience, most visitors first. */
  majorCities: MajorCityDot[]
  /** Visitors no major city reaches, by country. */
  other: Record<string, Tally>
  /** How far a major city reaches, for the note under the list. */
  radiusMi: number
  countries: CountryFocus[]
  /** Visitors in no country. */
  unlocated: Tally | null
}

export function worldMap(places: PlaceRow[]): WorldMapData {
  const placed = places.filter((p) => p.country && p.lat !== null && p.lon !== null)
  const max = placed.reduce((m, p) => Math.max(m, p.visitors), 1)
  const points: MapPoint[] = placed.map((p) => {
    const lon = p.lon as number
    const lat = p.lat as number
    const [x, y] = projectFlat(lon, lat)
    return { key: `${p.country}|${p.region}|${p.city}`, country: p.country, visitors: p.visitors, views: p.views, x, y, lon, lat, heat: HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.sqrt(p.visitors / max) }
  })
  const pointsIn = new Map<string, MapPoint[]>()
  for (const p of points) {
    const list = pointsIn.get(p.country)
    if (list) list.push(p)
    else pointsIn.set(p.country, [p])
  }

  const { majorCities, other } = majorCitiesOf(places)
  const citiesIn = new Map<string, number>()
  for (const m of majorCities) citiesIn.set(m.country, (citiesIn.get(m.country) ?? 0) + 1)

  const { countries: totals, unlocated } = countryTotals(places)
  const countries: CountryFocus[] = totals.map((t) => {
    const frame = FRAMES[t.code]
    const pts = pointsIn.get(t.code) ?? []
    const box = frame?.box ?? (pts.length ? boxOf(pts) : null)
    const centroid: [number, number] | null = frame?.centroid ?? (pts.length ? [pts.reduce((n, p) => n + p.lon, 0) / pts.length, pts.reduce((n, p) => n + p.lat, 0) / pts.length] : null)
    return { ...t, majorCities: citiesIn.get(t.code) ?? 0, view: box ? fitBox(box, BOUNDS, COUNTRY_K_MAX, COUNTRY_PAD) : null, centroid }
  })

  const dots: MajorCityDot[] = majorCities.map((m) => {
    const [x, y] = projectFlat(m.lon, m.lat)
    return { ...m, x, y }
  })

  return { frame: { width: MAP_W, height: MAP_H }, points, majorCities: dots, other, radiusMi: MAJOR_CITY_RADIUS_MI, countries, unlocated }
}
