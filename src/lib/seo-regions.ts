/**
 * THE REGIONS A MANAGER PICKS FROM (Sam, 2026-09-29: "Country and region should be a dropdown").
 * For these countries the Facts "Region" is a list and the save gate (lib/seo-facts.ts
 * `cleanFactValue`) accepts exactly these names; for every other country it stays typed text,
 * as before. Keyed by the bridge's country code (`countryOf`), so a country is one row here
 * whatever spelling it was stored in.
 *
 * WHICH COUNTRIES (decided 2026-09-29): the ones whose regions are few, official and what a
 * fan searches by: US states (and DC), Canada's provinces and territories, Australia's states
 * and territories, the UK's four nations (a manager in Glasgow says "Scotland", not "United
 * Kingdom"). Others (Mexico's, Germany's, Brazil's, India's states) are real lists too and can
 * be added the same way; until then their region is typed.
 *
 * Pure data. Names in the official English spelling; no abbreviations (a pick is a name).
 */
import { countryOf, factText } from '@samfox1/site-bridge/seo'

export type RegionList = { noun: string; names: readonly string[] }

export const REGIONS: Readonly<Record<string, RegionList>> = {
  US: {
    noun: 'state',
    names: [
      'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida',
      'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
      'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
      'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
      'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin',
      'Wyoming',
    ],
  },
  CA: {
    noun: 'province or territory',
    names: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'],
  },
  AU: {
    noun: 'state or territory',
    names: ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
  },
  GB: { noun: 'nation', names: ['England', 'Northern Ireland', 'Scotland', 'Wales'] },
}

/** The list for a country as stored or typed ("United States", "usa"), or null: typed text. */
export function regionsFor(country: string | null | undefined): RegionList | null {
  const code = countryOf(country ?? '')?.code
  return code && Object.hasOwn(REGIONS, code) ? REGIONS[code] : null
}

/** How two region names compare: as text, ignoring case, accents and extra spaces
 *  ("québec" is "Quebec"). */
const key = (s: string) => factText(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The list's own spelling of a region, or null when the list doesn't have it. */
export function regionIn(list: RegionList, raw: string): string | null {
  const k = key(raw)
  return k ? (list.names.find((n) => key(n) === k) ?? null) : null
}
