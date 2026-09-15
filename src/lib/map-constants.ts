/**
 * The map's fixed numbers — plain arithmetic, no d3 and no data — so both views, the server and the
 * data builder read the same ones. lib/analytics-map.ts carries the city list and must never be
 * imported by a client component; tests/unit/analytics/client-imports.test.ts holds that line.
 */
/** The flat map's width, in map units. */
export const MAP_W = 720
/** Its latitude range: Mercator runs to infinity at the poles, so it stops here. Antarctica is below it. */
export const LAT_TOP = 80
export const LAT_BOTTOM = -60
const R = MAP_W / (2 * Math.PI)
const mercatorY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
/** Its height: the Mercator extent from LAT_TOP to LAT_BOTTOM at MAP_W. */
export const MAP_H = mercatorY(LAT_TOP) - mercatorY(LAT_BOTTOM)
/** The heat glow under a city, in screen px — and how near the pointer must be to a major city's dot to read it. */
export const HEAT_R = 16
/** The dot on each major city inside a country, in screen px. */
export const DOT_R = 2
