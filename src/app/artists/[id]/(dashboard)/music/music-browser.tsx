'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { RELEASE_TYPES, type ReleaseType } from '@/lib/releases'
import { compareLibrary, sortLibrary } from '@/lib/library-order'
import { KLabel } from '@/components/ui/ui'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { PublishBar } from '../publish-bar'
import { EmptyState } from '../empty-state'
import { OnSiteFilter, filterBySite, type SiteFilter } from '../on-site-filter'
import { OriginSection, groupByOrigin } from '../origin'
import { useOnSiteFlag } from '../use-on-site-flag'
import { toast } from '../toast'
import { publishMusicAction, setReleaseOnSiteAction } from '../actions'
import { ReleaseCard, type Release } from '../releases/release-card'
import { TrackCard, type Track, type ReleaseOption } from '../tracks/track-card'
import { SongAddButton } from './song-add'
import { type MergeTarget } from './merge-song-modal'

/** Group key for unreleased songs that aren't on any release. */
export const LOOSE = 'loose'

export type MusicSong = Track & { created_at: string; release_type: ReleaseType }

export type UnreleasedSong = Track & {
  /** When it was added to the library — the sort key for a demo with no release date,
   *  which is most of them. Already carried by the page; declared here so the browser can
   *  sort on it. */
  created_at?: string
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

type TypeFilterValue = 'all' | ReleaseType

/**
 * ONE BUTTON, A MENU (Sam, 2026-09-10: "Have a button to the right of released
 * unreleased that allows you to select single, ep, album, live, etc"). Seven options is
 * too many for a segmented row beside two that already have three each, so this is a
 * button that says what is picked and opens a menu. The options are DERIVED from
 * RELEASE_TYPES and TYPE_LABEL, so a new type is offered here without anyone editing a
 * list. Same outside-click-closes pattern as the song card's ⋯ menu.
 */
function TypeFilter({ value, onChange }: { value: TypeFilterValue; onChange: (v: TypeFilterValue) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const options: { key: TypeFilterValue; label: string }[] = [
    { key: 'all', label: 'All types' },
    ...RELEASE_TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t] })),
  ]
  const current = options.find((o) => o.key === value)?.label ?? 'All types'
  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 font-space text-xs transition-colors',
          value === 'all' ? 'text-ink-muted hover:text-ink' : 'bg-ink font-semibold text-white',
        )}
      >
        {current}
        <span aria-hidden className="text-[9px]">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-hairline bg-paper py-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
              className={cx(
                'block w-full px-3 py-1.5 text-left font-space text-xs hover:bg-surface',
                o.key === value ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
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
  live: 'Live sets',
  featured: 'Featured',
}
const TYPE_ORDER = RELEASE_TYPES

// The order itself lives in lib/library-order (review, 2026-09-09): one rule for this
// page and the Videos page, in a pure module Stryker can see. What stays here is the
// SHAPE this page needs — releases and orphan songs sorted AGAINST EACH OTHER, because a
// SoundCloud single creates no release row and used to sit behind every release in its
// section however the sort was set.
const sorted = sortLibrary
const compareBy = compareLibrary

/**
 * The ONE Music surface: every release and song, filtered by two segmented
 * controls — release state (All / Released / Unreleased) and site visibility
 * (All / On site / Off site) — with a shared toolbar (Refresh · Add Music ·
 * sort) in the same place for every view. Refresh greys out on
 * Unreleased (platform pulls only ever produce Released music). Unreleased
 * items are never public, so the site filter treats them as off-site; every
 * other card — releases AND orphan singles — is filtered by its own `on_site`.
 * A tick writes the working row at once (a DRAFT — PRESENCE_PLAN S1); the
 * password-gated publish pill commits it along with content edits (`dirty`).
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
  syncDialog,
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
  /** The Sync control — a DIALOG listing this section's sources (Sam, 2026-09-09),
   *  built by the page because only the server knows which are connected. It replaced a
   *  single `refreshAction` press that pulled every connected service at once and
   *  reported the lot as one joined string. */
  syncDialog?: ReactNode
  /** Unpublished music edits — enables the publish pill without a selection delta. */
  dirty?: boolean
  /** The Drive copy-import affordance (only when a folder is connected). */
  importButton?: ReactNode
}) {
  const router = useRouter()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilterValue>('all')
  const ofType = <T extends { release_type: ReleaseType }>(xs: T[]) =>
    typeFilter === 'all' ? xs : xs.filter((x) => x.release_type === typeFilter)
  const [site, setSite] = useState<SiteFilter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  // A tick is a DRAFT WRITE, at once (PRESENCE_PLAN S1): the release's on_site and its
  // songs' change now, the editor preview shows it, fans see it on Publish. No selection
  // to reconcile, so no pending count — the PublishBar lights on `dirty` like Tour's.
  const flag = useOnSiteFlag(releases, (id, on) => setReleaseOnSiteAction(id, artistId, on), (m) => toast(m, 'error'))

  async function publish(password: string): Promise<{ ok: boolean; error?: string }> {
    const res = await publishMusicAction(artistId, password)
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
  const shownUnreleasedReleases = ofType(sorted(unreleasedReleases, sort))
  const shownUnreleasedSongs = ofType(unreleasedSongs)
  const releaseOrder = [...new Set(shownUnreleasedSongs.filter((s) => s.group !== LOOSE).map((s) => s.group))]
  const labels = new Map(shownUnreleasedSongs.map((s) => [s.group, s.groupLabel]))
  const songGroups = groupByOrigin(
    // Newest-added first inside every group, same rule as the released shelf.
    sorted(shownUnreleasedSongs, sort),
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
          artistSlug={artistSlug}
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
      {TYPE_ORDER.filter((t) => typeFilter === 'all' || t === typeFilter).map((type) => {
        const rels = shownReleases.filter((r) => r.release_type === type)
        const orphs = shownOrphans.filter((o) => o.release_type === type)
        if (rels.length + orphs.length === 0) return null
        // ONE list, sorted together (Sam, 2026-09-09). Rendering releases then orphans
        // pinned every SoundCloud single behind every release in its section, whatever
        // the sort said — the kind of thing an item is must not decide where it sits.
        const entries: ({ kind: 'release'; item: Release } | { kind: 'song'; item: MusicSong })[] = [
          ...rels.map((item) => ({ kind: 'release' as const, item })),
          ...orphs.map((item) => ({ kind: 'song' as const, item })),
        ].sort((a, b) => compareBy(sort)(a.item, b.item))
        return (
          <OriginSection key={type} label={TYPE_LABEL[type as ReleaseType]} count={rels.length + orphs.length}>
            {/* Releases and orphan tracks of this type share ONE wrapping row (both 192px),
                so a remix release and an orphan remix sit side by side, not stacked. An
                expanded EP/album grows only by its tracklist; the neighbours reflow. */}
            <div className="flex flex-wrap gap-x-5 gap-y-8">
              {entries.map((e) =>
                e.kind === 'release' ? (
                  <ReleaseCard
                    key={e.item.id}
                    release={e.item}
                    artistId={artistId}
                    artistSlug={artistSlug}
                    releases={releaseOptions}
                    selected={flag.onSite(e.item.id)}
                    onToggleSelect={() => flag.toggle(e.item.id)}
                    // The FULL catalog, not targetsFor: the card filters per tracklist row
                    // (each row excludes only itself, and a row's twin can be anywhere).
                    mergeTargets={mergeTargets}
                  />
                ) : (
                  <div key={e.item.id} className="w-48 flex-none">
                    <TrackCard
                      artistId={artistId}
                      artistSlug={artistSlug}
                      track={e.item}
                      releases={releaseOptions}
                      hideBadges
                      mergeTargets={targetsFor(e.item.id)}
                    />
                  </div>
                ),
              )}
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
            <ReleaseCard key={r.id} release={r} artistId={artistId} artistSlug={artistSlug} releases={releaseOptions} mergeTargets={mergeTargets} />
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

  const releasedShownCount = ofType(shownReleases).length + ofType(shownOrphans).length
  const unreleasedShownCount = showUnreleased ? shownUnreleasedReleases.length + shownUnreleasedSongs.length : 0
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
            <TypeFilter value={typeFilter} onChange={setTypeFilter} />
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
            {/* KEYED WRAPPERS around the two elements the PAGE created (2026-09-10, the
                "unique key" warning). `syncDialog` and `importButton` are built in the
                server page and cross the server→client boundary as sealed elements. Put
                straight into this multi-child fragment, React's reconciler reads them as
                unkeyed list items and warns — "It was passed a child from MusicPage" —
                even though a locally-created element in the same slot would not. The
                other browsers never hit this because their pages hand over ONE fragment
                that is rendered whole. A keyed Fragment owned here is the smallest fix:
                no DOM, and the page element becomes a sole child rather than a list item.
                jsdom cannot reproduce it (a test-created element is not sealed), so this
                is pinned by the browser console, not a test. */}
            {importButton && <Fragment key="import">{importButton}</Fragment>}
            {/* Hidden on Unreleased: a platform pull only ever produces RELEASED music,
                so the control does not apply to that view — the same reason the old
                button was disabled there. */}
            {bucket !== 'unreleased' && syncDialog && <Fragment key="sync">{syncDialog}</Fragment>}
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

      <PublishBar pendingCount={0} dirty={dirty} onPublish={publish} />
    </div>
  )
}
