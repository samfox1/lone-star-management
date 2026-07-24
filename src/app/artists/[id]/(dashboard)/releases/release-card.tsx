'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buttonClass, inputClass } from '@/components/ui/ui'
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
  const year = release.release_date?.slice(0, 4)
  const songCount = release.songs.length

  return (
    <div>
      {/* Cover on the LEFT, tracklist to its RIGHT (Sam, 2026-07-24) — a scrollable column
          capped at the cover's height, so every song is reachable inline. */}
      <div className="group flex gap-3 rounded-2xl border border-hairline p-2.5">
        <div className="relative w-24 flex-none">
          {onToggleSelect && (
            <div className="absolute left-1.5 top-1.5 z-10">
              <SelectToggle selected={!!selected} onSite={release.on_site} onToggle={onToggleSelect} label={release.title} />
            </div>
          )}
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-surface">
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 font-space text-[8px] font-bold uppercase tracking-[0.08em] text-white">
              {RELEASE_TYPE_LABEL[release.release_type]}
            </span>
            {release.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-8 w-8 rounded-full bg-ink" />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold tracking-[-0.01em]">{release.title}</span>
              <span className="mt-0.5 block font-space text-[12px] text-ink-muted">
                {[year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit release"
              aria-label={`Edit ${release.title}`}
              className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <Icon name="edit" size={14} />
            </button>
          </div>

          {songCount > 1 && (
            <ol className="no-scrollbar mt-1.5 max-h-24 space-y-0.5 overflow-y-auto pr-1">
              {release.songs.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-2 font-space text-[13px] leading-snug">
                  <span className="w-4 flex-none text-right text-ink-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{s.title}</span>
                  {/* Cap the feat. at ~42% and let it truncate, so a long "feat. A, B" can
                      never starve the title's flex-1 down to nothing (it did — the titles
                      vanished behind the collaborators). The song name always wins. */}
                  {feat(s) && <span className="max-w-[42%] flex-none truncate text-ink-faint">{feat(s)}</span>}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-1.5">
            <CardStat value={release.stat ?? 0} label={metricLabel('release')} />
          </div>
        </div>
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
