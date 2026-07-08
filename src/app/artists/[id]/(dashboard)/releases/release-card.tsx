'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { CardModal } from '../card-modal'
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
  visible: boolean
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
  selected: boolean
  onToggleSelect: () => void
}) {
  const [editing, setEditing] = useState(false)
  const year = release.release_date?.slice(0, 4)
  const songCount = release.songs.length

  return (
    <div>
      <div className="group relative">
        {/* On-site select — top-left, doesn't open the modal */}
        <div className="absolute left-2 top-2 z-10">
          <SelectToggle
            selected={selected}
            visible={release.visible}
            onToggle={onToggleSelect}
            label={release.title}
          />
        </div>

        <button type="button" onClick={() => setEditing(true)} className="block w-full text-left">
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
          <div className="mt-3 truncate text-[15px] font-bold tracking-[-0.01em] group-hover:text-accent">
            {release.title}
          </div>
          <div className="mt-0.5 font-space text-[13px] text-ink-muted">
            {[year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || '—'}
          </div>
          <CardStat value={release.stat ?? 0} label={metricLabel('release')} />
        </button>
      </div>

      <CardModal
        open={editing}
        onClose={() => setEditing(false)}
        deleteAction={deleteContentAction.bind(null, 'release', release.id, artistId)}
        deleteLabel="Delete release"
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

        <form action={setReleaseTypeAction.bind(null, release.id, artistId)} className="mt-4 flex items-center gap-2">
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
        </form>

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
              <form action={removeReleaseLinkAction.bind(null, release.id, i, artistId)}>
                <button type="submit" className="font-space text-xs text-accent-red hover:underline">
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addReleaseLinkAction.bind(null, release.id, artistId)} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="label" placeholder="Platform (e.g. Spotify)" required className={`${inputClass} w-36`} />
          <input name="url" type="url" placeholder="https://…" required className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('ghost')}>
            Add link
          </button>
        </form>
      </CardModal>
    </div>
  )
}
