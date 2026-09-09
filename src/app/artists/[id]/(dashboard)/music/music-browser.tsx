'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { RELEASE_TYPES, type ReleaseType } from '@/lib/releases'
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
import { SongAddButton } from './song-add'
import { type MergeTarget } from './merge-song-modal'

/** Group key for unreleased songs that aren't on any release. */
export const LOOSE = 'loose'

export type MusicSong = Track & { created_at: string; release_type: ReleaseType }

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

// Music groups by RELEASE TYPE (its natural category) — singles/EPs/albums/remixes is
// how a manager thinks about a catalog. Order follows RELEASE_TYPES and the label map is
// a TOTAL Record<ReleaseType>, so adding a type without a section here is a TYPE error,
// not a silent lowercase fallback heading (the bug this replaced).
const TYPE_LABEL: Record<ReleaseType, string> = {
  single: 'Singles',
  ep: 'EPs',
  album: 'Albums',
  remix: 'Remixes',
  live: 'Live',
  featured: 'Featured',
}
const TYPE_ORDER = RELEASE_TYPES

/**
 * Where an UNDATED release sorts. It is the thing you just added — a record typed in
 * before its release date is known — so it counts as the newest: first under Newest, last
 * under Oldest (Sam, 2026-09-09: "the newest ones should be in the top left of their
 * respective section… it should enter the list as a stack, not append to the end").
 *
 * ONE sentinel, read by both directions. They used to disagree: `oldest` treated an
 * undated release as `'9999'` (far future, therefore newest, therefore last in an
 * ascending sort — right), while `newest` treated the SAME release as `''` (therefore
 * oldest, therefore last again). Undated items sank to the bottom whichever way you
 * sorted, which is not a preference, it is the two halves contradicting each other.
 *
 * `||`, not `??`: a blank date input stores '', and only `||` reads that as undated. The
 * old `??` let an empty string fall through to a string compare it lost against every
 * real date.
 */
const FAR_FUTURE = '9999'
const sortDate = (r: Release) => r.release_date || FAR_FUTURE

function sorted(releases: Release[], sort: Sort): Release[] {
  const copy = [...releases]
  if (sort === 'az') return copy.sort((a, b) => a.title.localeCompare(b.title))
  // A dated release still sorts by its DATE: a back-catalogue record added today is not
  // new. Arrival order only decides where the undated ones go.
  if (sort === 'newest') return copy.sort((a, b) => sortDate(b).localeCompare(sortDate(a)))
  return copy.sort((a, b) => sortDate(a).localeCompare(sortDate(b)))
}

/**
 * The ONE Music surface: every release and song, filtered by two segmented
 * controls — release state (All / Released / Unreleased) and site visibility
 * (All / On site / Off site) — with a shared toolbar (Refresh · Add Music ·
 * sort) in the same place for every view. Refresh greys out on
 * Unreleased (platform pulls only ever produce Released music). Unreleased
 * items are never public, so the site filter treats them as off-site; every
 * other card — releases AND orphan singles — is filtered by its own `on_site`.
 * The password-gated publish pill covers on-site selection changes AND content
 * edits (`dirty`).
 */
export function MusicBrowser({
  releases,
  unreleasedReleases,
  orphanSingles,
  unreleasedSongs,
  releaseOptions,
  mergeTargets,
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
  /** Released songs whose album name matches no release (SoundCloud singles/remixes).
   *  Shown as their own cards under Singles — there is no 'loose' bucket. */
  orphanSingles: MusicSong[]
  /** Unreleased songs, grouped under their release / LOOSE. */
  unreleasedSongs: UnreleasedSong[]
  /** Options for the per-song "assign to release" selector (ALL releases). */
  releaseOptions: ReleaseOption[]
  /** Every song in the catalog, for "Merge into…". The sync REFUSES an uncertain
   *  cross-platform match rather than risk absorbing a song, so duplicates land here for
   *  the manager to resolve — and a duplicate's twin can be anywhere in the catalog, not
   *  just in the same bucket or section. */
  mergeTargets: MergeTarget[]
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
  // Orphan singles carry their OWN on-site toggle (48db004), so the site lens filters them
  // by `on_site` like every other card. Passing them through unfiltered (the old
  // `site === 'off' ? [] : orphans`) made an off-site orphan UNFINDABLE: it showed under
  // "On site" and vanished under "Off site" — shown in exactly the lens that denies it.
  // They ride the Singles section (a release-less song reads as a single here), never a
  // separate 'loose' pile.
  const shownOrphans = filterBySite(orphanSingles, site)

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

  // A song can never be its own merge target — the server refuses it, but offering it at
  // all invites the manager to try to delete the row they are standing on.
  const targetsFor = (id: string) => mergeTargets.filter((t) => t.id !== id)

  const songGrid = (items: (MusicSong | UnreleasedSong)[]) => (
    <CardGrid size="sm" count={items.length}>
      {items.map((t) => (
        <TrackCard
          key={t.id}
          artistId={artistId}
          track={t}
          releases={releaseOptions}
          mergeTargets={targetsFor(t.id)}
        />
      ))}
    </CardGrid>
  )

  // Orphan singles ride the Singles section next to the release cards, so they match them:
  // same 192px cover, title only (no platform-badge subtitle).
  // Each type's section holds BOTH its releases AND its release-less orphan tracks, so an
  // orphan remix (a SoundCloud remix with no release row) lands under Remixes, not Singles.
  const releasedContent = (
    <>
      {TYPE_ORDER.map((type) => {
        const rels = shownReleases.filter((r) => r.release_type === type)
        const orphs = shownOrphans.filter((o) => o.release_type === type)
        if (rels.length + orphs.length === 0) return null
        return (
          <OriginSection key={type} label={TYPE_LABEL[type as ReleaseType]} count={rels.length + orphs.length}>
            {/* Releases and orphan tracks of this type share ONE wrapping row (both 192px),
                so a remix release and an orphan remix sit side by side, not stacked. An
                expanded EP/album grows only by its tracklist; the neighbours reflow. */}
            <div className="flex flex-wrap gap-x-5 gap-y-8">
              {rels.map((r) => (
                <ReleaseCard
                  key={r.id}
                  release={r}
                  artistId={artistId}
                  artistSlug={artistSlug}
                  selected={selected.has(r.id)}
                  onToggleSelect={() => toggleSelect(r.id)}
                  // The FULL catalog, not targetsFor: the card filters per tracklist row
                  // (each row excludes only itself, and a row's twin can be anywhere).
                  mergeTargets={mergeTargets}
                />
              ))}
              {orphs.map((t) => (
                <div key={t.id} className="w-48 flex-none">
                  <TrackCard
                    artistId={artistId}
                    track={t}
                    releases={releaseOptions}
                    hideBadges
                    mergeTargets={targetsFor(t.id)}
                  />
                </div>
              ))}
            </div>
          </OriginSection>
        )
      })}
    </>
  )

  const unreleasedContent = (
    <>
      {shownUnreleasedReleases.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,192px)] gap-x-5 gap-y-8">
          {shownUnreleasedReleases.map((r) => (
            <ReleaseCard key={r.id} release={r} artistId={artistId} artistSlug={artistSlug} mergeTargets={mergeTargets} />
          ))}
        </div>
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

  const releasedShownCount = shownReleases.length + shownOrphans.length
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
            <OnSiteFilter value={site} onChange={setSite} />
            <BucketFilter value={bucket} onChange={setBucket} />
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
            {/* ONE + for the whole page; released/unreleased is chosen in the modal. */}
            <SongAddButton artistId={artistId} />
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
