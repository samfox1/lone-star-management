// The Analytics page's per-artist map data: where each visitor city lands on the flat map
// (Mercator), how warm it glows, which countries the list and the map both show and how each is
// framed, and the major cities inside them. The geography itself is not here: it is baked by
// scripts/build-map-data.ts and loaded by the browser once (map-geography-data.test.ts).
import { describe, expect, it } from 'vitest'
import { geoMercator } from 'd3-geo'
import { HEAT_FLOOR, worldMap } from '@/lib/analytics-map'
import { LAT_BOTTOM, LAT_TOP, MAP_H, MAP_W } from '@/lib/map-constants'
import { MAJOR_CITY_RADIUS_MI } from '@/lib/geo-distance'
import { countryTotals } from '@/lib/analytics-places'
import type { PlaceRow } from '@/lib/analytics'

const place = (country: string, region: string, city: string, visitors: number, lat: number | null, lon: number | null, views = visitors): PlaceRow =>
  ({ country, region, city, visitors, views, lat, lon })

/** Mercator at the map's own scale, top edge at LAT_TOP: the oracle the tests compare against. */
const merc = geoMercator().scale(MAP_W / (2 * Math.PI)).translate([MAP_W / 2, 0])
const yOf = (lat: number) => merc([0, lat])![1] - merc([0, LAT_TOP])![1]
const perDeg = MAP_W / 360
const xOf = (lon: number) => MAP_W / 2 + lon * perDeg

describe('worldMap — where a city lands', () => {
  it('CRITICAL: Mercator — longitude runs straight across, and shapes are TRUE: a degree of longitude at 40°N is cos 40° of a degree of latitude (Sam, 2026-09-14: "not accurate to scale")', () => {
    const { points } = worldMap([
      place('US', 'X', 'A', 1, 40, -100), place('US', 'X', 'B', 1, 40, -99), place('US', 'X', 'C', 1, 41, -100),
      place('GH', '', 'Gulf', 1, 0, 0), place('NO', 'X', 'Top', 1, LAT_TOP, 20), place('CL', 'X', 'Bottom', 1, LAT_BOTTOM, -70),
    ])
    const by = Object.fromEntries(points.map((p) => [p.key, p]))
    expect(by['GH||Gulf'].x).toBeCloseTo(MAP_W / 2, 3)
    expect(by['US|X|B'].x - by['US|X|A'].x).toBeCloseTo(perDeg, 3)
    // Plate carrée would make this 1: the US drawn a third too wide.
    const ratio = (by['US|X|B'].x - by['US|X|A'].x) / (by['US|X|A'].y - by['US|X|C'].y)
    expect(ratio).toBeCloseTo(Math.cos((40.5 * Math.PI) / 180), 2)
    expect(by['US|X|A'].y).toBeCloseTo(yOf(40), 3)
    expect(by['NO|X|Top'].y).toBeCloseTo(0, 3)
    expect(by['CL|X|Bottom'].y).toBeCloseTo(MAP_H, 3)
  })

  it('CRITICAL: MAP_H — worked out without d3, so the browser can have it — is the Mercator extent from LAT_TOP to LAT_BOTTOM', () => {
    expect(MAP_H).toBeCloseTo(yOf(LAT_BOTTOM), 6)
    expect(worldMap([]).frame).toEqual({ width: MAP_W, height: MAP_H })
  })

  it('CRITICAL: a point beyond the frame\'s latitudes is held to its edge — a visitor at the South Pole must not turn the map to NaN', () => {
    const m = worldMap([place('AQ', '', 'Pole', 1, -90, 0), place('US', 'X', 'A', 1, 40, -100), place('NO', 'X', 'Cap', 1, 89.9, 20)])
    for (const p of m.points) {
      expect(Number.isFinite(p.x), p.key).toBe(true)
      expect(Number.isFinite(p.y), p.key).toBe(true)
    }
    const pole = m.points.find((p) => p.key === 'AQ||Pole')!
    expect(pole.y).toBeCloseTo(MAP_H, 3)
    expect(pole.lat).toBe(-90) // the globe still gets the real place
    expect(m.points.find((p) => p.key === 'NO|X|Cap')!.y).toBeCloseTo(0, 3)
  })

  it('CRITICAL: heat follows visitors on a square root — the leader glows fully, a quarter of it half way up from the floor', () => {
    const { points } = worldMap([place('US', 'X', 'A', 100, 10, 10), place('US', 'X', 'B', 25, 20, 20), place('US', 'X', 'C', 1, 30, 30)])
    const by = Object.fromEntries(points.map((p) => [p.key, p.heat]))
    expect(by['US|X|A']).toBe(1)
    expect(by['US|X|B']).toBeCloseTo(HEAT_FLOOR + (1 - HEAT_FLOOR) * 0.5, 6)
    expect(by['US|X|C']).toBeGreaterThanOrEqual(HEAT_FLOOR)
    expect(by['US|X|C']).toBeLessThan(by['US|X|B'])
    expect(HEAT_FLOOR).toBeGreaterThan(0)
    expect(HEAT_FLOOR).toBeLessThan(0.5)
  })

  it('CRITICAL: only a LOCATED place with a POINT is drawn — no country, or no point, or half a point, is not', () => {
    const m = worldMap([place('US', 'X', 'Placed', 3, 10, 10), place('US', 'X', 'Old', 40, null, null), place('US', 'X', 'Half', 2, 10, null), place('', '', '', 9, 5, 5)])
    expect(m.points.map((p) => p.key)).toEqual(['US|X|Placed'])
  })

  it('CRITICAL: carries per-artist data ONLY — no geography rides in the page\'s props (it was ~570 KB on every request)', () => {
    const many = Array.from({ length: 400 }, (_, i) => place('US', 'X', `City ${i}`, i + 1, 25 + (i % 20), -120 + (i % 50)))
    const m = worldMap(many)
    expect(Object.keys(m).sort()).toEqual(['countries', 'frame', 'majorCities', 'other', 'points', 'radiusMi', 'unlocated'])
    expect(JSON.stringify(m).length).toBeLessThan(120_000)
  })
})

describe('worldMap — countries: the list and the map read the SAME ones', () => {
  const audience = [
    place('US', 'Illinois', 'Chicago', 50, 41.8781, -87.6298),
    place('US', 'Alaska', 'Anchorage', 1, 61.2181, -149.9003),
    place('US', 'Arizona', 'Tucson', 40, 32.2226, -110.9747),
    place('US', 'Texas', 'Austin', 7, null, null), // counted, though it has no point
    place('DE', 'Berlin', 'Berlin', 80, 52.52, 13.405),
    place('FR', '', 'Old', 400, null, null), // a country with no map point at all
  ]

  it('CRITICAL: every LOCATED country, with the totals the list counts — a country with no point is still here, and visitors without a point still count (the map said US 78 where the list said 87)', () => {
    const m = worldMap(audience)
    expect(m.countries.map((c) => [c.code, c.name, c.visitors, c.views])).toEqual(countryTotals(audience).countries.map((c) => [c.code, c.name, c.visitors, c.views]))
    expect(m.countries.map((c) => [c.code, c.visitors])).toEqual([['FR', 400], ['US', 98], ['DE', 80]])
  })

  it('CRITICAL: a country with no map point is framed from the atlas all the same — France frames France, and the globe can turn to it', () => {
    const fr = worldMap(audience).countries.find((c) => c.code === 'FR')!
    expect(fr.view).not.toBeNull()
    const paris = { x: xOf(2.35), y: yOf(48.86) }
    expect(paris.x).toBeGreaterThan(fr.view!.x)
    expect(paris.x).toBeLessThan(fr.view!.x + fr.view!.w)
    expect(paris.y).toBeGreaterThan(fr.view!.y)
    expect(paris.y).toBeLessThan(fr.view!.y + fr.view!.h)
    expect(fr.centroid![0]).toBeGreaterThan(0); expect(fr.centroid![0]).toBeLessThan(5) // mainland France, not Guiana
    expect(fr.centroid![1]).toBeGreaterThan(45); expect(fr.centroid![1]).toBeLessThan(48)
  })

  it('each country says how many major cities it has', () => {
    const m = worldMap([place('US', 'New Jersey', 'Newark', 3, 40.7357, -74.1724), place('US', 'Illinois', 'Chicago', 5, 41.88, -87.63), place('DE', 'Berlin', 'Berlin', 2, 52.52, 13.405), place('FR', '', '', 1, null, null)])
    expect(m.countries.map((c) => [c.code, c.majorCities])).toEqual([['US', 2], ['DE', 1], ['FR', 0]])
  })

  it('CRITICAL: a country\'s frame is the country ITSELF, not its cities — the whole of Germany with Berlin east of its middle', () => {
    const de = worldMap(audience).countries.find((c) => c.code === 'DE')!
    const berlin = xOf(13.405)
    expect(berlin).toBeGreaterThan(de.view!.x)
    expect(berlin).toBeLessThan(de.view!.x + de.view!.w)
    expect(berlin - (de.view!.x + de.view!.w / 2)).toBeGreaterThan(3)
  })

  it('CRITICAL: the United States frame is the contiguous states — Alaska would make it a third of the world', () => {
    const us = worldMap(audience).countries.find((c) => c.code === 'US')!
    expect(us.view!.w).toBeLessThan(MAP_W * 0.25)
    expect(xOf(-87.6298)).toBeGreaterThan(us.view!.x)
    expect(xOf(-87.6298)).toBeLessThan(us.view!.x + us.view!.w)
    expect(us.view!.x + us.view!.w / 2).toBeGreaterThan(xOf(-110.9747))
  })

  it('CRITICAL: Russia frames Russia, not the world — its largest landmass crosses the antimeridian', () => {
    const ru = worldMap([place('RU', 'Moscow', 'Moscow', 5, 55.75, 37.62)]).countries[0]
    expect(ru.view!.w).toBeLessThan(MAP_W * 0.75)
    expect(xOf(37.62)).toBeGreaterThan(ru.view!.x)
    expect(xOf(37.62)).toBeLessThan(ru.view!.x + ru.view!.w)
  })

  it('CRITICAL: the frame is the LARGEST landmass — mainland Norway, not Svalbard', () => {
    const no = worldMap([place('NO', 'Oslo', 'Oslo', 5, 59.9139, 10.7522)]).countries[0]
    const oslo = { x: xOf(10.7522), y: yOf(59.9139) }
    expect(oslo.x).toBeGreaterThan(no.view!.x); expect(oslo.x).toBeLessThan(no.view!.x + no.view!.w)
    expect(oslo.y).toBeGreaterThan(no.view!.y); expect(oslo.y).toBeLessThan(no.view!.y + no.view!.h)
  })

  it('CRITICAL: each country carries the centre of its landmass for the globe — Germany near 10°E 51°N, the US on the lower 48', () => {
    const m = worldMap(audience)
    const de = m.countries.find((c) => c.code === 'DE')!
    expect(de.centroid![0]).toBeGreaterThan(8); expect(de.centroid![0]).toBeLessThan(13)
    expect(de.centroid![1]).toBeGreaterThan(49); expect(de.centroid![1]).toBeLessThan(53)
    const us = m.countries.find((c) => c.code === 'US')!
    expect(us.centroid![0]).toBeGreaterThan(-105); expect(us.centroid![0]).toBeLessThan(-90)
    expect(us.centroid![1]).toBeGreaterThan(35); expect(us.centroid![1]).toBeLessThan(45)
  })

  it('a country the atlas does not frame is framed on its own points; with no points either it has no frame, and the views fall back', () => {
    const m = worldMap([place('ZZ', '', 'Somewhere', 9, 1.35, 103.82), place('YY', '', 'Nowhere', 2, null, null)])
    const zz = m.countries.find((c) => c.code === 'ZZ')!
    expect(zz.view!.x + zz.view!.w / 2).toBeCloseTo(m.points[0].x, 3)
    expect(zz.centroid).toEqual([103.82, 1.35])
    const yy = m.countries.find((c) => c.code === 'YY')!
    expect([yy.view, yy.centroid]).toEqual([null, null])
  })

  it('carries the visitors in no country as `unlocated`, and nothing located means no countries', () => {
    expect(worldMap([place('', '', '', 40, null, null), place('US', 'X', 'A', 1, null, null)]).unlocated).toEqual({ visitors: 40, views: 40 })
    expect(worldMap([place('', '', '', 40, null, null)]).countries).toEqual([])
    expect(worldMap([]).unlocated).toBeNull()
  })
})

describe('worldMap — the major cities', () => {
  it('CRITICAL: carries the major cities with an audience, each dot on the flat map where its CITY is — Newark\'s visitor is on New York\'s dot; a farm town is Other places', () => {
    const m = worldMap([
      place('US', 'New Jersey', 'Newark', 3, 40.7357, -74.1724),
      place('US', 'New York', 'New York City', 5, 40.71, -74.0),
      place('US', 'Nebraska', 'Broken Bow', 2, 41.4, -99.64),
    ])
    expect(m.majorCities.map((x) => [x.name, x.region, x.visitors])).toEqual([['New York', 'New York', 8]])
    expect(m.other).toEqual({ US: { visitors: 2, views: 2 } })
    expect(m.radiusMi).toBe(MAJOR_CITY_RADIUS_MI)
    const ny = m.majorCities[0]
    expect(ny.x).toBeCloseTo(xOf(ny.lon), 3)
    expect(ny.y).toBeCloseTo(yOf(ny.lat), 3)
  })
})
