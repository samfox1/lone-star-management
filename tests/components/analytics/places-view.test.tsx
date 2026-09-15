// @vitest-environment jsdom
// Map or Globe: one box, one switch beside plus / minus showing the OTHER view's glyph, the geography
// loaded once from the baked files (the flat map at once, the globe's only when it first opens), and
// the country in focus passed straight through to whichever view is up.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlacesView } from '@/components/ui/places-view'
import { worldMap } from '@/lib/analytics-map'
import type { PlaceRow } from '@/lib/analytics'

/** Counts fetches of the globe's geography, and hands back the real file. */
const globeFetched = vi.hoisted(() => vi.fn())
vi.mock('@/data/map-globe.json', async (importOriginal) => {
  globeFetched()
  return importOriginal()
})

const place = (country: string, region: string, city: string, visitors: number, lat: number, lon: number): PlaceRow =>
  ({ country, region, city, visitors, views: visitors, lat, lon })
const map = worldMap([place('US', 'Illinois', 'Chicago', 5, 41.88, -87.63)])
const noop = () => {}
const flatSvg = (c: HTMLElement) => c.querySelector('svg[aria-label="Where visitors are"]')
const globeSvg = (c: HTMLElement) => c.querySelector('svg[aria-label="Where visitors are, on the globe"]')

afterEach(() => vi.unstubAllGlobals())

describe('PlacesView', () => {
  // First in the file: the loader keeps what it has fetched for the rest of the file.
  it('CRITICAL: the globe\'s geography is not fetched until the globe is first opened — it is a third of the page\'s weight', async () => {
    const { container } = render(<PlacesView map={map} country={null} onSelectCountry={noop} />)
    await waitFor(() => expect(flatSvg(container)).not.toBeNull(), { timeout: 5000 })
    expect(globeFetched).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show globe' }))
    await waitFor(() => expect(globeSvg(container)).not.toBeNull(), { timeout: 5000 })
    expect(globeFetched).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: the box is there at once and the flat map arrives with its geography — none of it in the page\'s props', async () => {
    const { container } = render(<PlacesView map={map} country={null} onSelectCountry={noop} />)
    expect(container.querySelector('[data-view="map"]')).not.toBeNull()
    await waitFor(() => expect(flatSvg(container)!.querySelectorAll('[data-land]').length).toBeGreaterThan(200), { timeout: 5000 })
    expect(flatSvg(container)!.querySelector('[data-country="US"]')).not.toBeNull()
  })

  it('CRITICAL: opens on the flat map with a globe button; pressing it swaps in the globe and the button becomes a map button — no tabs', async () => {
    const { container } = render(<PlacesView map={map} country={null} onSelectCountry={noop} />)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show map' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show globe' }).querySelector('[data-icon]')!.getAttribute('data-icon')).toBe('globe')
    fireEvent.click(screen.getByRole('button', { name: 'Show globe' }))
    expect(container.querySelector('[data-view="globe"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Show map' }).querySelector('[data-icon]')!.getAttribute('data-icon')).toBe('map')
    await waitFor(() => expect(globeSvg(container)!.querySelectorAll('[data-land]').length).toBeGreaterThan(100), { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
    expect(container.querySelector('[data-view="map"]')).not.toBeNull()
  })

  it('CRITICAL: the switch sits beside plus and minus, in the same place on both views', async () => {
    const { container } = render(<PlacesView map={map} country={null} onSelectCountry={noop} />)
    const group = () => screen.getByRole('button', { name: /Show (globe|map)/ }).parentElement!
    expect([...group().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Show globe'])
    fireEvent.click(screen.getByRole('button', { name: 'Show globe' }))
    await waitFor(() => expect(globeSvg(container)).not.toBeNull(), { timeout: 5000 })
    expect([...group().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Show map'])
  })

  it('CRITICAL: the country in focus reaches the map, and a click on its land comes back out', async () => {
    const onSelect = vi.fn()
    const { container } = render(<PlacesView map={map} country="US" onSelectCountry={onSelect} />)
    await waitFor(() => expect(flatSvg(container)!.querySelector('[data-country="US"][data-selected="true"]')).not.toBeNull(), { timeout: 5000 })
    const land = flatSvg(container)!.querySelector('[data-country="US"]')!
    fireEvent.pointerDown(land, { clientX: 200, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerUp(flatSvg(container)!, { clientX: 200, clientY: 200, pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith('US')
  })

  it('CRITICAL: the map\'s window AND the globe\'s frame take the box\'s LIVE shape — a taller box, a taller window', async () => {
    let fire: ((entries: { contentRect: { width: number; height: number } }[]) => void) | null = null
    class FakeRO {
      constructor(cb: typeof fire) { fire = cb }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeRO)
    const { container } = render(<PlacesView map={map} country={null} onSelectCountry={noop} />)
    await waitFor(() => expect(flatSvg(container)).not.toBeNull(), { timeout: 5000 })
    const ratio = (svg: Element | null) => { const [, , w, h] = svg!.getAttribute('viewBox')!.split(' ').map(Number); return w / h }
    act(() => fire!([{ contentRect: { width: 700, height: 500 } }]))
    expect(ratio(flatSvg(container))).toBeCloseTo(1.4, 6)
    fireEvent.click(screen.getByRole('button', { name: 'Show globe' }))
    await waitFor(() => expect(globeSvg(container)).not.toBeNull(), { timeout: 5000 })
    expect(ratio(globeSvg(container))).toBeCloseTo(1.4, 6)
  })
})
