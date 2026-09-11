'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { Segmented } from '../segmented'
import { OriginSection } from '../origin'
import { useLiveOnSite } from '../use-live-on-site'
import { publishEntityAction } from '../actions'
import { TourRow, type TourDate } from './tour-row'

type Sort = 'soonest' | 'latest'
/** Time lens: shows still to come, shows that already happened, or everything. */
type When = 'upcoming' | 'past' | 'all'

const WHEN_OPTS: { key: When; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
]

/** Today as a local YYYY-MM-DD string, comparable against a date column of the same shape. */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A show is PAST if it's flagged an old show OR its date has passed — the same rule
 *  the public site classifies by (mapSite.ts). Today counts as upcoming; an undated,
 *  unflagged row reads as upcoming (a TBA date) so it never hides. */
function isPast(t: TourDate, today: string): boolean {
  return t.is_past || (!!t.date && t.date < today)
}

function filterByWhen(items: TourDate[], when: When, today: string): TourDate[] {
  if (when === 'all') return items
  return items.filter((t) => (when === 'upcoming' ? !isPast(t, today) : isPast(t, today)))
}

/**
 * Tour list for the dashboard, mirroring the Music page: a grid of date cards,
 * filterable by source + sortable by date. Each row's checkbox is a LIVE on-site
 * toggle (ADR 0009) — it writes immediately and the public site follows without a
 * publish, the same control the editor gives tour dates. The PublishBar publishes the
 * date CONTENT (venues, lineups), which stays password-gated. `trailing` holds the
 * toolbar's + Add / import controls.
 */
export function TourBrowser({
  tours,
  artistId,
  dirty = false,
  trailing,
}: {
  tours: TourDate[]
  artistId: string
  /** Unpublished content edits — what lights up the PublishBar now that presence is live. */
  dirty?: boolean
  trailing?: ReactNode
}) {
  const router = useRouter()
  const today = todayStr()
  const [site, setSite] = useState<SiteFilter>('all')
  // Default to All so every date is visible at a glance; the sort below floats the
  // upcoming ones to the top of that list.
  const [when, setWhen] = useState<When>('all')
  const [sort, setSort] = useState<Sort>('soonest')
  const { onSite, toggle } = useLiveOnSite(tours, 'tour', artistId)

  // Date order only; the Upcoming-above-Past ordering is the SECTION split below, so no
  // need to also sort by is_past here.
  let shown = filterByWhen(filterBySite(tours, site), when, today)
  shown = [...shown].sort((a, b) =>
    sort === 'soonest'
      ? (a.date ?? '').localeCompare(b.date ?? '')
      : (b.date ?? '').localeCompare(a.date ?? ''),
  )

  // Group by WHEN into collapsible sections (like the Videos page's type sections),
  // Upcoming above Past. The `when` filter above already narrows to one section in the
  // Upcoming/Past views; All shows both. Empty sections drop out. `isPast` matches the
  // public site's rule (is_past OR the date has passed) so the preview agrees.
  const sections = [
    { key: 'upcoming', label: 'Upcoming', items: shown.filter((t) => !isPast(t, today)) },
    { key: 'past', label: 'Past', items: shown.filter((t) => isPast(t, today)) },
  ].filter((s) => s.items.length > 0)

  async function publish(password: string) {
    // Snapshot only — no reconcile. The on-site set is already whatever the toggles say.
    const res = await publishEntityAction('tour_date', artistId, password)
    if (res.ok) router.refresh()
    return res
  }

  const row = (t: TourDate) => (
    <TourRow
      key={t.id}
      artistId={artistId}
      tour={t}
      onSite={onSite(t.id)}
      onToggleOnSite={() => toggle(t.id)}
    />
  )

  return (
    // Filter row and date list share the full max-w-4xl width — a date row carries a
    // venue, place, lineup and ticket link, so the old max-w-2xl bunched them up.
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

      <div className="mx-auto max-w-4xl">
        {sections.length === 0 ? (
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
            {sections.map((s) => (
              <OriginSection key={s.key} label={s.label} count={s.items.length}>
                <div>{s.items.map(row)}</div>
              </OriginSection>
            ))}
          </div>
        )}
      </div>

      <PublishBar pendingCount={0} dirty={dirty} onPublish={publish} noun="tour dates" />
    </div>
  )
}
