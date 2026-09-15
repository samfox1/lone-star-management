/**
 * Bakes the Analytics page's geography. Natural Earth, public domain.
 *
 *   npx tsx scripts/build-map-data.ts <ne_50m_admin_1_states_provinces_lines.geojson> <ne_50m_lakes.geojson>
 *
 * The geography is the same for every artist and every request, so it is baked here and loaded by the
 * browser once, as long-cached chunks — never sent in a page's props (it was ~570 KB a request). Three
 * files in src/data:
 *
 *   map-flat.json        the flat map (Mercator, lib/map-projection.ts) as SVG paths rounded to a tenth of
 *                        a map unit: each country at 1:50m, simplified to KEEP_QUANTILE of its points with
 *                        topology kept so neighbours share one border; the lines between countries, meshed
 *                        from the same topology so they line up; the US state lines; lakes of at least
 *                        MIN_LAKE_KM2.
 *   map-globe.json       the globe, which projects in the browser: 1:110m countries and borders (small on
 *                        screen, light to ship) and the same lakes, as GeoJSON rounded to two decimals.
 *   country-frames.json  per country, the flat-map box and the sphere centre of its LARGEST landmass — so
 *                        the US frame is the lower 48 and Norway's is not Svalbard. A landmass across the
 *                        antimeridian (Russia) is boxed on the side holding most of it. The build FAILS on
 *                        an inside-out ring or a frame wider than half the map; a data test checks both.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { geoArea, geoCentroid, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import { presimplify, quantile, simplify } from 'topojson-simplify'
import iso from 'i18n-iso-countries'
import { MAP_W } from '../src/lib/map-constants'
import { flatProjection } from '../src/lib/map-projection'

const KEEP_QUANTILE = 0.3
const MIN_LAKE_KM2 = 10_000
const ANTARCTICA = '010'
const EARTH_R_KM = 6371

type Geometry = { type: string; coordinates: unknown }
type Ring = number[][]
type PolygonCoords = Ring[]
type Fc = { features: { properties: Record<string, unknown>; geometry: Geometry }[] }
type Box = { minX: number; maxX: number; minY: number; maxY: number }

const rounder = (digits: number) => {
  const f = 10 ** digits
  const r = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * f) / f : Array.isArray(v) ? v.map(r) : v)
  return r
}
const round1 = rounder(1)
const round2 = rounder(2)
const codeOf = (id: unknown) => iso.numericToAlpha2(String(id).padStart(3, '0')) ?? ''
const polygonsOf = (g: Geometry): PolygonCoords[] => (g.type === 'Polygon' ? [g.coordinates as PolygonCoords] : (g.coordinates as PolygonCoords[]))
const path = geoPath(flatProjection).digits(1)
const d = (g: unknown) => path(g as never) ?? ''

/** The flat-map box of a landmass. One that crosses the antimeridian is drawn at both edges of the
 *  map, so its bounds span the world; box the side holding most of its outline instead. */
function boxOfLandmass(coordinates: PolygonCoords): Box {
  const [[x0, y0], [x1, y1]] = path.bounds({ type: 'Polygon', coordinates } as never)
  if (x1 - x0 <= MAP_W / 2) return { minX: x0, maxX: x1, minY: y0, maxY: y1 }
  const outer = coordinates[0]
  const east = outer.filter(([lon]) => lon >= 0)
  const west = outer.filter(([lon]) => lon < 0)
  const side = east.length >= west.length ? east : west
  const xy = side.map(([lon, lat]) => flatProjection([lon, lat])!)
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

function main() {
  const [statesPath, lakesPath] = process.argv.slice(2)
  if (!statesPath || !lakesPath) throw new Error('usage: build-map-data.ts <states-lines-50m.geojson> <lakes-50m.geojson>')
  const require = createRequire(import.meta.url)

  // ── the flat map, 1:50m simplified with its topology kept
  const pre = presimplify(JSON.parse(JSON.stringify(require('world-atlas/countries-50m.json'))))
  const topo50 = simplify(pre, quantile(pre, KEEP_QUANTILE))
  const geoms50 = (topo50.objects.countries as unknown as { geometries: { id?: string }[] }).geometries.filter((g) => String(g.id) !== ANTARCTICA)
  const lands50 = geoms50.map((g) => ({ code: codeOf(g.id), geometry: (feature(topo50, g as never) as unknown as { geometry: Geometry }).geometry }))
  const borders50 = mesh(topo50, topo50.objects.countries as never, (a: unknown, b: unknown) => a !== b)
  // Coastlines: every edge no two countries share, from the SAME topology so they meet the borders exactly.
  // Antarctica is left out of the collection, so its coast is not drawn along the bottom of the map.
  const coasts50 = mesh(topo50, { type: 'GeometryCollection', geometries: geoms50 } as never, (a: unknown, b: unknown) => a === b)

  const states = JSON.parse(readFileSync(statesPath, 'utf8')) as Fc
  const usStates = { type: 'FeatureCollection', features: states.features.filter((f) => (f.properties.ADM0_A3 ?? f.properties.adm0_a3) === 'USA').map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })) }
  const lakesIn = JSON.parse(readFileSync(lakesPath, 'utf8')) as Fc
  const lakes = {
    type: 'FeatureCollection' as const,
    features: lakesIn.features
      .filter((f) => geoArea(f as never) * EARTH_R_KM * EARTH_R_KM >= MIN_LAKE_KM2)
      .map((f) => ({ type: 'Feature' as const, properties: { name: f.properties.name }, geometry: { type: f.geometry.type, coordinates: round2(f.geometry.coordinates) } })),
  }

  const flat = { lands: lands50.map((l) => ({ code: l.code, d: d(l.geometry) })), lakes: d(lakes), coasts: d(coasts50), borders: d(borders50), states: d(usStates) }
  writeFileSync('src/data/map-flat.json', JSON.stringify(flat) + '\n')

  // ── the globe, 1:110m
  const atlas110 = require('world-atlas/countries-110m.json')
  const geoms110 = (atlas110.objects.countries.geometries as { id?: string }[]).filter((g) => String(g.id) !== ANTARCTICA)
  const globe = {
    lands: geoms110.map((g) => {
      const f = feature(atlas110, g as never) as unknown as { geometry: Geometry }
      return { code: codeOf(g.id), geometry: { type: f.geometry.type, coordinates: round2(f.geometry.coordinates) } }
    }),
    lakes,
    coasts: { type: 'MultiLineString', coordinates: round2((mesh(atlas110, { type: 'GeometryCollection', geometries: geoms110 } as never, (a: unknown, b: unknown) => a === b) as unknown as Geometry).coordinates) },
    borders: { type: 'MultiLineString', coordinates: round2((mesh(atlas110, atlas110.objects.countries, (a: unknown, b: unknown) => a !== b) as unknown as Geometry).coordinates) },
    // The US state lines, as on the flat map (Sam, 2026-09-15: "US state lines on globe view").
    states: { type: 'MultiLineString', coordinates: round2((usStates.features as { geometry: { type: string; coordinates: unknown } }[]).flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : (f.geometry.coordinates as unknown[])))) },
  }
  writeFileSync('src/data/map-globe.json', JSON.stringify(globe) + '\n')

  // ── each country's frame: its largest landmass
  const frames: Record<string, { box: Box; centroid: [number, number] }> = {}
  const areas: Record<string, number> = {}
  for (const l of lands50) {
    if (!l.code) continue
    for (const coordinates of polygonsOf(l.geometry)) {
      const area = geoArea({ type: 'Polygon', coordinates } as never)
      if (area > 2 * Math.PI) throw new Error(`${l.code}: an inside-out ring (${area.toFixed(2)} sr)`)
      if (areas[l.code] !== undefined && area <= areas[l.code]) continue
      areas[l.code] = area
      const box = boxOfLandmass(coordinates)
      const [clon, clat] = geoCentroid({ type: 'Polygon', coordinates } as never)
      frames[l.code] = { box: { minX: round1(box.minX) as number, maxX: round1(box.maxX) as number, minY: round1(box.minY) as number, maxY: round1(box.maxY) as number }, centroid: round2([clon, clat]) as [number, number] }
    }
  }
  for (const [code, f] of Object.entries(frames)) {
    if (f.box.maxX - f.box.minX > MAP_W / 2) throw new Error(`${code}: a frame wider than half the map`)
  }
  writeFileSync('src/data/country-frames.json', JSON.stringify(frames) + '\n')

  const kb = (o: unknown) => `${Math.round(JSON.stringify(o).length / 1024)} KB`
  console.log(`flat ${kb(flat)} (${flat.lands.length} countries) · globe ${kb(globe)} · frames ${Object.keys(frames).length} (${kb(frames)})`)
}

main()
