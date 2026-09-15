'use client'

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { WorldMap } from '@/components/ui/world-map'
import { MapButton, ZoomControls } from '@/components/ui/map-parts'
import { useGeography } from '@/components/ui/map-geography-loader'
import type { WorldMapData } from '@/lib/analytics-map'

/** The globe, with d3's projection code, is its own chunk: fetched when the globe is first asked for. */
const loadGlobe = () => import('@/components/ui/globe')
const Globe = lazy(() => loadGlobe().then((m) => ({ default: m.Globe })))

/** The box's shape until it has been measured: its CSS aspect below. */
const BOX_ASPECT = 2

type ViewKey = 'map' | 'globe'

/**
 * WHERE THEY ARE — the flat map or the globe, one at a time, off the same data (Sam, 2026-09-14: "a
 * flat map view and then a globe"). The map first: it shows everything at once. ONE button switches,
 * beside plus / minus, and it shows the OTHER view's glyph: a globe while the map is up, a map while
 * the globe is up (Sam: "if we see the globe icon, that means we're on map mode"). No tabs.
 *
 * ONE box for both, 2:1, and the box SETS THE ROW'S HEIGHT; on the page the list beside it scrolls
 * inside that height. The BOX wears the hairline border, so both views have the same grey edge. Its
 * live shape goes to both views. The geography loads once (map-geography-loader.ts); until it has,
 * the box shows its controls, off, in the same place. The country in focus is owned above
 * (PlacesSection) and passed through.
 */
export function PlacesView({ map, country, onSelectCountry, className }: { map: WorldMapData; country: string | null; onSelectCountry: (code: string | null) => void; className?: string }) {
  const [view, setView] = useState<ViewKey>('map')
  const box = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState(BOX_ASPECT)
  const flat = useGeography('flat', view === 'map')
  const globe = useGeography('globe', view === 'globe')

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setAspect(width / height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const other: ViewKey = view === 'map' ? 'globe' : 'map'
  const toggle = (
    <MapButton
      label={other === 'globe' ? 'Show globe' : 'Show map'}
      onClick={() => {
        // Start the globe's code on the click, alongside its geography, not after it.
        if (other === 'globe') void loadGlobe()
        setView(other)
      }}
    >
      <Icon name={other} size={14} />
    </MapButton>
  )
  const props = { map, country, onSelectCountry, aspect, extra: toggle }

  return (
    <div ref={box} data-view={view} className={cx('relative aspect-[2/1] w-full overflow-hidden border border-hairline', className)}>
      <div className="absolute inset-0">
        {view === 'map'
          ? flat.geography ? <WorldMap {...props} geography={flat.geography} /> : <Waiting extra={toggle} failed={flat.failed} />
          : globe.geography
            ? <Suspense fallback={<Waiting extra={toggle} failed={false} />}><Globe {...props} geography={globe.geography} /></Suspense>
            : <Waiting extra={toggle} failed={globe.failed} />}
      </div>
    </div>
  )
}

/** The box before its geography arrives: the controls where they will be, zoom off, the switch live. */
function Waiting({ extra, failed }: { extra: ReactNode; failed: boolean }) {
  return (
    <div className="relative h-full w-full" aria-busy={!failed}>
      {failed && <p className="absolute inset-0 flex items-center justify-center font-space text-xs text-ink-faint">Map unavailable.</p>}
      <ZoomControls extra={extra} />
    </div>
  )
}
