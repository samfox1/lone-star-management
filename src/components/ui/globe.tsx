'use client'

import { useMemo, useState } from 'react'
import { geoPath, type GeoProjection } from 'd3-geo'
import { cx } from '@/lib/cx'
import { HEAT_R } from '@/lib/map-constants'
import type { MajorCityDot, WorldMapData } from '@/lib/analytics-map'
import type { GlobeGeography } from '@/lib/map-geography'
import { GLOBE_SIZE, dragRotate, faceOf, globeProjection, globeWidth, isNearSide, rotationTo, zoomScale, type Rotation } from '@/lib/globe-view'
import { CityDots, HeatDefs, HoverMarker, HoverReadout, LandLayer, ZoomControls } from '@/components/ui/map-parts'
import { useMapPointer } from '@/components/ui/use-map-pointer'

const STEP = 1.6
const HEAT_BLUR = 9
const RIM = 1
const SPHERE = { type: 'Sphere' as const }

export type GlobeProps = {
  map: WorldMapData
  /** The countries, lakes and borders as GeoJSON (lib/map-geography.ts). */
  geography: GlobeGeography
  /** The country in focus (alpha-2), or null for the audience. Set by the list or by a click here. */
  country: string | null
  onSelectCountry: (code: string | null) => void
  /** The live shape (width ÷ height) of the box the globe is drawn in; the map's frame shape when not given. */
  aspect?: number
  extra?: React.ReactNode
  className?: string
}

/** The items on the near side, each moved to where the globe draws it. */
function onGlobe<T extends { lon: number; lat: number }>(items: T[], projection: GeoProjection, rotation: Rotation): (T & { x: number; y: number })[] {
  const out: (T & { x: number; y: number })[] = []
  for (const it of items) {
    if (!isNearSide([it.lon, it.lat], rotation)) continue
    const xy = projection([it.lon, it.lat])
    if (xy) out.push({ ...it, x: xy[0], y: xy[1] })
  }
  return out
}

/**
 * WHERE THEY ARE, as a GLOBE (Sam, 2026-09-14: "a globe, shaped like the earth, that I can click
 * through"). The same per-artist data as the flat map, projected HERE by d3's orthographic projection,
 * because a turn of the globe is a new projection. lib/globe-view.ts owns the rules: it opens facing
 * the audience, a drag turns it with the land following the pointer, the far side is hidden, the tilt
 * stops short of the poles. Projecting every country is the costly part, so it is redone only for a
 * turn, a zoom or a new box shape, never for the pointer moving.
 *
 * The drawing fills the WHOLE box (a frame of the box's shape), so a zoomed sphere runs to the box's
 * edge instead of being cropped at a square inside it; at scale 1 the sphere is the height less
 * GLOBE_GAP. Painted like the map, with the same country / major-city levels, clicks and readouts
 * (use-map-pointer.ts). Choosing a country TURNS to it and never zooms (a zoomed sphere is cropped).
 */
export function Globe({ map, geography, country, onSelectCountry, aspect, extra, className }: GlobeProps) {
  const boxAspect = aspect ?? map.frame.width / map.frame.height
  const W = globeWidth(boxAspect)
  const H = GLOBE_SIZE
  /** Facing a country's centre, or the audience when there is none. */
  const facing = (code: string | null): Rotation => rotationTo(map.countries.find((x) => x.code === code)?.centroid ?? faceOf(map.points))
  const [rotation, setRotation] = useState<Rotation>(() => facing(country))
  const [scale, setScale] = useState(1)

  const drawn = useMemo(() => {
    const projection = globeProjection(rotation, scale, boxAspect)
    const path = geoPath(projection)
    return {
      projection,
      sphere: path(SPHERE) ?? '',
      lands: geography.lands.map((l) => ({ code: l.code, d: path(l.geometry) ?? '' })),
      lakes: path(geography.lakes) ?? '',
      borders: path(geography.borders) ?? '',
    }
  }, [rotation, scale, boxAspect, geography])
  const glows = useMemo(() => onGlobe(map.points, drawn.projection, rotation), [map.points, drawn, rotation])
  const dots = useMemo(
    () => (country === null ? [] : onGlobe(map.majorCities.filter((m) => m.country === country), drawn.projection, rotation)),
    [map.majorCities, country, drawn, rotation],
  )
  const selectable = useMemo(() => new Set(map.countries.map((c) => c.code)), [map.countries])
  const frame = { x: 0, y: 0, w: W, h: H }

  const { svgProps, hover, dragging, clearHover } = useMapPointer<MajorCityDot>({
    frame,
    countries: map.countries,
    country,
    dots,
    onSelectCountry,
    onCountryChange: (code) => setRotation(facing(code)),
    onDrag: (dx, dy) => setRotation((r) => dragRotate(r, dx, dy, scale)),
    onPinch: (factor) => setScale((s) => zoomScale(s, factor)),
  })

  return (
    <div className={cx('relative h-full w-full', className)} onPointerLeave={clearHover}>
      <svg
        {...svgProps}
        viewBox={`0 0 ${W} ${H}`}
        data-rotation={`${rotation[0]},${rotation[1]}`}
        data-scale={scale}
        className={cx('block h-full w-full touch-pan-y select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        role="img"
        aria-label="Where visitors are, on the globe"
      >
        <defs>
          <HeatDefs id="lsg-heat" blur={HEAT_BLUR} region={{ x: 0, y: 0, width: W, height: H }} />
          <radialGradient id="lsg-shade" cx="0.4" cy="0.35" r="0.75">
            <stop offset="0.6" style={{ stopColor: 'var(--color-ink)', stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: 'var(--color-ink)', stopOpacity: 0.12 }} />
          </radialGradient>
          <clipPath id="lsg-clip"><path d={drawn.sphere} /></clipPath>
        </defs>
        <path data-sphere d={drawn.sphere} fill="var(--color-paper)" stroke="currentColor" className="text-hairline" strokeWidth={1} />
        <LandLayer lands={drawn.lands} country={country} selectable={selectable} rim={RIM} />
        <path data-lakes d={drawn.lakes} fill="var(--color-paper)" stroke="var(--color-paper)" strokeWidth={RIM} strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
        <path data-borders d={drawn.borders} fill="none" stroke="var(--color-ink-faint)" strokeOpacity={0.55} strokeWidth={0.75} strokeLinejoin="round" opacity={1} style={{ pointerEvents: 'none' }} />
        <g filter="url(#lsg-heat)" clipPath="url(#lsg-clip)" style={{ pointerEvents: 'none' }}>
          {glows.map((p) => (
            <circle key={p.key} data-heat data-key={p.key} cx={p.x} cy={p.y} r={HEAT_R} opacity={p.heat} fill="url(#lsg-heat-glow)" />
          ))}
        </g>
        <path d={drawn.sphere} fill="url(#lsg-shade)" style={{ pointerEvents: 'none' }} />
        <CityDots dots={dots} />
        {hover?.kind === 'city' && <HoverMarker at={hover.dot} />}
      </svg>
      <HoverReadout hover={hover} frame={frame} />
      <ZoomControls onIn={() => setScale((s) => zoomScale(s, STEP))} onOut={() => setScale((s) => zoomScale(s, 1 / STEP))} extra={extra} />
    </div>
  )
}
