'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'
import { OriginSection, groupByOrigin } from '../origin'
import { useOnSiteSelection } from '../use-on-site-selection'
import { publishReleasesAction } from '../actions'
import { ReleaseCard, type Release } from '../releases/release-card'
import { RefreshButton } from './refresh-button'

type Sort = 'newest' | 'oldest' | 'az'

// Music groups by RELEASE TYPE (its natural category) rather than catalog source —
// releases nearly all share one source, but singles/EPs/albums is how a manager thinks.
const TYPE_LABEL: Record<string, string> = {
  single: 'Singles',
  ep: 'EPs',
  album: 'Albums',
  featured: 'Featured',
}
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t
const TYPE_ORDER = ['single', 'ep', 'album', 'featured'] as const

function sorted(releases: Release[], sort: Sort): Release[] {
  const copy = [...releases]
  if (sort === 'az') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'newest') return copy.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
  // oldest: ascending, undated last
  return copy.sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
}

/**
 * Releases view: a filterable, sortable list of the artist's releases. Each row
 * carries a select checkbox and a live/off indicator; an album/EP expands to its
 * tracklist. The manager selects which releases should be on the site, then hits
 * Publish — a password-gated commit (PublishBar) that flips visibility and
 * snapshots content. Selection re-syncs to the server's live truth after a
 * publish (keyed on which releases are actually visible).
 */
export function ReleasesBrowser({
  releases,
  artistId,
  artistSlug,
  refreshAction,
}: {
  releases: Release[]
  artistId: string
  artistSlug: string
  refreshAction: () => Promise<{ ok: boolean; error?: string }>
}) {
  const router = useRouter()
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const { selected, toggle: toggleSelect, pendingCount } = useOnSiteSelection(releases)

  const shown = sorted(filterBySite(releases, site), sort)
  const groups = groupByOrigin(shown, (r) => r.release_type, TYPE_ORDER, typeLabel)

  async function publish(password: string): Promise<{ ok: boolean; error?: string }> {
    const res = await publishReleasesAction(artistId, [...selected], password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    <div className="space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex items-center gap-3">
            <KLabel>
              {releases.length} {releases.length === 1 ? 'release' : 'releases'}
            </KLabel>
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
        }
        chips={[]}
        active=""
        onChip={() => {}}
        sortOptions={[
          { key: 'newest', label: 'Newest' },
          { key: 'oldest', label: 'Oldest' },
          { key: 'az', label: 'A–Z' },
        ]}
        sort={sort}
        onSort={setSort}
        trailing={<RefreshButton action={refreshAction} />}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="releases"
          title={siteEmptyTitle(site, 'No releases yet')}
          hint={site === 'all' ? 'Hit Refresh to pull them from Spotify.' : undefined}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              <CardGrid size="md" count={g.items.length}>
                {g.items.map((r) => (
                  <ReleaseCard
                    key={r.id}
                    release={r}
                    artistId={artistId}
                    artistSlug={artistSlug}
                    selected={selected.has(r.id)}
                    onToggleSelect={() => toggleSelect(r.id)}
                  />
                ))}
              </CardGrid>
            </OriginSection>
          ))}
        </div>
      )}

      <PublishBar pendingCount={pendingCount} onPublish={publish} />
    </div>
  )
}
