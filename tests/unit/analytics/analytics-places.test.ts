// A country's name, and the country totals the list and the map both read. Pure; the reader's
// rows come in as they leave the RPC.
import { describe, expect, it } from 'vitest'
import { countryName, countryTotals } from '@/lib/analytics-places'
import type { PlaceRow } from '@/lib/analytics'

const row = (country: string, region: string, city: string, visitors: number, views = visitors * 2): PlaceRow =>
  ({ country, region, city, visitors, views, lat: null, lon: null })

describe('countryName', () => {
  it('names a code in English', () => {
    expect(countryName('US')).toBe('United States')
    expect(countryName('GB')).toBe('United Kingdom')
  })
  it('an unassigned or malformed code is shown as itself rather than throwing', () => {
    expect(countryName('QM')).toBe('QM') // unassigned: Intl has no name
    expect(countryName('not a code')).toBe('not a code')
    expect(countryName('')).toBe('')
  })
})

describe('countryTotals', () => {
  it('CRITICAL: one row per country, summed over EVERY place in it, most visitors first — the country with the biggest city is not thereby first', () => {
    const { countries } = countryTotals([
      row('DE', 'Berlin', 'Berlin', 80, 100),
      row('US', 'Illinois', 'Chicago', 50, 60),
      row('US', 'Arizona', 'Tucson', 40, 50),
      row('US', 'Alaska', 'Anchorage', 1, 1),
    ])
    expect(countries).toEqual([
      { code: 'US', name: 'United States', visitors: 91, views: 111 },
      { code: 'DE', name: 'Germany', visitors: 80, views: 100 },
    ])
  })

  it('CRITICAL: rows with no country are not a country — they sum into `unlocated`', () => {
    const r = countryTotals([row('', '', '', 40, 90), row('', '', '', 2, 3), row('US', 'Wisconsin', 'Milwaukee', 1, 1)])
    expect(r.countries.map((c) => c.code)).toEqual(['US'])
    expect(r.unlocated).toEqual({ visitors: 42, views: 93 })
  })

  it('ties break on views, then on name', () => {
    const { countries } = countryTotals([row('FR', '', '', 5, 5), row('DE', '', '', 5, 9), row('AT', '', '', 5, 5)])
    expect(countries.map((c) => c.code)).toEqual(['DE', 'AT', 'FR']) // Germany has the most views; Austria before France by name
  })

  it('nothing in, nothing out', () => {
    expect(countryTotals([])).toEqual({ countries: [], unlocated: null })
  })
})
