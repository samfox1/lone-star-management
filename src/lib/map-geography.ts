/**
 * The shapes of the baked geography (scripts/build-map-data.ts): the same for every artist, so it is
 * built once, shipped as its own files and loaded by the browser, never sent in a page's props.
 * Types only, safe for client components.
 */
import type { ExtendedFeatureCollection, GeoGeometryObjects } from 'd3-geo'

/** The flat map, already projected (Mercator, lib/map-projection.ts) into SVG paths at a tenth of a map unit. */
export type FlatGeography = {
  /** Each country's land, keyed by ISO alpha-2 ('' where the atlas has no code). A code can appear twice. */
  lands: { code: string; d: string }[]
  lakes: string
  borders: string
  /** The US state lines, faded in as the map zooms. */
  states: string
}

/** The globe, as GeoJSON: a turn of the globe is a new projection, so the browser projects it. */
export type GlobeGeography = {
  lands: { code: string; geometry: GeoGeometryObjects }[]
  lakes: ExtendedFeatureCollection
  borders: GeoGeometryObjects
}
