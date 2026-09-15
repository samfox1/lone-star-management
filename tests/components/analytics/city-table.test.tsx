// @vitest-environment jsdom
// The list beside the map, two levels deep: countries, then the MAJOR CITIES of the one chosen — the
// same `country` the map and globe follow — with the visitors no major city reaches as one quiet
// "Other places" row, and a note under the list saying how far a city reaches. Every fixture is made by
// the real `worldMap()` from reader rows, so the list is only ever shown states the pipeline produces.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { CityTable } from '@/components/ui/city-table'
import { worldMap } from '@/lib/analytics-map'
import type { PlaceRow } from '@/lib/analytics'

const row = (country: string, region: string, city: string, visitors: number, views: number, lat: number | null = null, lon: number | null = null): PlaceRow =>
  ({ country, region, city, visitors, views, lat, lon })

const places = [
  row('US', 'Illinois', 'Chicago', 186, 415, 41.88, -87.63),
  row('US', 'Wisconsin', 'Madison', 74, 900, 43.07, -89.4),
  row('US', 'New Jersey', 'Newark', 3, 9, 40.7357, -74.1724),
  row('US', 'New York', 'New York City', 5, 6, 40.71, -74.0),
  row('US', 'Nebraska', 'Broken Bow', 2, 3, 41.4, -99.64), // near no major city
  row('DE', 'Berlin', 'Berlin', 200, 210, 52.52, 13.405), // the biggest CITY, in the smaller COUNTRY
  row('GB', 'England', 'London', 12, 20, 51.51, -0.13),
  row('FR', 'Auvergne', 'Aurillac', 1, 1, 44.93, 2.44), // a country with no major city reached: 100+ miles from Toulouse, Lyon and Montpellier
  row('', '', '', 40, 90), // not located
]
const m = worldMap(places)
const noop = () => {}
const props = { countries: m.countries, unlocated: m.unlocated, majorCities: m.majorCities, other: m.other, radiusMi: m.radiusMi }

/** Body rows (the header row excluded). */
const bodyRows = () => screen.getAllByRole('row').slice(1)
const nameOf = (tr: HTMLElement) => within(tr).getAllByRole('cell')[0].textContent
const cell = (tr: HTMLElement, i: number) => within(tr).getAllByRole('cell')[i].textContent
const widthOf = (tr: HTMLElement) => (tr.querySelector('[data-bar]') as HTMLElement).style.width
const NOTE = 'Each city includes visitors within 50 miles.'

describe('CityTable — countries', () => {
  it('CRITICAL: the broadest view is countries, ranked by ALL their visitors, each saying how many major cities it has — Germany\'s one big city does not put it first', () => {
    render(<CityTable {...props} country={null} onSelectCountry={noop} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Countries', '', 'Visitors', 'Views'])
    const rows = bodyRows()
    expect(rows.map(nameOf)).toEqual(['United States3 cities', 'Germany1 city', 'United Kingdom1 city', 'France', 'Not located'])
    expect(cell(rows[0], 2)).toBe('270') // 186 + 74 + 3 + 5 + 2: its Other places visitor counts too
    expect(widthOf(rows[0])).toBe('100%')
    expect(parseFloat(widthOf(rows[1]))).toBeCloseTo((200 / 270) * 100, 3)
    expect(rows[4].querySelector('[data-bar]')).toBeNull()
    expect(screen.queryByText(NOTE)).toBeNull() // the note belongs to the city level
  })

  it('CRITICAL: a country row is a way in — it reports its code, from the name or anywhere on the row; Not located is not a place', () => {
    const onSelect = vi.fn()
    render(<CityTable {...props} country={null} onSelectCountry={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /^Germany/ }))
    expect(onSelect).toHaveBeenCalledWith('DE')
    fireEvent.click(bodyRows()[2])
    expect(onSelect).toHaveBeenLastCalledWith('GB')
    expect(within(bodyRows()[4]).queryByRole('button')).toBeNull()
  })

  it('the header sits above the scroll box, not inside it', () => {
    const { container } = render(<CityTable {...props} country={null} onSelectCountry={noop} />)
    const scroller = container.querySelector('.overflow-y-auto')!
    expect(scroller.querySelector('thead')).toBeNull()
    expect(container.querySelector('thead')).not.toBeNull()
    expect(scroller.querySelectorAll('tbody tr').length).toBe(5)
  })
})

describe('CityTable — inside a country', () => {
  it('CRITICAL: that country\'s MAJOR CITIES, state under each, the bar a share of the leader\'s visitors — then its Other places, quiet — and nothing of anywhere else', () => {
    render(<CityTable {...props} country="US" onSelectCountry={noop} />)
    const rows = bodyRows()
    expect(rows.map(nameOf)).toEqual(['ChicagoIllinois', 'MadisonWisconsin', 'New YorkNew York', 'Other places'])
    expect(widthOf(rows[0])).toBe('100%')
    expect(parseFloat(widthOf(rows[1]))).toBeCloseTo((74 / 186) * 100, 3)
    expect(cell(rows[2], 2)).toBe('8') // Newark and New York City, one row
    expect(cell(rows[3], 2)).toBe('2')
    expect(rows[3].querySelector('[data-bar]')).toBeNull()
    expect(screen.queryByText('Not located')).toBeNull()
    expect(screen.queryByText('Berlin')).toBeNull()
    expect(screen.queryByText('Newark')).toBeNull()
  })

  it('CRITICAL: a note UNDER the list says how far a city reaches — outside the scroll box, so it never scrolls away', () => {
    const { container } = render(<CityTable {...props} country="US" onSelectCountry={noop} />)
    const note = screen.getByText(NOTE)
    const scroller = container.querySelector('.overflow-y-auto')!
    expect(scroller.contains(note)).toBe(false)
    expect(scroller.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const { container: far } = render(<CityTable {...props} radiusMi={75} country="US" onSelectCountry={noop} />)
    expect(far.textContent).toContain('within 75 miles')
  })

  it('a country with no major city lists only its Other places', () => {
    render(<CityTable {...props} country="FR" onSelectCountry={noop} />)
    expect(bodyRows().map(nameOf)).toEqual(['Other places'])
  })

  it('CRITICAL: the country\'s name heads the list and is the way back out', () => {
    const onSelect = vi.fn()
    render(<CityTable {...props} country="US" onSelectCountry={onSelect} />)
    const back = screen.getByRole('button', { name: /Back to countries/ })
    expect(back.textContent).toContain('United States')
    expect(screen.queryByText('Countries')).toBeNull()
    fireEvent.click(back)
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe('CityTable — nothing located', () => {
  it('says so, rather than a table of one Not located row', () => {
    const none = worldMap([row('', '', '', 40, 90)])
    render(<CityTable countries={none.countries} unlocated={none.unlocated} majorCities={none.majorCities} other={none.other} radiusMi={none.radiusMi} country={null} onSelectCountry={noop} />)
    expect(screen.getByText('No locations yet.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
