/**
 * WHERE THEY ARE — the country level (ANALYTICS_PAGE_PLAN.md, places). Pure: the `analytics_places`
 * reader's rows in, one total per country out, plus the visitors the door could not place in any
 * country. The list and the map both read these (through lib/analytics-map.ts), so the two cannot
 * disagree about a country — they did, when the map counted only the places it could draw.
 */
import type { PlaceRow } from './analytics'

export type Tally = { visitors: number; views: number }
export type CountryTotal = { code: string; name: string } & Tally

let names: Intl.DisplayNames | null | undefined
/** The country's English name; the code itself when Intl cannot name it. */
export function countryName(code: string): string {
  if (names === undefined) {
    try { names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }) } catch { names = null }
  }
  if (!names) return code
  // `of` throws on anything not shaped like a code, and names 'ZZ' "Unknown Region".
  try { return (/^[A-Z]{2}$/.test(code) && names.of(code)) || code } catch { return code }
}

/** Every place summed by country, most visitors first (then views, then name); no country is `unlocated`. */
export function countryTotals(places: PlaceRow[]): { countries: CountryTotal[]; unlocated: Tally | null } {
  const by = new Map<string, CountryTotal>()
  const none: Tally = { visitors: 0, views: 0 }
  let unplaced = 0
  for (const p of places) {
    if (!p.country) {
      unplaced++
      none.visitors += p.visitors
      none.views += p.views
      continue
    }
    const got = by.get(p.country) ?? { code: p.country, name: countryName(p.country), visitors: 0, views: 0 }
    got.visitors += p.visitors
    got.views += p.views
    by.set(p.country, got)
  }
  const countries = [...by.values()].sort((a, b) => b.visitors - a.visitors || b.views - a.views || a.name.localeCompare(b.name))
  return { countries, unlocated: unplaced ? none : null }
}
