'use client'

import { useState } from 'react'
import { FilterBar } from '../filter-bar'
import { TourRow, type TourDate } from './tour-row'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  bandsintown: 'Bandsintown',
  ticketmaster: 'Ticketmaster',
  spotify: 'Spotify',
  shopify: 'Shopify',
}

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s

type Sort = 'soonest' | 'latest'

/**
 * Tour list for the dashboard: filter dates by where they came from
 * (Bandsintown / Ticketmaster / Manual) + sort by date. Client-side over the
 * full list the server passed.
 */
export function TourBrowser({ tours, artistId }: { tours: TourDate[]; artistId: string }) {
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState<Sort>('soonest')

  const sources = Array.from(new Set(tours.map((t) => t.source ?? 'manual')))

  let shown = source === 'all' ? tours : tours.filter((t) => (t.source ?? 'manual') === source)
  shown = [...shown].sort((a, b) =>
    sort === 'soonest'
      ? (a.date ?? '').localeCompare(b.date ?? '')
      : (b.date ?? '').localeCompare(a.date ?? ''),
  )

  return (
    <div className="space-y-4">
      {tours.length > 0 && (
        <FilterBar
          chips={[
            { key: 'all', label: 'All' },
            ...(sources.length > 1 ? sources.map((s) => ({ key: s, label: sourceLabel(s) })) : []),
          ]}
          active={source}
          onChip={setSource}
          sortOptions={[
            { key: 'soonest', label: 'Soonest' },
            { key: 'latest', label: 'Latest' },
          ]}
          sort={sort}
          onSort={setSort}
        />
      )}

      {shown.length > 0 ? (
        <div>
          {shown.map((t) => (
            <TourRow key={t.id} artistId={artistId} tour={t} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
          {source === 'all' ? 'No upcoming dates.' : `No ${sourceLabel(source)} dates.`}
        </p>
      )}
    </div>
  )
}
