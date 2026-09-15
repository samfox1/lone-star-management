// @vitest-environment jsdom
// The box and the list share ONE country: a row in the list frames the country on the map and turns
// the list to its major cities; a click on the map's land does the same; the name at the top of the list
// brings everything back to countries. The map's data is the real `worldMap()`, and the geography is
// the real baked file, loaded as the page loads it.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlacesSection } from '@/components/ui/places-section'
import { worldMap } from '@/lib/analytics-map'
import { fitWindow } from '@/lib/map-view'
import type { PlaceRow } from '@/lib/analytics'

const row = (country: string, region: string, city: string, visitors: number, views: number, lat: number | null = null, lon: number | null = null): PlaceRow =>
  ({ country, region, city, visitors, views, lat, lon })
const places = [
  row('US', 'Illinois', 'Chicago', 186, 415, 41.88, -87.63),
  row('US', 'New Jersey', 'Newark', 3, 9, 40.7357, -74.1724),
  row('GB', 'England', 'London', 12, 20, 51.51, -0.13),
  row('FR', 'Auvergne', 'Aurillac', 400, 500), // in the list only: no point on the map, and no major city by name
]
const map = worldMap(places)
const viewBox = (c: HTMLElement) => c.querySelector('svg[aria-label="Where visitors are"]')!.getAttribute('viewBox')!.split(' ').map(Number)
const rows = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent)
/** The window the map shows for a country: its frame, fitted whole into the box's 2:1 (map-view.test pins how). */
const framed = (code: string) => {
  const v = fitWindow(map.countries.find((c) => c.code === code)!.view!, { width: map.frame.width, height: map.frame.height, aspect: 2 })
  return [v.x, v.y, v.w, v.h].map((n) => Math.round(n))
}
const loaded = async (c: HTMLElement) => waitFor(() => expect(c.querySelectorAll('[data-land]').length).toBeGreaterThan(200), { timeout: 5000 })

describe('PlacesSection', () => {
  it('CRITICAL: a country row frames the country on the map and turns the list to its major cities; the name at the top brings both back', async () => {
    const { container } = render(<PlacesSection map={map} />)
    await loaded(container)
    expect(rows()).toEqual(['France', 'United States2 cities', 'United Kingdom1 city'])
    fireEvent.click(screen.getByRole('button', { name: /^United Kingdom/ }))
    const london = map.majorCities.find((m) => m.country === 'GB')!
    expect(london.name).toBe('London')
    expect(rows()).toEqual([`London${london.region}`]) // the state line is the city data's own (Natural Earth says Westminster)
    expect(viewBox(container).map(Math.round)).toEqual(framed('GB'))
    expect(container.querySelector('[data-country="GB"][data-selected="true"]')).not.toBeNull()
    expect(screen.getByText('Each city includes visitors within 50 miles.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back to countries/ }))
    expect(rows()).toEqual(['France', 'United States2 cities', 'United Kingdom1 city'])
  })

  it('CRITICAL: a country in the list with no map point is still framed when chosen — France frames France, not the whole world', async () => {
    const { container } = render(<PlacesSection map={map} />)
    await loaded(container)
    fireEvent.click(screen.getByRole('button', { name: /^France/ }))
    expect(viewBox(container).map(Math.round)).toEqual(framed('FR'))
  })

  it('CRITICAL: a click on the map\'s land — as a browser delivers it, the pointer-up on the captured svg — does the same as the row, and the map\'s dots are the list\'s cities', async () => {
    const { container } = render(<PlacesSection map={map} />)
    await loaded(container)
    const land = container.querySelector('[data-country="US"]')!
    const svg = container.querySelector('svg[aria-label="Where visitors are"]')!
    fireEvent.pointerDown(land, { clientX: 200, clientY: 100, pointerId: 1, button: 0 })
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 100, pointerId: 1 })
    expect(rows()).toEqual(['ChicagoIllinois', 'New YorkNew York'])
    expect(viewBox(container).map(Math.round)).toEqual(framed('US'))
    expect([...container.querySelectorAll('circle[data-city]')].map((d) => d.getAttribute('data-city'))).toEqual(['US|Illinois|Chicago', 'US|New York|New York'])
  })
})
