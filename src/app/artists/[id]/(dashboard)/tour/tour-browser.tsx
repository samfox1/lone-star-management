'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { Segmented } from '../segmented'
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
/** Time lens: shows still to come, shows that already happened, or everything. */
type When = 'upcoming' | 'past' | 'all'

const WHEN_OPTS: { key: When; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
]

/** Today as a local YYYY-MM-DD string, comparable against a date column of the same shape. */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Split by date around `today`. Today's shows count as upcoming; an undated row
 *  (rare) reads as upcoming so it never hides in the default view. */
function filterByWhen(items: TourDate[], when: When, today: string): TourDate[] {
  if (when === 'all') return items
  return items.filter((t) => {
    const d = t.date ?? ''
    if (!d) return when === 'upcoming'
    return when === 'upcoming' ? d >= today : d < today
  })
}

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
  const [when, setWhen] = useState<When>('upcoming')
  const [sort, setSort] = useState<Sort>('soonest')
  const { selected, toggle, pendingCount } = useOnSiteSelection(tours)

  let shown = filterByWhen(filterBySite(tours, site), when, todayStr())
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

  const row = (t: TourDate) => (
    <TourRow
      key={t.id}
      artistId={artistId}
      tour={t}
      selected={selected.has(t.id)}
      onToggleSelect={() => toggle(t.id)}
    />
  )

  return (
    // The filter row spans wider than the date list (max-w-4xl vs the inner
    // max-w-2xl) so the controls have room to breathe over a narrow list.
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex flex-wrap items-center gap-3">
            <KLabel>
              {tours.length} {tours.length === 1 ? 'date' : 'dates'}
            </KLabel>
            <Segmented label="Filter by date" options={WHEN_OPTS} value={when} onChange={setWhen} />
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

      <div className="mx-auto max-w-2xl">
        {groups.length === 0 ? (
          <EmptyState
            icon="tour"
            title={
              site !== 'all'
                ? siteEmptyTitle(site, 'No dates yet')
                : when === 'upcoming'
                  ? 'No upcoming dates'
                  : when === 'past'
                    ? 'No past dates'
                    : 'No dates yet'
            }
            hint={
              site === 'all' && when === 'all'
                ? 'Hit + Add, or sync from Bandsintown / Ticketmaster.'
                : undefined
            }
          />
        ) : (
          <div className="space-y-8">
            {groups.map((g) =>
              // Manual is the default origin — no section header/chevron, just the
              // rows. Synced origins (Bandsintown / Ticketmaster) keep their header.
              g.key === 'manual' ? (
                <div key={g.key}>{g.items.map(row)}</div>
              ) : (
                <OriginSection key={g.key} label={g.label} count={g.items.length}>
                  <div>{g.items.map(row)}</div>
                </OriginSection>
              ),
            )}
          </div>
        )}
      </div>

      <PublishBar pendingCount={pendingCount} onPublish={publish} noun="tour dates" />
    </div>
  )
}
