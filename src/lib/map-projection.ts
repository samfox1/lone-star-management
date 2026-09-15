/**
 * The flat map's projection: Mercator at MAP_W, the north edge at LAT_TOP. Used where d3 belongs —
 * the server (lib/analytics-map.ts) and the data builder (scripts/build-map-data.ts) — so a visitor's
 * point and the coastline under it are always drawn by the same numbers.
 */
import { geoMercator } from 'd3-geo'
import { LAT_BOTTOM, LAT_TOP, MAP_W } from './map-constants'

export const flatProjection = geoMercator().scale(MAP_W / (2 * Math.PI)).translate([MAP_W / 2, 0])
flatProjection.translate([MAP_W / 2, -flatProjection([0, LAT_TOP])![1]])

/** A place on the flat map, its latitude held inside the frame so a pole cannot become Infinity. */
export function projectFlat(lon: number, lat: number): [number, number] {
  return flatProjection([lon, Math.min(LAT_TOP, Math.max(LAT_BOTTOM, lat))]) as [number, number]
}
