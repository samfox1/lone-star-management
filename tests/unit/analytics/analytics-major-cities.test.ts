// Major cities: the anchors the Analytics page groups visitors under, and how each visitor is
// counted toward one — or toward its country's Other places. Pure; the data is the committed
// src/data/major-cities.json, which the data tests read directly rather than a hand-copied list.
import { describe, expect, it } from 'vitest'
import { ANCHORS, majorCitiesOf, type Anchor } from '@/lib/analytics-major-cities'
import { countryTotals } from '@/lib/analytics-places'
import { MAJOR_CITY_MIN_POP, MAJOR_CITY_RADIUS_MI, milesBetween } from '@/lib/geo-distance'
import type { PlaceRow } from '@/lib/analytics'

const place = (country: string, region: string, city: string, visitors: number, lat: number | null = null, lon: number | null = null, views = visitors): PlaceRow =>
  ({ country, region, city, visitors, views, lat, lon })
const anchor = (name: string, region: string, country: string, lat: number, lon: number, pop = 1_000_000): Anchor =>
  ({ name, region, country, lat, lon, pop })
/** Degrees of latitude in a mile, on the same sphere milesBetween uses. */
const degPerMile = 1 / milesBetween(0, 0, 1, 0)

describe('the major-city data (scripts/build-major-cities.ts)', () => {
  const us = (name: string) => ANCHORS.find((a) => a.country === 'US' && a.name === name)

  it('CRITICAL: no two anchors in ONE country sit within the radius — and some pair sits just outside it, so the data was built with THIS radius, not a bigger one', () => {
    const byCountry = new Map<string, Anchor[]>()
    for (const a of ANCHORS) byCountry.set(a.country, [...(byCountry.get(a.country) ?? []), a])
    const offenders: string[] = []
    let pairs = 0
    let minGap = Infinity
    for (const list of byCountry.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          pairs++
          const gap = milesBetween(list[i].lat, list[i].lon, list[j].lat, list[j].lon)
          minGap = Math.min(minGap, gap)
          if (gap <= MAJOR_CITY_RADIUS_MI) offenders.push(`${list[i].name} / ${list[j].name}: ${gap.toFixed(2)} mi`)
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000) // the check ran over real data, not an empty list
    expect(offenders).toEqual([])
    expect(minGap).toBeLessThan(MAJOR_CITY_RADIUS_MI + 2)
  })

  it('every anchor has the minimum population, a tidy name and region, and an ISO country code', () => {
    for (const a of ANCHORS) {
      expect(a.pop, a.name).toBeGreaterThanOrEqual(MAJOR_CITY_MIN_POP)
      expect(a.name, a.name).toBe(a.name.replace(/\s+/g, ' ').trim())
      expect(a.region, a.name).toBe(a.region.replace(/\s+/g, ' ').trim())
      expect(a.country, a.name).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('CRITICAL: the big cities are anchors and their satellites are not — New York keeps Newark and Stamford, Washington keeps Baltimore', () => {
    for (const name of ['New York', 'Chicago', 'Los Angeles', 'Washington, D.C.', 'Milwaukee', 'Madison']) expect(us(name), name).toBeDefined()
    for (const name of ['Newark', 'Stamford', 'Baltimore']) expect(us(name), name).toBeUndefined()
  })

  it('CRITICAL: a border does not suppress a city — Tijuana is Mexico\'s anchor though San Diego is minutes away', () => {
    const tijuana = ANCHORS.find((a) => a.country === 'MX' && a.name === 'Tijuana')!
    const sanDiego = us('San Diego')!
    expect(tijuana).toBeDefined()
    expect(milesBetween(tijuana.lat, tijuana.lon, sanDiego.lat, sanDiego.lon)).toBeLessThan(MAJOR_CITY_RADIUS_MI)
  })

  it('a real Newark visitor counts toward New York', () => {
    const { majorCities } = majorCitiesOf([place('US', 'New Jersey', 'Newark', 3, 40.7357, -74.1724)])
    expect(majorCities.map((m) => [m.name, m.visitors])).toEqual([['New York', 3]])
  })
})

describe('majorCitiesOf', () => {
  const NY = anchor('New York', 'New York', 'US', 40.75, -73.98, 19_000_000)
  const PHL = anchor('Philadelphia', 'Pennsylvania', 'US', 40.0, -75.17, 5_000_000)
  const PDX = anchor('Portland', 'Oregon', 'US', 45.52, -122.68)
  const PME = anchor('Portland', 'Maine', 'US', 43.66, -70.26)
  const TIJ = anchor('Tijuana', 'Baja California', 'MX', 32.5, -117.0)
  const ANCH = [NY, PHL, PDX, PME, TIJ]

  it('CRITICAL: a visitor counts toward the NEAREST major city in their country within the radius — Princeton sits inside both circles and goes to the nearer Philadelphia, whichever order the anchors come in', () => {
    const princeton = [40.35, -74.66] as const
    expect(milesBetween(...princeton, NY.lat, NY.lon)).toBeLessThan(MAJOR_CITY_RADIUS_MI)
    expect(milesBetween(...princeton, PHL.lat, PHL.lon)).toBeLessThan(milesBetween(...princeton, NY.lat, NY.lon))
    // Both orders: with Philadelphia last, "the last one in reach" would pass too (a review found that).
    for (const anchors of [[NY, PHL], [PHL, NY]]) {
      const { majorCities } = majorCitiesOf([place('US', 'New Jersey', 'Princeton', 2, ...princeton)], anchors)
      expect(majorCities.map((m) => m.name)).toEqual(['Philadelphia'])
    }
  })

  it('CRITICAL: the radius is measured — just inside joins, just outside is Other places (±0.5 mi; whether exactly 50 joins is not pinned)', () => {
    const r = majorCitiesOf([
      place('US', 'X', 'In', 1, NY.lat + (MAJOR_CITY_RADIUS_MI - 0.5) * degPerMile, NY.lon),
      place('US', 'X', 'Out', 1, NY.lat + (MAJOR_CITY_RADIUS_MI + 0.5) * degPerMile, NY.lon),
    ], [NY])
    expect(r.majorCities.map((m) => [m.name, m.visitors])).toEqual([['New York', 1]])
    expect(r.other).toEqual({ US: { visitors: 1, views: 1 } })
  })

  it('CRITICAL: never across a border — a Tijuana visitor is Tijuana\'s, and a US visitor with only a Mexican city near is Other places', () => {
    const r = majorCitiesOf([place('MX', 'Baja California', 'Tijuana', 4, 32.53, -117.02), place('US', 'California', 'Chula Vista', 1, 32.64, -117.08)], [TIJ])
    expect(r.majorCities.map((m) => [m.country, m.name, m.visitors])).toEqual([['MX', 'Tijuana', 4]])
    expect(r.other).toEqual({ US: { visitors: 1, views: 1 } })
  })

  it('sums visitors and views, and ranks by visitors, then views, then name', () => {
    // Equal visitors, and the city with MORE views comes LATER alphabetically, so a name-only
    // tiebreak gives the other order (a mutation check found the first fixture agreed with both).
    const r = majorCitiesOf([
      place('US', 'New Jersey', 'Newark', 3, 40.7357, -74.1724, 3),
      place('US', 'New York', 'New York City', 5, 40.71, -74.0, 5),
      place('US', 'Pennsylvania', 'Philadelphia', 8, 39.95, -75.16, 15),
    ], ANCH)
    expect(r.majorCities.map((m) => [m.name, m.visitors, m.views])).toEqual([['Philadelphia', 8, 15], ['New York', 8, 8]])
    const tie = majorCitiesOf([place('US', 'Pennsylvania', 'Philadelphia', 2, 39.95, -75.16, 2), place('US', 'New York', 'New York City', 2, 40.71, -74.0, 2)], ANCH)
    expect(tie.majorCities.map((m) => m.name)).toEqual(['New York', 'Philadelphia'])
  })

  it('a major city carries its anchor\'s key, region and place — the dot goes on the city, not on a visitor', () => {
    const [m] = majorCitiesOf([place('US', 'New Jersey', 'Newark', 1, 40.7357, -74.1724)], ANCH).majorCities
    expect(m).toMatchObject({ key: 'US|New York|New York', name: 'New York', region: 'New York', country: 'US', lat: NY.lat, lon: NY.lon })
  })

  it('CRITICAL: a place with no city is not a city — a country- or state-level point goes to Other places, even right on top of a major city', () => {
    const r = majorCitiesOf([place('US', '', '', 3, 40.75, -73.98), place('US', 'New York', '', 2, 40.75, -73.98)], ANCH)
    expect(r.majorCities).toEqual([])
    expect(r.other).toEqual({ US: { visitors: 5, views: 5 } })
  })

  it('CRITICAL: a city with no point is matched by name AND state — Portland, Oregon is not Portland, Maine', () => {
    const r = majorCitiesOf([place('US', 'Oregon', 'Portland', 2), place('US', 'Maine', 'Portland', 1)], ANCH)
    expect(r.majorCities.map((m) => [m.region, m.visitors])).toEqual([['Oregon', 2], ['Maine', 1]])
  })

  it('CRITICAL: a city with no point in a state with no major city of that name is Other places — Philadelphia, Ohio is not Philadelphia, Pennsylvania', () => {
    const r = majorCitiesOf([place('US', 'Ohio', 'Philadelphia', 1)], ANCH)
    expect(r.majorCities).toEqual([])
    expect(r.other).toEqual({ US: { visitors: 1, views: 1 } })
  })

  it('a city with no point and no state: a unique name matches; an ambiguous or unknown one is Other places', () => {
    const r = majorCitiesOf([place('US', '', 'Philadelphia', 1), place('US', '', 'Portland', 2), place('US', 'Ohio', 'Nowhere', 4)], ANCH)
    expect(r.majorCities.map((m) => [m.name, m.visitors])).toEqual([['Philadelphia', 1]])
    expect(r.other).toEqual({ US: { visitors: 6, views: 6 } })
  })

  it('name matching ignores case and extra spaces', () => {
    expect(majorCitiesOf([place('US', ' new  york ', 'NEW  YORK', 1)], ANCH).majorCities.map((m) => m.name)).toEqual(['New York'])
  })

  it('rows with no country are not counted here — the list shows those as Not located', () => {
    expect(majorCitiesOf([place('', '', '', 40)], ANCH)).toEqual({ majorCities: [], other: {} })
  })

  it('CRITICAL: every located visitor lands in exactly ONE row — per country, its major cities plus its Other places equal the country\'s total, and nothing else is counted', () => {
    const places = [
      place('US', 'New Jersey', 'Newark', 3, 40.7357, -74.1724, 4), // a point → New York
      place('US', 'Oregon', 'Portland', 2, null, null, 5), // name and state → Portland, Oregon
      place('US', '', 'Portland', 6, null, null, 7), // an ambiguous name → Other places
      place('US', '', '', 1, 39.0, -98.0, 1), // no city → Other places
      place('US', 'Ohio', 'Nowhere', 4, null, null, 4), // an unknown name → Other places
      place('MX', 'Baja California', 'Tijuana', 5, 32.53, -117.02, 6), // → Tijuana
      place('', '', '', 9, null, null, 9), // not located: in no country
    ]
    const { majorCities, other } = majorCitiesOf(places, ANCH)
    const { countries } = countryTotals(places)
    for (const c of countries) {
      const inside = majorCities.filter((m) => m.country === c.code)
      const sum = {
        visitors: inside.reduce((n, m) => n + m.visitors, 0) + (other[c.code]?.visitors ?? 0),
        views: inside.reduce((n, m) => n + m.views, 0) + (other[c.code]?.views ?? 0),
      }
      expect(sum, c.code).toEqual({ visitors: c.visitors, views: c.views })
    }
    expect(Object.keys(other).filter((k) => !countries.some((c) => c.code === k))).toEqual([])
  })
})
