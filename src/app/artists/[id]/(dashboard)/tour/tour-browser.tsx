'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { OriginSection, groupByOrigin } from '../origin'
import { useOnSiteSelection } from '../use-on-site-selection'
import { publishEntityAction } from '../actions'
import { TourRow, type TourDate } from './tour-row'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  bandsintown: 'Bandsintown',
  ticketmaster: 'Ticketmaster',
  spotify: 'Spotify',
  shopify: 'Shopify',
}

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s
const ORIGIN_ORDER = ['bandsintown', 'ticketmaster', 'manual'] as const

type Sort = 'soonest' | 'latest'

/**
 * Tour list for the dashboard, mirroring the Music page: a grid of date cards,
 * filterable by source + sortable by date. Each card carries a select checkbox +
 * live/off badge; the manager picks which dates are on the site and commits with the
 * password-gated PublishBar. `trailing` holds the toolbar's + Add / import controls.
 */
export function TourBrowser({
  tours,
  artistId,
  trailing,
}: {
  tours: TourDate[]
  artistId: string
  trailing?: ReactNode
}) {
  const router = useRouter()
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('soonest')
  const { selected, toggle, pendingCount } = useOnSiteSelection(tours)

  let shown = filterBySite(tours, site)
  shown = [...shown].sort((a, b) =>
    sort === 'soonest'
      ? (a.date ?? '').localeCompare(b.date ?? '')
      : (b.date ?? '').localeCompare(a.date ?? ''),
  )

  const groups = groupByOrigin(shown, (t) => t.source ?? 'manual', ORIGIN_ORDER, sourceLabel)

  async function publish(password: string) {
    const res = await publishEntityAction('tour_date', artistId, [...selected], password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex items-center gap-3">
            <KLabel>
              {tours.length} {tours.length === 1 ? 'date' : 'dates'}
            </KLabel>
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
        }
        chips={[]}
        active=""
        onChip={() => {}}
        sortOptions={[
          { key: 'soonest', label: 'Soonest' },
          { key: 'latest', label: 'Latest' },
        ]}
        sort={sort}
        onSort={setSort}
        trailing={trailing}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="tour"
          title={siteEmptyTitle(site, 'No dates yet')}
          hint={site === 'all' ? 'Hit + Add, or sync from Bandsintown / Ticketmaster.' : undefined}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              <div>
                {g.items.map((t) => (
                  <TourRow
                    key={t.id}
                    artistId={artistId}
                    tour={t}
                    selected={selected.has(t.id)}
                    onToggleSelect={() => toggle(t.id)}
                  />
                ))}
              </div>
            </OriginSection>
          ))}
        </div>
      )}

      <PublishBar pendingCount={pendingCount} onPublish={publish} noun="tour dates" />
    </div>
  )
}
