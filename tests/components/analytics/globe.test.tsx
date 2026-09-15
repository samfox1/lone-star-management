// @vitest-environment jsdom
// The globe as painted: a sphere with each country's land on it, heat where the near side has cities,
// turned by dragging, faced at the audience when it opens, turned to a country from above or by a click
// on its land, zoomed by the buttons — and inside a country its major cities as dots, the pointer reading
// the nearest one. The geography is a prop of its own; the page loads it only when the globe first opens.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Globe } from '@/components/ui/globe'
import { DOT_R, HEAT_R } from '@/lib/map-constants'
import { heatAlphas } from '@/lib/heat'
import type { WorldMapData } from '@/lib/analytics-map'
import type { GlobeGeography } from '@/lib/map-geography'
import { GLOBE_GAP, GLOBE_SIZE, faceOf, globeProjection, globeWidth, rotationTo, type Rotation } from '@/lib/globe-view'

const geo: GlobeGeography = {
  lands: [
    // Exterior rings run CLOCKWISE, as d3 (and topojson's output) have them; the other way round is "everything but this".
    { code: 'US', geometry: { type: 'Polygon', coordinates: [[[-100, 30], [-100, 45], [-80, 45], [-80, 30], [-100, 30]]] } },
    { code: 'SG', geometry: { type: 'Polygon', coordinates: [[[103, 1], [103, 2], [104.5, 2], [104.5, 1], [103, 1]]] } },
    { code: 'FR', geometry: { type: 'Polygon', coordinates: [[[-2, 44], [-2, 50], [6, 50], [6, 44], [-2, 44]]] } }, // no audience
  ],
  lakes: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-88, 42], [-88, 44], [-86, 44], [-86, 42], [-88, 42]]] } }] },
  coasts: { type: 'MultiLineString', coordinates: [[[-100, 30], [-100, 45], [-80, 45]]] },
  borders: { type: 'MultiLineString', coordinates: [[[-100, 40], [-80, 40]]] },
  states: { type: 'MultiLineString', coordinates: [[[-90, 31], [-90, 44]]] },
}
const map: WorldMapData = {
  frame: { width: 720, height: 360 },
  points: [
    { key: 'US|Illinois|Chicago', country: 'US', visitors: 186, views: 415, x: 0, y: 0, lon: -87.63, lat: 41.88 },
    { key: 'US|Illinois|Evanston', country: 'US', visitors: 4, views: 6, x: 0, y: 0, lon: -87.69, lat: 42.05 },
    { key: 'SG||Singapore', country: 'SG', visitors: 9, views: 9, x: 0, y: 0, lon: 103.82, lat: 1.35 },
    { key: 'MY||Kuala Lumpur', country: 'MY', visitors: 2, views: 2, x: 0, y: 0, lon: 101.69, lat: 3.14 }, // beside Singapore: on its side, not its country
    { key: 'US||Far side', country: 'US', visitors: 1, views: 1, x: 0, y: 0, lon: -30, lat: -60 }, // the US, round the back from both faces used here
  ],
  majorCities: [
    { key: 'US|Illinois|Chicago', name: 'Chicago', region: 'Illinois', country: 'US', lat: 41.83, lon: -87.75, visitors: 190, views: 421, x: 0, y: 0 },
    { key: 'SG|Singapore|Singapore', name: 'Singapore', region: 'Singapore', country: 'SG', lat: 1.29, lon: 103.86, visitors: 9, views: 9, x: 0, y: 0 },
    { key: 'MY|Selangor|Kuala Lumpur', name: 'Kuala Lumpur', region: 'Selangor', country: 'MY', lat: 3.17, lon: 101.7, visitors: 2, views: 2, x: 0, y: 0 },
    { key: 'US|X|Far side', name: 'Far side', region: 'X', country: 'US', lat: -60, lon: -30, visitors: 1, views: 1, x: 0, y: 0 },
  ],
  other: {},
  radiusMi: 50,
  countries: [
    { code: 'US', name: 'United States', visitors: 190, views: 421, majorCities: 2, view: { x: 0, y: 0, w: 1, h: 1 }, centroid: [-98, 39] },
    { code: 'SG', name: 'Singapore', visitors: 9, views: 9, majorCities: 1, view: { x: 0, y: 0, w: 1, h: 1 }, centroid: [103.82, 1.35] },
    { code: 'MY', name: 'Malaysia', visitors: 2, views: 2, majorCities: 1, view: { x: 0, y: 0, w: 1, h: 1 }, centroid: [102, 4] },
    { code: 'NZ', name: 'New Zealand', visitors: 1, views: 1, majorCities: 0, view: null, centroid: null },
  ],
  unlocated: null,
}
const noop = () => {}
const ASPECT = map.frame.width / map.frame.height
const draw = (props: Partial<Parameters<typeof Globe>[0]> = {}) => <Globe map={map} geography={geo} country={null} onSelectCountry={noop} {...props} />

const rotationOf = (c: HTMLElement): Rotation => c.querySelector('svg')!.getAttribute('data-rotation')!.split(',').map(Number) as Rotation
const scaleOf = (c: HTMLElement) => Number(c.querySelector('svg')!.getAttribute('data-scale'))
/** The projection the component is using: the box's shape, the current rotation and zoom. */
const projectionOf = (c: HTMLElement) => globeProjection(rotationOf(c), scaleOf(c), ASPECT)
const glows = (c: HTMLElement) => [...c.querySelectorAll('[data-heat]')].map((g) => g.getAttribute('data-key'))
const dotKeys = (c: HTMLElement) => [...c.querySelectorAll('circle[data-city]')].map((d) => d.getAttribute('data-city'))
const svgOf = (c: HTMLElement) => c.querySelector('svg')!
const landOf = (c: HTMLElement, code: string) => c.querySelector(`[data-country="${code}"]`) as SVGPathElement
const readout = (c: HTMLElement) => c.querySelector('[data-readout]')?.textContent?.replace(/\s+/g, ' ') ?? null
/** jsdom has no layout: the svg is told it is drawn at (scale ×) one px per viewBox unit. */
const layout = (c: HTMLElement, scale = 1) => {
  const [, , w0, h0] = svgOf(c).getAttribute('viewBox')!.split(' ').map(Number)
  const w = w0 * scale, h = h0 * scale
  svgOf(c).getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) })
}
/** A click as a BROWSER delivers it: down on the land, then — the svg has captured the pointer — up on the svg. */
const click = (c: HTMLElement, el: Element, at: { clientX: number; clientY: number }) => {
  fireEvent.pointerDown(el, { ...at, pointerId: 1, button: 0 })
  fireEvent.pointerUp(svgOf(c), { ...at, pointerId: 1 })
}

describe('Globe', () => {
  it('CRITICAL: opens facing the audience — the US side, with Singapore round the back', () => {
    const { container } = render(draw())
    const expected = rotationTo(faceOf(map.points))
    expect(rotationOf(container)[0]).toBeCloseTo(expected[0], 3)
    expect(rotationOf(container)[1]).toBeCloseTo(expected[1], 3)
    expect(glows(container)).toEqual(['US|Illinois|Chicago', 'US|Illinois|Evanston'])
  })

  it('CRITICAL: a sphere, each country\'s land on it, grey borders, the lakes over them, coastlines, then the heat over all of it — no dots at the country level', () => {
    const { container } = render(draw())
    const sphere = container.querySelector('[data-sphere]')!
    const lands = [...container.querySelectorAll('[data-land]')]
    const lakes = container.querySelector('[data-lakes]')!
    const coasts = container.querySelector('[data-coasts]')!
    const borders = container.querySelector('[data-borders]')!
    expect(lands.map((l) => l.getAttribute('data-country'))).toEqual(['US', 'SG', 'FR'])
    expect(landOf(container, 'US').getAttribute('d')!.length).toBeGreaterThan(10)
    expect(landOf(container, 'SG').getAttribute('d') ?? '').toBe('') // the far side: nothing to draw
    expect(lakes.getAttribute('d')!.length).toBeGreaterThan(10)
    expect(borders.getAttribute('d')!.length).toBeGreaterThan(5)
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(after(sphere, lands[0])).toBe(true)
    expect(after(lands[2], borders)).toBe(true)
    expect(after(borders, lakes)).toBe(true) // a lake covers the borders that run through its water
    expect(coasts.getAttribute('d')!.length).toBeGreaterThan(5)
    expect(after(lakes, coasts)).toBe(true)
    expect(after(coasts, container.querySelector('[data-heat]')!)).toBe(true) // lines under the heat
    expect(dotKeys(container)).toEqual([])
    expect(borders.getAttribute('stroke')).toBe('var(--color-ink-faint)')
    expect(landOf(container, 'US').getAttribute('stroke')).toBe('var(--color-paper)')
    for (const el of [coasts, lakes]) expect(el.getAttribute('stroke')).toBe('var(--color-ink-faint)') // coasts and lake shores wear the border grey
  })

  it('CRITICAL: the US state lines are on the globe too (Sam, 2026-09-15), in the lighter grey, over the borders and under the lakes that cover them', () => {
    const { container } = render(draw())
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const states = container.querySelector('[data-states]')!
    expect(states.getAttribute('d')!.length).toBeGreaterThan(5)
    expect(states.getAttribute('stroke')).toBe('var(--color-ink-faint)')
    expect(states.getAttribute('fill')).toBe('none')
    expect(after(container.querySelector('[data-borders]')!, states)).toBe(true)
    expect(after(states, container.querySelector('[data-lakes]')!)).toBe(true)
  })

  it('CRITICAL: the globe\'s heat is relative too — worked out over the cities on the near side, where the globe draws them', () => {
    const { container } = render(draw())
    const projection = projectionOf(container)
    const shown = [...container.querySelectorAll('[data-heat]')]
    const placed = shown.map((glow) => {
      const p = map.points.find((q) => q.key === glow.getAttribute('data-key'))!
      const [x, y] = projection([p.lon, p.lat])!
      return { x, y, visitors: p.visitors }
    })
    const expected = heatAlphas(placed, HEAT_R)
    shown.forEach((glow, i) => expect(Number(glow.getAttribute('opacity')), `glow ${i}`).toBeCloseTo(expected[i], 6))
  })

  it('CRITICAL: two shapes under ONE country code render cleanly — a key by code alone made React drop one', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const twin = { ...geo, lands: [...geo.lands, { code: 'US', geometry: { type: 'Polygon' as const, coordinates: [[[-90, 25], [-90, 28], [-85, 28], [-85, 25], [-90, 25]]] } }] }
    const { container } = render(draw({ geography: twin }))
    expect(container.querySelectorAll('[data-country="US"]')).toHaveLength(2)
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    errors.mockRestore()
  })

  it('CRITICAL: draws in the WHOLE box, a frame of the box\'s shape, the sphere the height less a gap — so a zoomed sphere runs to the box\'s edge, never a square inside it', () => {
    const { container } = render(draw())
    expect(svgOf(container).getAttribute('viewBox')).toBe(`0 0 ${globeWidth(ASPECT)} ${GLOBE_SIZE}`)
    const face = faceOf(map.points)
    expect(projectionOf(container)(face)![0]).toBeCloseTo(globeWidth(ASPECT) / 2, 3)
    expect(projectionOf(container)(face)![1]).toBeCloseTo(GLOBE_SIZE / 2, 3)
    const sphere = container.querySelector('[data-sphere]')!.getAttribute('d')!
    const ys = [...sphere.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]))
    expect(Math.min(...ys)).toBeCloseTo(GLOBE_GAP, 0)
    expect(Math.max(...ys)).toBeCloseTo(GLOBE_SIZE - GLOBE_GAP, 0)
    const { container: square } = render(draw({ aspect: 1 }))
    expect(svgOf(square).getAttribute('viewBox')).toBe(`0 0 ${GLOBE_SIZE} ${GLOBE_SIZE}`)
  })

  it('CRITICAL: dragging turns it — drag right and the longitude faced moves west', () => {
    const { container } = render(draw())
    layout(container)
    const svg = svgOf(container)
    const r0 = rotationOf(container)
    fireEvent.pointerDown(svg, { clientX: 200, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 260, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 260, clientY: 200, pointerId: 1 })
    const r1 = rotationOf(container)
    expect(r1[0]).toBeGreaterThan(r0[0])
    expect(r1[1]).toBeCloseTo(r0[1], 6)
  })

  it('CRITICAL: follows `country` from above — turns to face it WITHOUT zooming (a zoomed sphere is cropped); a country with no centre, or none, faces the audience', () => {
    const { container, rerender } = render(draw())
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoomed = scaleOf(container)
    rerender(draw({ country: 'SG' }))
    let r = rotationOf(container)
    expect(r[0]).toBeCloseTo(-103.82, 3)
    expect(r[1]).toBeCloseTo(-1.35, 3)
    expect(scaleOf(container)).toBe(zoomed)
    expect(glows(container)).toEqual(['SG||Singapore', 'MY||Kuala Lumpur'])
    expect(landOf(container, 'SG').getAttribute('data-selected')).toBe('true')
    const audience = rotationTo(faceOf(map.points))
    rerender(draw({ country: 'NZ' }))
    r = rotationOf(container)
    expect(r[0]).toBeCloseTo(audience[0], 3)
    rerender(draw({ country: null }))
    expect(rotationOf(container)[0]).toBeCloseTo(audience[0], 3)
    expect(scaleOf(container)).toBe(zoomed)
  })

  it('CRITICAL: mounted with a country already in focus, it starts facing it, whole — the view switch must not lose the place', () => {
    const { container } = render(draw({ country: 'SG' }))
    expect(rotationOf(container)[0]).toBeCloseTo(-103.82, 3)
    expect(scaleOf(container)).toBe(1)
  })

  it('CRITICAL: a click selects the country it STARTED on — with pointer capture the pointer-up lands on the svg; a drag, an inert country, or open water does not select', () => {
    const onSelect = vi.fn()
    const { container } = render(draw({ onSelectCountry: onSelect }))
    layout(container)
    click(container, landOf(container, 'US'), { clientX: 200, clientY: 200 })
    expect(onSelect).toHaveBeenCalledWith('US')
    onSelect.mockClear()
    fireEvent.pointerDown(landOf(container, 'US'), { clientX: 200, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svgOf(container), { clientX: 240, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(svgOf(container), { clientX: 240, clientY: 200, pointerId: 1 })
    click(container, landOf(container, 'FR'), { clientX: 200, clientY: 200 })
    click(container, svgOf(container), { clientX: 2, clientY: 2 })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('plus and minus zoom within the limits', () => {
    const { container } = render(draw())
    expect(scaleOf(container)).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(scaleOf(container)).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(scaleOf(container)).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(scaleOf(container)).toBe(1)
  })

  it('CRITICAL: at the country level the pointer reads the COUNTRY under it — name, then visitors, then views, no marker — and nothing over one with no audience', () => {
    const { container } = render(draw())
    layout(container)
    fireEvent.pointerMove(landOf(container, 'US'), { clientX: 200, clientY: 200 })
    expect(readout(container)).toMatch(/^United States\s*190\s*visitors\s*421\s*views$/)
    expect(container.querySelector('[data-marker]')).toBeNull()
    fireEvent.pointerMove(landOf(container, 'FR'), { clientX: 200, clientY: 200 })
    expect(readout(container)).toBeNull()
  })

  it('CRITICAL: inside a country, one small dot per MAJOR CITY of that country on the near side, where the GLOBE puts the city — none for a neighbour\'s city', () => {
    const { container, rerender } = render(draw({ country: 'US' }))
    expect(dotKeys(container)).toEqual(['US|Illinois|Chicago']) // the far-side US city is round the back
    const dot = container.querySelector('circle[data-city]')!
    expect(Number(dot.getAttribute('r'))).toBe(DOT_R)
    const [gx, gy] = projectionOf(container)([-87.75, 41.83])!
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(gx, 3)
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(gy, 3)
    rerender(draw({ country: 'SG' }))
    expect(glows(container)).toEqual(['SG||Singapore', 'MY||Kuala Lumpur'])
    expect(dotKeys(container)).toEqual(['SG|Singapore|Singapore']) // Kuala Lumpur is on this side, but Malaysia's
  })

  it('CRITICAL: inside a country the pointer reads the MAJOR CITY nearest it, in order, with a marker; off the sphere, nothing', () => {
    const { container } = render(draw({ country: 'US' }))
    layout(container)
    const [cx, cy] = projectionOf(container)([-87.75, 41.83])!
    fireEvent.pointerMove(svgOf(container), { clientX: cx + 1, clientY: cy })
    expect(readout(container)).toMatch(/^Chicago\s*Illinois\s*190\s*visitors\s*421\s*views$/)
    expect(container.querySelector('[data-marker]')).not.toBeNull()
    fireEvent.pointerMove(svgOf(container), { clientX: 5, clientY: 5 })
    expect(readout(container)).toBeNull()
  })

  it('CRITICAL: the reach to a city is measured on SCREEN — in a box drawn at half size, 20px off a dot still reads it (in viewBox units that was 40, past the old reach)', () => {
    const { container } = render(draw({ country: 'US' }))
    layout(container, 0.5)
    const [cx, cy] = projectionOf(container)([-87.75, 41.83])!
    fireEvent.pointerMove(svgOf(container), { clientX: cx * 0.5 + 20, clientY: cy * 0.5 })
    expect(readout(container)).toContain('Chicago')
    fireEvent.pointerMove(svgOf(container), { clientX: cx * 0.5 + 40, clientY: cy * 0.5 })
    expect(readout(container)).toBeNull()
  })

  it('with nothing placed it is still a globe, facing the prime meridian', () => {
    const { container } = render(draw({ map: { ...map, points: [], majorCities: [], countries: [] } }))
    expect(container.querySelector('[data-sphere]')).not.toBeNull()
    expect(rotationOf(container).map((v) => v || 0)).toEqual(rotationTo([0, 20]).map((v) => v || 0))
  })
})
