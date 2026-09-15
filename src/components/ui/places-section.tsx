'use client'

import { useState } from 'react'
import { PlacesView } from '@/components/ui/places-view'
import { CityTable } from '@/components/ui/city-table'
import type { WorldMapData } from '@/lib/analytics-map'

/**
 * WHERE THEY ARE — the map / globe box and the list beside it, sharing ONE country in focus (Sam,
 * 2026-09-14): the broadest view is countries; click a country on the map, on the globe or in the list
 * and all three go to it. The box frames the country, the list turns to its major cities and the box
 * draws them as dots; the country's name at the top of the list is the way out.
 *
 * The box sets the row's height; the list is laid absolutely in its cell from lg up so the cell adds
 * no height of its own and the list scrolls inside it.
 */
export function PlacesSection({ map }: { map: WorldMapData }) {
  const [country, setCountry] = useState<string | null>(null)
  return (
    <div className="grid items-stretch gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
      <PlacesView map={map} country={country} onSelectCountry={setCountry} />
      <div className="relative min-h-0">
        <CityTable
          countries={map.countries}
          unlocated={map.unlocated}
          majorCities={map.majorCities}
          other={map.other}
          radiusMi={map.radiusMi}
          country={country}
          onSelectCountry={setCountry}
          className="lg:absolute lg:inset-0"
        />
      </div>
    </div>
  )
}
