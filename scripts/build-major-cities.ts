/**
 * Builds src/data/major-cities.json — the anchors the Analytics page groups visitors under
 * (lib/analytics-major-cities.ts). Source: Natural Earth 1:10m populated places (public domain).
 *
 *   npx tsx scripts/build-major-cities.ts [path-to-ne_10m_populated_places_simple.geojson]
 *
 * With no path it downloads the file. A city is MAJOR at MAJOR_CITY_MIN_POP metro population. Biggest
 * first, one is dropped when a bigger city IN THE SAME COUNTRY sits within MAJOR_CITY_RADIUS_MI, so each
 * anchor is a distinct major city: New York keeps Newark and Stamford, Washington keeps Baltimore, and
 * Tijuana stays Mexico's though San Diego is minutes away. The rules and the distance formula come from
 * lib/geo-distance.ts, which the page uses too, and distances are compared on the coordinates AS WRITTEN
 * (rounded to 2dp) — comparing full precision let two anchors land 49.996 miles apart.
 *
 * Output rows: [name, region, country (ISO alpha-2), lat, lon, population].
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { MAJOR_CITY_MIN_POP, MAJOR_CITY_RADIUS_MI, milesBetween } from '../src/lib/geo-distance'

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson'

type Props = { name: string; adm1name: string | null; iso_a2: string; latitude: number; longitude: number; pop_max: number }

async function main() {
  const path = process.argv[2]
  const text = path ? readFileSync(path, 'utf8') : await (await fetch(SOURCE)).text()
  const places = (JSON.parse(text) as { features: { properties: Props }[] }).features.map((f) => f.properties)
  const candidates = places
    .filter((p) => p.pop_max >= MAJOR_CITY_MIN_POP && /^[A-Z]{2}$/.test(p.iso_a2))
    .sort((a, b) => b.pop_max - a.pop_max)
  const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
  const anchors: [string, string, string, number, number, number][] = []
  for (const c of candidates) {
    const lat = +c.latitude.toFixed(2)
    const lon = +c.longitude.toFixed(2)
    if (anchors.some(([, , iso, aLat, aLon]) => iso === c.iso_a2 && milesBetween(aLat, aLon, lat, lon) <= MAJOR_CITY_RADIUS_MI)) continue
    anchors.push([clean(c.name), clean(c.adm1name), c.iso_a2, lat, lon, c.pop_max])
  }
  writeFileSync('src/data/major-cities.json', JSON.stringify(anchors) + '\n')
  console.log(`major cities: ${anchors.length} anchors from ${candidates.length} candidates (>= ${MAJOR_CITY_MIN_POP}, ${MAJOR_CITY_RADIUS_MI} mi)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
