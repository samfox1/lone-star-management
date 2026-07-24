'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { CardModal } from '../card-modal'
import { SaveForm } from '../save-form'
import { toast } from '../toast'
import { SelectToggle } from '../select-toggle'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { EntitySparkline } from '../entity-sparkline'
import {
  addReleaseLinkAction,
  deleteContentAction,
  removeReleaseLinkAction,
  setReleaseTypeAction,
} from '../actions'

export type ReleaseLink = { label: string; url: string }
export type ReleaseSong = { id: string; title: string; featured_artists: string[]; stat?: number }
export type Release = {
  id: string
  title: string
  slug: string
  cover_url: string | null
  release_date: string | null
  release_type: ReleaseType
  links: ReleaseLink[]
  /** Whether the release is currently live on the public site. */
  on_site: boolean
  /** The release's songs (tracks grouped under it), shown in the edit modal. */
  songs: ReleaseSong[]
  /** 30-day engagement (track plays + Listen/DSP clicks), from analytics_by_entity. */
  stat?: number
}

/** feat. A, B — the collaborators on a song. */
function feat(song: ReleaseSong): string | null {
  return song.featured_artists.length ? `feat. ${song.featured_artists.join(', ')}` : null
}

/**
 * A release as a grid tile: cover with a select checkbox + live badge + type
 * badge, then title and meta. Selection drives the password-gated publish; the
 * checkbox is owned by the parent browser. Clicking the tile opens the edit modal
 * (tracklist · type · DSP links · delete).
 */
export function ReleaseCard({
  release,
  artistId,
  artistSlug,
  selected,
  onToggleSelect,
}: {
  release: Release
  artistId: string
  artistSlug: string
  /** On-site selection (publish flow). Omit both for an UNRELEASED release —
   *  publish doesn't apply, so no checkbox / live badge is shown. */
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const year = release.release_date?.slice(0, 4)
  const songCount = release.songs.length
  // Only EPs and albums reveal a tracklist (Sam, 2026-07-24) — a single IS its song.
  const expandable = release.release_type === 'ep' || release.release_type === 'album'
  const showList = expandable && expanded

  return (
    // When open, break out to the full row and lay the tile + tracklist side by side.
    <div className={cx(showList && 'col-span-full')}>
      <div className={showList ? 'flex items-start gap-4' : undefined}>
        {/* The cover tile — unchanged; only pinned to its size once open so the songs get
            room beside it rather than shrinking the cover. */}
        <div className={cx('group relative', showList && 'w-48 flex-none')}>
          {/* On-site select — top-left, doesn't open the modal */}
          {onToggleSelect && (
            <div className="absolute left-2 top-2 z-10">
              <SelectToggle selected={!!selected} onSite={release.on_site} onToggle={onToggleSelect} label={release.title} />
            </div>
          )}

          {/* Edit — top-right pencil. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit release"
            aria-label={`Edit ${release.title}`}
            className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-ink-muted shadow-sm transition-colors hover:text-ink"
          >
            <Icon name="edit" size={14} />
          </button>

          {/* Clicking an EP/album reveals its songs; a single just opens the editor. */}
          <button
            type="button"
            onClick={() => (expandable ? setExpanded((v) => !v) : setEditing(true))}
            aria-expanded={expandable ? expanded : undefined}
            aria-label={`${release.title} — ${songCount} song${songCount === 1 ? '' : 's'}`}
            className="block w-full text-left"
          >
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
              <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                {RELEASE_TYPE_LABEL[release.release_type]}
              </span>
              {release.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="h-9 w-9 rounded-full bg-ink" />
              )}
            </div>
            <div className="mt-3 flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em] group-hover:text-accent">
                {release.title}
              </span>
              {expandable && (
                <span className={cx('flex-none text-ink-faint transition-transform', expanded && 'rotate-90')} aria-hidden>
                  <Icon name="chevronRight" size={16} />
                </span>
              )}
            </div>
            <div className="mt-0.5 font-space text-[13px] text-ink-muted">
              {[year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || '—'}
            </div>
            <CardStat value={release.stat ?? 0} label={metricLabel('release')} />
          </button>
        </div>

        {/* Songs to the RIGHT of the cover — borderless, detached (a gap, no shared box),
            scrollable, capped at the cover's height. */}
        {showList &&
          (songCount === 0 ? (
            <p className="flex-1 font-space text-[12px] text-ink-faint">No songs on this release yet.</p>
          ) : (
            <ol className="no-scrollbar max-h-48 min-w-0 max-w-md flex-1 space-y-0.5 overflow-y-auto pr-1">
              {release.songs.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-2 py-0.5 font-space text-[13px]">
                  <span className="w-5 flex-none text-right text-ink-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{s.title}</span>
                  {/* Cap the feat. so a long "feat. A, B" can't starve the title to nothing. */}
                  {feat(s) && <span className="max-w-[45%] flex-none truncate text-ink-faint">{feat(s)}</span>}
                </li>
              ))}
            </ol>
          ))}
      </div>

      <CardModal
        open={editing}
        onClose={() => setEditing(false)}
        deleteAction={deleteContentAction.bind(null, 'release', release.id, artistId)}
        deleteLabel="Delete release"
        deleteNoun="Release"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
            {release.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-7 w-7 rounded-full bg-ink" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold tracking-[-0.01em]">{release.title}</h3>
            <Link href={`/${artistSlug}/r/${release.slug}`} className="font-space text-xs text-ink-muted hover:underline">
              /{artistSlug}/r/{release.slug}
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <EntitySparkline
            artistId={artistId}
            entityIds={[release.id, ...release.songs.map((s) => s.id)]}
            label="Listens · 30d"
          />
        </div>

        <SaveForm action={setReleaseTypeAction.bind(null, release.id, artistId)} className="mt-4 flex items-center gap-2">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Type</span>
          <select
            name="release_type"
            defaultValue={release.release_type}
            className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-faint"
          >
            {RELEASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RELEASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass('ghost')}>
            Save
          </button>
        </SaveForm>

        {songCount > 0 && (
          <>
            <div className="mt-5 font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
              Tracklist
            </div>
            <ul className="mt-2 max-h-44 overflow-auto">
              {release.songs.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-2 py-1 font-space text-[13px]">
                  <span className="w-5 flex-none text-right text-ink-faint">{i + 1}</span>
                  <span className="truncate text-ink">{s.title}</span>
                  {feat(s) && <span className="truncate text-ink-faint">{feat(s)}</span>}
                  {s.stat ? (
                    <span className="ml-auto flex-none tabular-nums text-ink-faint">{s.stat.toLocaleString()}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-5 font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Streaming links
        </div>
        <ul className="mt-2 space-y-1">
          {release.links.length === 0 && <li className="font-space text-xs text-ink-faint">None yet.</li>}
          {release.links.map((l, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{l.label}</span>
              <span className="flex-1 truncate font-space text-xs text-ink-faint">{l.url}</span>
              <button
                type="button"
                onClick={async () => {
                  const res = await removeReleaseLinkAction(release.id, i, artistId)
                  if (res?.error) toast(res.error, 'error')
                  else toast('Link removed')
                }}
                className="font-space text-xs text-accent-red hover:underline"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <SaveForm
          action={addReleaseLinkAction.bind(null, release.id, artistId)}
          savedMessage="Link added"
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input name="label" placeholder="Platform (e.g. Spotify)" required className={`${inputClass} w-36`} />
          <input name="url" type="url" placeholder="https://…" required className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('ghost')}>
            Add link
          </button>
        </SaveForm>
      </CardModal>
    </div>
  )
}
