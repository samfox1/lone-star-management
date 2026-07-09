'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, type SiteFilter } from '../on-site-filter'
import { OriginSection, groupByOrigin } from '../origin'
import { useOnSiteSelection } from '../use-on-site-selection'
import { publishReleasesAction } from '../actions'
import { ReleaseCard, type Release } from '../releases/release-card'
import { TrackCard, type Track, type ReleaseOption } from '../tracks/track-card'
import { RefreshButton } from './refresh-button'
import { ReleaseAddButton } from './release-add'
import { SongAddButton } from './song-add'

/** Group key for unreleased songs that aren't on any release. */
export const LOOSE = 'loose'

export type MusicSong = Track & { created_at: string }

export type UnreleasedSong = Track & {
  /** Release id when the song sits inside an UNRELEASED release, else LOOSE. */
  group: string
  /** The unreleased release's title (unused for LOOSE). */
  groupLabel: string
}

type Bucket = 'all' | 'released' | 'unreleased'
type Sort = 'newest' | 'oldest' | 'az'

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'released', label: 'Released' },
  { key: 'unreleased', label: 'Unreleased' },
]

/** All / Released / Unreleased — same control language as OnSiteFilter, sits left of it. */
function BucketFilter({ value, onChange }: { value: Bucket; onChange: (b: Bucket) => void }) {
  return (
    <div
      role="group"
      aria-label="Filter by release state"
      className="inline-flex flex-none gap-0.5 rounded-lg border border-hairline p-0.5"
    >
      {BUCKETS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={o.key === value}
          className={cx(
            'rounded-md px-2.5 py-1 font-space text-xs transition-colors',
            o.key === value ? 'bg-ink font-semibold text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Music groups by RELEASE TYPE (its natural category) — singles/EPs/albums is
// how a manager thinks about a catalog.
const TYPE_LABEL: Record<string, string> = { single: 'Singles', ep: 'EPs', album: 'Albums', featured: 'Featured' }
const TYPE_ORDER = ['single', 'ep', 'album', 'featured'] as const

function sorted(releases: Release[], sort: Sort): Release[] {
  const copy = [...releases]
  if (sort === 'az') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'newest') return copy.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
  // oldest: ascending, undated last
  return copy.sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
}

/**
 * The ONE Music surface: every release and song, filtered by two segmented
 * controls — release state (All / Released / Unreleased) and site visibility
 * (All / On site / Off site) — with a shared toolbar (Refresh · + Song ·
 * + Release · sort) in the same place for every view. Refresh greys out on
 * Unreleased (platform pulls only ever produce Released music). Unreleased
 * items are never public, so the site filter treats them as off-site; loose
 * RELEASED songs are public, so they count as on-site. The password-gated
 * publish pill covers on-site selection changes AND content edits (`dirty`).
 */
export function MusicBrowser({
  releases,
  unreleasedReleases,
  looseReleased,
  unreleasedSongs,
  releaseOptions,
  artistId,
  artistSlug,
  refreshAction,
  dirty = false,
  importButton,
}: {
  /** Released releases (platform presence), with tracklists + on-site state. */
  releases: Release[]
  /** Unreleased releases (manual, no links) — manageable cards, no select. */
  unreleasedReleases: Release[]
  /** Released songs on no release (rare — platform-linked loose songs). */
  looseReleased: MusicSong[]
  /** Unreleased songs, grouped under their release / LOOSE. */
  unreleasedSongs: UnreleasedSong[]
  /** Options for the per-song "assign to release" selector (ALL releases). */
  releaseOptions: ReleaseOption[]
  artistId: string
  artistSlug: string
  refreshAction: () => Promise<{ ok: boolean; error?: string }>
  /** Unpublished music edits — enables the publish pill without a selection delta. */
  dirty?: boolean
  /** The Drive copy-import affordance (only when a folder is connected). */
  importButton?: ReactNode
}) {
  const router = useRouter()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const { selected, toggle: toggleSelect, pendingCount } = useOnSiteSelection(releases)

  async function publish(password: string): Promise<{ ok: boolean; error?: string }> {
    const res = await publishReleasesAction(artistId, [...selected], password)
    if (res.ok) router.refresh()
    return res
  }

  // ----- Released half (hidden when bucket === 'unreleased') ----------------
  const showReleased = bucket !== 'unreleased'
  const shownReleases = sorted(filterBySite(releases, site), sort)
  const releaseGroups = groupByOrigin(shownReleases, (r) => r.release_type, TYPE_ORDER, (k) => TYPE_LABEL[k] ?? k)
  // Loose released songs ARE on the public site → hidden by the Off-site lens.
  const shownLoose = site === 'off' ? [] : looseReleased

  // ----- Unreleased half (hidden when bucket === 'released'; never on site) --
  const showUnreleased = bucket !== 'released' && site !== 'on'
  const shownUnreleasedReleases = sorted(unreleasedReleases, sort)
  const releaseOrder = [...new Set(unreleasedSongs.filter((s) => s.group !== LOOSE).map((s) => s.group))]
  const labels = new Map(unreleasedSongs.map((s) => [s.group, s.groupLabel]))
  const songGroups = groupByOrigin(
    unreleasedSongs,
    (s) => s.group,
    [...releaseOrder, LOOSE],
    (k) => (k === LOOSE ? 'Not on a release' : (labels.get(k) ?? k)),
  )

  const songGrid = (items: (MusicSong | UnreleasedSong)[]) => (
    <CardGrid size="sm" count={items.length}>
      {items.map((t) => (
        <TrackCard key={t.id} artistId={artistId} track={t} releases={releaseOptions} />
      ))}
    </CardGrid>
  )

  const releasedContent = (
    <>
      {releaseGroups.map((g) => (
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
      {shownLoose.length > 0 && (
        <OriginSection label="Loose songs" count={shownLoose.length}>
          {songGrid(shownLoose)}
        </OriginSection>
      )}
    </>
  )

  const unreleasedContent = (
    <>
      {shownUnreleasedReleases.length > 0 && (
        <CardGrid size="md" count={shownUnreleasedReleases.length}>
          {shownUnreleasedReleases.map((r) => (
            <ReleaseCard key={r.id} release={r} artistId={artistId} artistSlug={artistSlug} />
          ))}
        </CardGrid>
      )}
      {songGroups.length === 1 && songGroups[0].key === LOOSE
        ? // Only loose uploads — skip the group chrome.
          songGrid(songGroups[0].items)
        : songGroups.map((g) => (
            <OriginSection key={g.key} label={g.label} count={g.items.length}>
              {songGrid(g.items)}
            </OriginSection>
          ))}
    </>
  )

  const releasedShownCount = shownReleases.length + shownLoose.length
  const unreleasedShownCount = showUnreleased ? shownUnreleasedReleases.length + unreleasedSongs.length : 0
  const nothingShown = (!showReleased || releasedShownCount === 0) && (!showUnreleased || unreleasedShownCount === 0)

  return (
    <div className="space-y-6 pb-24">
      <FilterBar
        leading={
          <div className="flex flex-wrap items-center gap-3">
            <KLabel>
              {releases.length + unreleasedReleases.length}{' '}
              {releases.length + unreleasedReleases.length === 1 ? 'release' : 'releases'}
            </KLabel>
            <BucketFilter value={bucket} onChange={setBucket} />
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
        trailing={
          <>
            {importButton}
            <RefreshButton action={refreshAction} disabled={bucket === 'unreleased'} />
            <SongAddButton artistId={artistId} />
            <ReleaseAddButton artistId={artistId} />
          </>
        }
      />

      {nothingShown ? (
        <EmptyState
          icon="releases"
          title={bucket === 'unreleased' ? 'No unreleased music' : 'No music yet'}
          hint={
            bucket === 'unreleased'
              ? 'Demos live here until they’re on a platform. Add a song, then upload its audio.'
              : 'Hit Refresh to pull your catalog, or add a release or song.'
          }
        />
      ) : (
        <div className="space-y-8">
          {showReleased && releasedContent}
          {showUnreleased &&
            unreleasedShownCount > 0 &&
            (bucket === 'all' ? (
              <OriginSection label="Unreleased" count={unreleasedShownCount}>
                <div className="space-y-8">{unreleasedContent}</div>
              </OriginSection>
            ) : (
              unreleasedContent
            ))}
        </div>
      )}

      <PublishBar pendingCount={pendingCount} dirty={dirty} onPublish={publish} />
    </div>
  )
}
