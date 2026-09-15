'use client'

import { useMemo, useState } from 'react'
import { cx } from '@/lib/cx'
import { HEAT_R } from '@/lib/map-constants'
import { heatAlphas } from '@/lib/heat'
import type { MajorCityDot, WorldMapData } from '@/lib/analytics-map'
import type { FlatGeography } from '@/lib/map-geography'
import { clampView, fadeIn, fitView, fitWindow, panView, worldView, zoomView, type Bounds, type View } from '@/lib/map-view'
import { CityDots, greyLine, HeatDefs, HoverMarker, HoverReadout, LandLayer, ZoomControls } from '@/components/ui/map-parts'
import { useMapPointer } from '@/components/ui/use-map-pointer'

const STEP = 1.6
/** Blur under the heat, in screen px. */
const HEAT_BLUR = 5
/** Where the US state lines fade in (zoom from → to). Country borders are always drawn. */
const STATES_FADE: [number, number] = [3, 5]
/** The white rim on coasts and lakes, in screen px: half of it lands inside the grey, which is the part that shows. */
const RIM = 1

export type WorldMapProps = {
  map: WorldMapData
  /** The countries, lakes and lines, the same for everyone (lib/map-geography.ts). */
  geography: FlatGeography
  /** The country in focus (alpha-2), or null for the world. Set by the list or by a click here. */
  country: string | null
  onSelectCountry: (code: string | null) => void
  /** The live shape (width ÷ height) of the box the map is drawn in; the frame's own shape when not given. */
  aspect?: number
  /** A control the page adds beside plus / minus (the map / globe switch). */
  extra?: React.ReactNode
  className?: string
}

/**
 * WHERE THEY ARE, drawn flat. The geography comes projected (Mercator) and the per-artist points
 * projected on the server (lib/analytics-map.ts); this paints them: each country's land in the track
 * grey with a white rim, the lakes cut out, the borders between countries and — as the map zooms in —
 * the US state lines, all in a soft grey, and over every line one glow per city, blurred into heat.
 *
 * COUNTRY: the broadest view is countries. A click on a country with an audience here or in the list
 * frames the country; `country` is owned above (PlacesSection) so the map, the globe and the list
 * agree. Inside a country its MAJOR CITIES are small dots, the same as the list's. The pointer
 * (use-map-pointer.ts) reads the country at the country level and the nearest major city inside one.
 *
 * The window OPENS on the audience. Drag to move, plus / minus or a pinch (ctrl + scroll) to zoom about
 * the pointer; a plain scroll is left to the page. The window is the SVG viewBox (lib/map-view.ts owns
 * its rules). What is shown is the stored window re-clamped into the box's current shape, and every
 * move starts from THAT, so a box that changed shape does not make the map jump. Glows, blur, lines and
 * dots are drawn ÷ zoom so they keep their size on screen.
 */
export function WorldMap({ map, geography, country, onSelectCountry, aspect, extra, className }: WorldMapProps) {
  const bounds: Bounds = { width: map.frame.width, height: map.frame.height, aspect: aspect ?? map.frame.width / map.frame.height }
  const frameOf = (code: string | null) => {
    const c = code === null ? undefined : map.countries.find((x) => x.code === code)
    return c?.view ? fitWindow(c.view, bounds) : null
  }
  const [stored, setView] = useState<View>(() => frameOf(country) ?? fitView(map.points, bounds))
  const view = clampView(stored, bounds)
  const k = map.frame.width / view.w
  const selectable = useMemo(() => new Set(map.countries.map((c) => c.code)), [map.countries])
  const dots = useMemo(() => (country === null ? [] : map.majorCities.filter((m) => m.country === country)), [map.majorCities, country])
  /** How hot each city glows: its share of the busiest spot at THIS zoom, where a glow reaches HEAT_R screen px. */
  const alphas = useMemo(() => heatAlphas(map.points, HEAT_R / k), [map.points, k])
  /** Apply a move to the window as it is SHOWN. */
  const move = (f: (shown: View) => View) => setView((v) => f(clampView(v, bounds)))

  const { svgProps, hover, dragging, clearHover } = useMapPointer<MajorCityDot>({
    frame: view,
    countries: map.countries,
    country,
    dots,
    onSelectCountry,
    // A country frames it; the world, or a country with nothing to frame, shows the world.
    onCountryChange: (code) => setView(frameOf(code) ?? worldView(bounds)),
    onDrag: (dx, dy, rect) => move((v) => panView(v, (-dx / rect.width) * v.w, (-dy / rect.height) * v.h, bounds)),
    onPinch: (factor, at) => move((v) => zoomView(v, factor, at, bounds)),
  })
  const zoomCentre = (factor: number) => move((v) => zoomView(v, factor, { x: v.x + v.w / 2, y: v.y + v.h / 2 }, bounds))
  /** The heat filter covers the window and a glow's reach around it, not three worlds. */
  const reach = (HEAT_R + 3 * HEAT_BLUR) / k

  return (
    <div className={cx('relative h-full w-full', className)} onPointerLeave={clearHover}>
      <svg
        {...svgProps}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={cx('block h-full w-full touch-pan-y select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        role="img"
        aria-label="Where visitors are"
      >
        <defs>
          <HeatDefs id="lsm-heat" blur={HEAT_BLUR / k} region={{ x: view.x - reach, y: view.y - reach, width: view.w + 2 * reach, height: view.h + 2 * reach }} />
        </defs>
        <LandLayer lands={geography.lands} country={country} selectable={selectable} rim={RIM / k} />
        {/* Every line sits UNDER the heat (Sam, 2026-09-14: "they shouldn't be on top of the heat maps"),
            and in GREY: white on the pale grey land could not be seen at any zoom. */}
        <path data-borders d={geography.borders} fill="none" {...greyLine(k)} opacity={1} />
        <path data-states d={geography.states} fill="none" stroke="var(--color-ink-faint)" strokeOpacity={0.4} strokeWidth={0.5 / k} strokeLinejoin="round" opacity={fadeIn(k, ...STATES_FADE)} style={{ pointerEvents: 'none' }} />
        {/* The lakes go OVER the border and state lines: those lines run through the water (the US–Canada
            border down Lake Erie), and drawn across a lake they read as mistakes (Sam, 2026-09-15). */}
        <path data-lakes d={geography.lakes} fill="var(--color-paper)" {...greyLine(k)} />
        <path data-coasts d={geography.coasts} fill="none" {...greyLine(k)} opacity={1} />
        <g filter="url(#lsm-heat)" style={{ pointerEvents: 'none' }}>
          {map.points.map((p, i) => (
            <circle key={p.key} data-heat data-key={p.key} cx={p.x} cy={p.y} r={HEAT_R / k} opacity={alphas[i]} fill="url(#lsm-heat-glow)" />
          ))}
        </g>
        <CityDots dots={dots} k={k} />
        {hover?.kind === 'city' && <HoverMarker at={hover.dot} k={k} />}
      </svg>
      <HoverReadout hover={hover} frame={view} />
      <ZoomControls onIn={() => zoomCentre(STEP)} onOut={() => zoomCentre(1 / STEP)} extra={extra} />
    </div>
  )
}
