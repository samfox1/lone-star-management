// @vitest-environment jsdom
// The flat map as painted: heat over each country's land, lakes and grey borders; the window opening
// on the audience, zooming about the pointer, panning by drag; and the COUNTRY in focus — followed
// from above, set by a click on land — inside which the major cities are dots and the pointer reads
// the nearest one. The geography is a prop of its own (the page loads it once, not per request).
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorldMap } from '@/components/ui/world-map'
import { DOT_R, HEAT_R } from '@/lib/map-constants'
import { HEAT_PEAK, heatAlphas } from '@/lib/heat'
import type { WorldMapData } from '@/lib/analytics-map'
import type { FlatGeography } from '@/lib/map-geography'
import { fitView, worldView, type View } from '@/lib/map-view'

const geo: FlatGeography = {
  lands: [
    { code: 'US', d: 'M100,80L300,80L300,160L100,160Z' },
    { code: 'GB', d: 'M350,70L400,70L400,110L350,110Z' },
    { code: 'FR', d: 'M360,120L420,120L420,160L360,160Z' }, // no audience: inert
    { code: '', d: 'M500,200L520,200L520,220Z' }, // no code in the atlas: inert
  ],
  lakes: 'M1,1L2,1L2,2Z', coasts: 'M9,9L10,10', borders: 'M0,0L5,5', states: 'M1,1L2,2',
}
const map: WorldMapData = {
  frame: { width: 720, height: 360 },
  points: [
    { key: 'US|Illinois|Chicago', country: 'US', visitors: 186, views: 415, x: 200, y: 120, lon: -87.63, lat: 41.88 },
    { key: 'GB|England|London', country: 'GB', visitors: 12, views: 20, x: 380, y: 90, lon: -0.13, lat: 51.51 },
    { key: 'US|Illinois|Evanston', country: 'US', visitors: 4, views: 6, x: 203, y: 118, lon: -87.69, lat: 42.05 },
  ],
  majorCities: [
    { key: 'US|Illinois|Chicago', name: 'Chicago', region: 'Illinois', country: 'US', lat: 41.83, lon: -87.75, visitors: 190, views: 421, x: 200, y: 120 },
    { key: 'US|Wisconsin|Milwaukee', name: 'Milwaukee', region: 'Wisconsin', country: 'US', lat: 43.05, lon: -87.95, visitors: 7, views: 9, x: 199, y: 110 },
    { key: 'GB|England|London', name: 'London', region: 'England', country: 'GB', lat: 51.5, lon: -0.12, visitors: 12, views: 20, x: 380, y: 90 },
  ],
  other: { US: { visitors: 3, views: 4 } },
  radiusMi: 50,
  countries: [
    { code: 'US', name: 'United States', visitors: 190, views: 421, majorCities: 2, view: { x: 100, y: 60, w: 240, h: 120 }, centroid: [-98, 39] },
    { code: 'GB', name: 'United Kingdom', visitors: 12, views: 20, majorCities: 1, view: { x: 350, y: 70, w: 72, h: 36 }, centroid: [-2, 54] },
    { code: 'NZ', name: 'New Zealand', visitors: 1, views: 1, majorCities: 0, view: null, centroid: null }, // in the list, but nothing to frame
  ],
  unlocated: null,
}
const W = map.frame.width
const H = map.frame.height
const B = { width: W, height: H, aspect: W / H }
const opening = fitView(map.points, B)
const noop = () => {}
const draw = (props: Partial<Parameters<typeof WorldMap>[0]> = {}) => <WorldMap map={map} geography={geo} country={null} onSelectCountry={noop} {...props} />

/** The window, read back off the viewBox. */
const viewOf = (c: HTMLElement): View => {
  const [x, y, w, h] = c.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number)
  return { x, y, w, h }
}
const near = (a: View, b: View) => {
  for (const key of ['x', 'y', 'w', 'h'] as const) expect(a[key], key).toBeCloseTo(b[key], 3)
}
const glows = (c: HTMLElement) => [...c.querySelectorAll('[data-heat]')]
const dotKeys = (c: HTMLElement) => [...c.querySelectorAll('circle[data-city]')].map((d) => d.getAttribute('data-city'))
const svgOf = (c: HTMLElement) => c.querySelector('svg')!
const opacityOf = (c: HTMLElement, sel: string) => Number(c.querySelector(sel)!.getAttribute('opacity'))
const landOf = (c: HTMLElement, code: string) => c.querySelector(`[data-country="${code}"]`) as SVGPathElement
const zoomIn = () => fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
const readout = (c: HTMLElement) => c.querySelector('[data-readout]')?.textContent?.replace(/\s+/g, ' ') ?? null
/** jsdom has no layout: the svg is told it is drawn at (scale ×) the frame's size. */
const layout = (c: HTMLElement, scale = 1) => {
  const width = W * scale, height = H * scale
  svgOf(c).getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) })
}
/** Where a map point is on screen under the current window (with `layout` at scale 1). */
const screenOf = (c: HTMLElement, p: { x: number; y: number }) => {
  const v = viewOf(c)
  return { clientX: ((p.x - v.x) / v.w) * W, clientY: ((p.y - v.y) / v.h) * H }
}
/** A click as a BROWSER delivers it: down on the land, then — the svg has captured the pointer — up on the svg. */
const click = (c: HTMLElement, el: Element, at: { clientX: number; clientY: number }) => {
  fireEvent.pointerDown(el, { ...at, pointerId: 1, button: 0 })
  fireEvent.pointerUp(svgOf(c), { ...at, pointerId: 1 })
}

describe('WorldMap — painting', () => {
  it('CRITICAL: every country is its own path, then borders and state lines, then the lakes OVER those lines, then coastlines, and the heat OVER all of it', () => {
    const { container } = render(draw())
    const lands = [...container.querySelectorAll('[data-land]')]
    expect(lands.map((l) => l.getAttribute('data-country'))).toEqual(['US', 'GB', 'FR', ''])
    expect(landOf(container, 'US').getAttribute('d')).toBe(geo.lands[0].d)
    const lakes = container.querySelector('[data-lakes]')!
    const coasts = container.querySelector('[data-coasts]')!
    const borders = container.querySelector('[data-borders]')!
    const states = container.querySelector('[data-states]')!
    expect([lakes.getAttribute('d'), coasts.getAttribute('d'), borders.getAttribute('d'), states.getAttribute('d')]).toEqual([geo.lakes, geo.coasts, geo.borders, geo.states])
    expect(after(lands[3], borders)).toBe(true)
    expect(after(borders, states)).toBe(true)
    // A lake covers the border and state lines that run through its water (Sam, 2026-09-15: lines across
    // Lake Erie and Lake Michigan looked "not accurate").
    expect(after(states, lakes)).toBe(true)
    expect(after(lakes, coasts)).toBe(true)
    expect(after(coasts, glows(container)[0])).toBe(true) // lines never sit on top of the heat (Sam, 2026-09-14)
  })

  it('CRITICAL: two shapes under ONE country code render cleanly — the 1:50m atlas has AU twice, and a key by code alone made React drop one', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(draw({ geography: { ...geo, lands: [...geo.lands, { code: 'US', d: 'M600,300L610,300L610,310Z' }] } }))
    expect(container.querySelectorAll('[data-country="US"]')).toHaveLength(2)
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    errors.mockRestore()
  })

  it('CRITICAL: a heat glow per city, at its point, as warm as its visitors, blurred', () => {
    const { container } = render(draw())
    expect(glows(container).map((g) => [g.getAttribute('cx'), g.getAttribute('cy')])).toEqual([['200', '120'], ['380', '90'], ['203', '118']])
    // As warm as its share of the busiest spot ON SCREEN (lib/heat.ts), measured at the zoom it is seen at.
    const expected = heatAlphas(map.points, HEAT_R / (W / viewOf(container).w))
    glows(container).forEach((g, i) => expect(Number(g.getAttribute('opacity')), `glow ${i}`).toBeCloseTo(expected[i], 6))
    zoomIn()
    const deeper = heatAlphas(map.points, HEAT_R / (W / viewOf(container).w))
    glows(container).forEach((g, i) => expect(Number(g.getAttribute('opacity')), `glow ${i} deeper`).toBeCloseTo(deeper[i], 6))
    expect(glows(container)[0].parentElement!.getAttribute('filter')).toMatch(/^url\(#/)
  })

  it('CRITICAL: the colour ramp can reach DARK red at the busiest spot — Sam, 2026-09-15: "it should be able to get dark red"', () => {
    const { container } = render(draw())
    const table = (ch: string) => container.querySelector(`feFunc${ch}`)!.getAttribute('tableValues')!.split(' ').map(Number)
    const [r, g, b, a] = ['R', 'G', 'B', 'A'].map(table)
    const top = r.length - 1
    const lightness = (i: number) => 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i]
    expect(r[top]).toBeGreaterThan(g[top] * 3) // red
    expect(lightness(top)).toBeLessThan(lightness(top - 2) * 0.7) // clearly darker than the plain red below it
    expect(a[top]).toBeGreaterThanOrEqual(HEAT_PEAK)
  })

  it('CRITICAL: the glow is a screen-size thing — zooming in on a city does not zoom in on its heat', () => {
    const { container } = render(draw())
    const glow = () => Number(container.querySelector('[data-heat]')!.getAttribute('r'))
    expect(glow()).toBeCloseTo(HEAT_R / (W / viewOf(container).w), 4)
    zoomIn()
    expect(glow()).toBeCloseTo(HEAT_R / (W / viewOf(container).w), 4)
  })

  it('CRITICAL: country borders are always drawn and the US state lines fade in with zoom — both GREY, which the pale land shows (white could not be seen)', () => {
    const { container } = render(draw())
    for (const sel of ['[data-coasts]', '[data-lakes]', '[data-borders]', '[data-states]']) expect(container.querySelector(sel)!.getAttribute('stroke'), sel).toBe('var(--color-ink-faint)')
    expect(opacityOf(container, '[data-borders]')).toBe(1)
    expect(opacityOf(container, '[data-coasts]')).toBe(1)
    expect(opacityOf(container, '[data-states]')).toBe(0)
    for (let i = 0; i < 5; i++) zoomIn() // → 10×, the cap
    expect(opacityOf(container, '[data-borders]')).toBe(1)
    expect(opacityOf(container, '[data-states]')).toBe(1)
  })

  it('CRITICAL: coastlines and lake shores are drawn in the SAME grey line as the borders, the same width on screen — Sam, 2026-09-15: "I want the borders to be on the coastlines too"', () => {
    const { container } = render(draw())
    for (const sel of ['[data-coasts]', '[data-lakes]']) {
      const el = container.querySelector(sel)!
      const border = container.querySelector('[data-borders]')!
      for (const attr of ['stroke', 'stroke-width', 'stroke-opacity']) expect(el.getAttribute(attr), `${sel} ${attr}`).toBe(border.getAttribute(attr))
    }
    expect(container.querySelector('[data-coasts]')!.getAttribute('fill')).toBe('none')
    zoomIn()
    expect(container.querySelector('[data-coasts]')!.getAttribute('stroke-width')).toBe(container.querySelector('[data-borders]')!.getAttribute('stroke-width'))
  })

  it('CRITICAL: the land keeps a white rim that keeps its width on screen, so neighbouring fills stay apart', () => {
    const { container } = render(draw())
    const k0 = W / viewOf(container).w
    for (const sel of ['[data-country="US"]']) {
      const el = container.querySelector(sel)!
      expect(el.getAttribute('stroke'), sel).toBe('var(--color-paper)')
      expect(Number(el.getAttribute('stroke-width')), sel).toBeCloseTo(1 / k0, 4)
    }
    zoomIn()
    expect(Number(landOf(container, 'US').getAttribute('stroke-width'))).toBeCloseTo(1 / (W / viewOf(container).w), 4)
  })

  it('with nothing placed it still draws the coastlines, and no glow', () => {
    const { container } = render(draw({ map: { ...map, points: [], majorCities: [], countries: [] } }))
    expect(container.querySelectorAll('[data-land]')).toHaveLength(4)
    expect(glows(container)).toHaveLength(0)
  })
})

describe('WorldMap — the country in focus', () => {
  it('CRITICAL: follows `country` from above — the country\'s frame in, the world out; a country with nothing to frame shows the world', () => {
    const { container, rerender } = render(draw())
    near(viewOf(container), opening)
    rerender(draw({ country: 'GB' }))
    near(viewOf(container), map.countries[1].view!)
    expect(landOf(container, 'GB').getAttribute('data-selected')).toBe('true')
    expect(landOf(container, 'US').getAttribute('data-selected')).toBeNull()
    rerender(draw({ country: 'US' }))
    near(viewOf(container), map.countries[0].view!)
    rerender(draw({ country: 'NZ' }))
    near(viewOf(container), worldView(B))
    rerender(draw({ country: null }))
    near(viewOf(container), worldView(B))
  })

  it('CRITICAL: mounted with a country already in focus, it starts ON that country — the view switch must not lose the place', () => {
    const { container } = render(draw({ country: 'GB' }))
    near(viewOf(container), map.countries[1].view!)
  })

  it('CRITICAL: a click selects the country it STARTED on — with pointer capture the pointer-up lands on the svg, and a click on the real map selected nothing', () => {
    const onSelect = vi.fn()
    const { container } = render(draw({ onSelectCountry: onSelect }))
    layout(container)
    click(container, landOf(container, 'GB'), { clientX: 300, clientY: 200 })
    expect(onSelect).toHaveBeenCalledWith('GB')
  })

  it('CRITICAL: a drag does not select; a country with no audience, or no code, or open water, is inert', () => {
    const onSelect = vi.fn()
    const { container } = render(draw({ onSelectCountry: onSelect }))
    layout(container)
    fireEvent.pointerDown(landOf(container, 'US'), { clientX: 200, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svgOf(container), { clientX: 260, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(svgOf(container), { clientX: 260, clientY: 200, pointerId: 1 })
    click(container, landOf(container, 'FR'), { clientX: 300, clientY: 200 })
    click(container, container.querySelector('[data-country=""]')!, { clientX: 300, clientY: 200 })
    click(container, svgOf(container), { clientX: 10, clientY: 10 })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('CRITICAL: at the country level the pointer reads the COUNTRY under it — name, then visitors, then views, no marker — and nothing over one with no audience', () => {
    const { container } = render(draw())
    layout(container)
    fireEvent.pointerMove(landOf(container, 'GB'), { clientX: 380, clientY: 90 })
    expect(readout(container)).toMatch(/^United Kingdom\s*12\s*visitors\s*20\s*views$/)
    expect(container.querySelector('[data-marker]')).toBeNull()
    fireEvent.pointerMove(landOf(container, 'FR'), { clientX: 390, clientY: 140 })
    expect(readout(container)).toBeNull()
    fireEvent.pointerMove(svgOf(container), { clientX: 10, clientY: 10 })
    expect(readout(container)).toBeNull()
  })

  it('CRITICAL: inside a country, one small dot per MAJOR CITY of that country, on the city, screen-sized, over the heat — none at the country level', () => {
    const { container, rerender } = render(draw())
    expect(dotKeys(container)).toEqual([])
    rerender(draw({ country: 'US' }))
    expect(dotKeys(container)).toEqual(['US|Illinois|Chicago', 'US|Wisconsin|Milwaukee'])
    const dots = [...container.querySelectorAll('circle[data-city]')]
    expect(dots.map((d) => [d.getAttribute('cx'), d.getAttribute('cy')])).toEqual([['200', '120'], ['199', '110']])
    const k = W / viewOf(container).w
    for (const d of dots) expect(Number(d.getAttribute('r'))).toBeCloseTo(DOT_R / k, 4)
    expect(DOT_R).toBeLessThanOrEqual(2.5)
    expect(after(glows(container)[2], dots[0])).toBe(true)
  })

  it('CRITICAL: inside a country the pointer reads the MAJOR CITY nearest it — name, state, visitors, views, a marker on its dot — and nothing away from every dot, measured on screen', () => {
    const { container } = render(draw({ country: 'US' }))
    layout(container)
    const svg = svgOf(container)
    const mke = screenOf(container, map.majorCities[1])
    fireEvent.pointerMove(svg, { clientX: mke.clientX + 2, clientY: mke.clientY })
    expect(readout(container)).toMatch(/^Milwaukee\s*Wisconsin\s*7\s*visitors\s*9\s*views$/)
    const marker = container.querySelector('[data-marker]')!
    expect([marker.getAttribute('cx'), marker.getAttribute('cy')]).toEqual(['199', '110'])
    const chi = screenOf(container, map.majorCities[0])
    fireEvent.pointerMove(svg, { clientX: chi.clientX, clientY: chi.clientY + 2 })
    expect(readout(container)).toMatch(/^Chicago\s*Illinois\s*190\s*visitors\s*421\s*views$/)
    fireEvent.pointerMove(svg, { clientX: mke.clientX + 40, clientY: mke.clientY - 40 })
    expect(readout(container)).toBeNull()
    zoomIn()
    const deeper = screenOf(container, map.majorCities[1])
    fireEvent.pointerMove(svg, { clientX: deeper.clientX + 40, clientY: deeper.clientY - 40 })
    expect(readout(container)).toBeNull()
    fireEvent.pointerMove(svg, { clientX: deeper.clientX + 6, clientY: deeper.clientY })
    expect(readout(container)).toContain('Milwaukee')
  })
})

describe('WorldMap — the window', () => {
  it('CRITICAL: opens on the audience, not on the world', () => {
    const { container } = render(draw())
    near(viewOf(container), opening)
    expect(opening).not.toEqual(worldView(B))
  })

  it('a live `aspect` from the box overrides the frame\'s shape', () => {
    const { container } = render(draw({ aspect: 1 }))
    const v = viewOf(container)
    expect(v.w / v.h).toBeCloseTo(1, 6)
  })

  it('with nothing placed it opens on the world', () => {
    const { container } = render(draw({ map: { ...map, points: [] } }))
    near(viewOf(container), worldView(B))
  })

  it('plus zooms in about the centre and minus zooms out', () => {
    const { container } = render(draw())
    const v0 = viewOf(container)
    zoomIn()
    const v1 = viewOf(container)
    expect(v1.w).toBeLessThan(v0.w)
    expect(v1.x + v1.w / 2).toBeCloseTo(v0.x + v0.w / 2, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    near(viewOf(container), v0)
  })

  it('CRITICAL: dragging moves the window with the pointer — drag left, see further right', () => {
    const { container } = render(draw())
    layout(container)
    const v0 = viewOf(container)
    const svg = svgOf(container)
    // Left and UP: the opening window already sits at the top of the map, so up is the way that can move.
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 200, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 180, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 250, clientY: 180, pointerId: 1 })
    const v1 = viewOf(container)
    expect(v1.x - v0.x).toBeCloseTo(50 * (v0.w / W), 3)
    expect(v1.y - v0.y).toBeCloseTo(20 * (v0.h / H), 3)
  })

  it('a pinch or ctrl-scroll zooms about the pointer; a plain scroll is left to the page', () => {
    const { container } = render(draw())
    layout(container)
    const v0 = viewOf(container)
    const svg = svgOf(container)
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 })
    near(viewOf(container), v0)
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100, ctrlKey: true })
    const v1 = viewOf(container)
    expect(v1.w).toBeLessThan(v0.w)
    const under = (v: View) => ({ x: v.x + (100 / W) * v.w, y: v.y + (100 / H) * v.h })
    expect(under(v1).x).toBeCloseTo(under(v0).x, 3)
    expect(under(v1).y).toBeCloseTo(under(v0).y, 3)
  })

  it('CRITICAL: after the box grows taller, a pinch still zooms about the point under the pointer — moves started from the STORED window, not the one on screen, and the map slid', () => {
    const { container, rerender } = render(draw())
    layout(container)
    zoomIn()
    zoomIn()
    const svg = svgOf(container)
    // Drag the window down to the map's bottom edge. In a taller box it no longer fits there, so what is
    // SHOWN sits higher than what is stored; only a move that starts from the shown window keeps the
    // point under the pointer. (Away from an edge the two agree, and a test there proves nothing.)
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 300, pointerId: 1, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 300, clientY: -3000, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 300, clientY: -3000, pointerId: 1 })
    rerender(draw({ aspect: 1 }))
    layout(container)
    const v0 = viewOf(container)
    expect(v0.y + v0.h).toBeCloseTo(H, 3)
    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100, ctrlKey: true })
    const v1 = viewOf(container)
    expect(v1.w).toBeLessThan(v0.w)
    const under = (v: View) => ({ x: v.x + (100 / W) * v.w, y: v.y + (100 / H) * v.h })
    expect(under(v1).x).toBeCloseTo(under(v0).x, 3)
    expect(under(v1).y).toBeCloseTo(under(v0).y, 3)
  })
})
