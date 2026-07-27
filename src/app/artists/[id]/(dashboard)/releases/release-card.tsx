'use client'

import { useState } from 'react'
import Link from 'next/link'
import { type IconType } from 'react-icons'
import { SiApplemusic, SiDeezer, SiSoundcloud, SiSpotify } from 'react-icons/si'
import { buttonClass } from '@/components/ui/ui'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
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
  updateContentAction,
} from '../actions'

export type ReleaseLink = { label: string; url: string }
/** A song in a release's tracklist. Carries the union-model platform fields so the
 *  tracklist can show which platforms it's on and edit its primary Listen link. */
export type ReleaseSong = TrackPlatformIds & {
  id: string
  title: string
  featured_artists: string[]
  stat?: number
  /** Primary Listen link (paste a Spotify / SoundCloud / … URL). Editable per song. */
  stream_url: string | null
}
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

/** The streaming services a release can link out to — one fixed slot each, with its brand
 *  mark (react-icons) and colour, shown coloured when a link is set, grey when empty. The
 *  `label` is also the key stored in `release.links`. */
const STREAMING_PLATFORMS: { label: string; Icon: IconType; color: string; placeholder: string }[] = [
  { label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Add Spotify link' },
  { label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Add Apple Music link' },
  { label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'Add SoundCloud link' },
  { label: 'Deezer', Icon: SiDeezer, color: 'text-[#A238FF]', placeholder: 'Add Deezer link' },
]

/** A song's editable per-platform link fields (the sync-only ids like spotify_id/deezer_id
 *  aren't manually set, so they aren't slots here). */
const SONG_PLATFORMS: { field: 'stream_url' | 'soundcloud_url' | 'apple_url'; label: string; Icon: IconType; color: string; placeholder: string }[] = [
  { field: 'stream_url', label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Add Spotify link' },
  { field: 'soundcloud_url', label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'Add SoundCloud link' },
  { field: 'apple_url', label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Add Apple Music link' },
]

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
  const [tracksOpen, setTracksOpen] = useState(false)
  // The tracklist song whose links modal is open (click a song to add/edit its link).
  const [linkSong, setLinkSong] = useState<ReleaseSong | null>(null)
  const year = release.release_date?.slice(0, 4)
  const songCount = release.songs.length
  // Only EPs and albums open a tracklist (Sam, 2026-07-24) — a single IS its song.
  const expandable = release.release_type === 'ep' || release.release_type === 'album'
  // Singles read as just the year (no song count — a single is one track); EPs/albums keep
  // the count. No year → no meta line at all (never a "—" placeholder).
  const meta = expandable
    ? [year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
    : (year ?? '')

  return (
    // A plain fixed-width tile — the tracklist lives in a modal now, so the card never grows
    // and the grid never reflows or pushes a far-left album's songs off-screen.
    <div className="w-48 flex-none">
      <div className="group relative">
        {/* On-site select — top-left, doesn't open a modal */}
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

        {/* Clicking an EP/album opens its tracklist modal; a single just opens the editor. */}
        <button
          type="button"
          onClick={() => (expandable ? setTracksOpen(true) : setEditing(true))}
          aria-haspopup="dialog"
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
              <span className="flex-none text-ink-faint" aria-hidden>
                <Icon name="chevronRight" size={16} />
              </span>
            )}
          </div>
          {meta && <div className="mt-0.5 font-space text-[13px] text-ink-muted">{meta}</div>}
          <CardStat value={release.stat ?? 0} label={metricLabel('release')} />
        </button>
      </div>

      {/* Tracklist modal (Sam, 2026-07-27): opening it never disturbs the grid, and a
          far-left album's songs can't fall off-screen. Click a song to edit its links. */}
      {expandable && (
        // Escape/click-outside closes ONE layer: while a song's link modal is open it
        // guards this one, so Escape dismisses the link modal and leaves the tracklist.
        <CardModal open={tracksOpen} onClose={() => !linkSong && setTracksOpen(false)}>
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
              <div className="font-space text-xs text-ink-muted">
                {[RELEASE_TYPE_LABEL[release.release_type], year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>

          {songCount === 0 ? (
            <p className="mt-4 font-space text-[12px] text-ink-faint">No songs on this release yet.</p>
          ) : (
            <ol className="mt-4 max-h-[50vh] space-y-0.5 overflow-auto">
              {release.songs.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-2 py-0.5 font-space text-[13px]">
                  <span className="w-5 flex-none text-right text-ink-faint">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setLinkSong(s)}
                    title="Add or edit links"
                    className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent"
                  >
                    {s.title}
                  </button>
                  {feat(s) && <span className="max-w-[45%] flex-none truncate text-ink-faint">{feat(s)}</span>}
                </li>
              ))}
            </ol>
          )}
        </CardModal>
      )}

      <CardModal
        open={editing}
        onClose={() => setEditing(false)}
        deleteAction={deleteContentAction.bind(null, 'release', release.id, artistId)}
        deleteLabel="Delete release"
        deleteNoun="Release"
      >
        {/* font-space throughout so the modal speaks the site's mono voice; sections breathe
            (mt-6/7) and each carries a leading icon. */}
        <div className="font-space">
          {/* Header — cover + title + public URL */}
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
              {release.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="h-7 w-7 rounded-full bg-ink" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-bold tracking-[-0.01em]">{release.title}</h3>
              <Link
                href={`/${artistSlug}/r/${release.slug}`}
                className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-muted hover:text-ink"
              >
                <Icon name="external" size={12} className="flex-none" />
                <span className="truncate">/{artistSlug}/r/{release.slug}</span>
              </Link>
            </div>
          </div>

          <div className="mt-6">
            <EntitySparkline
              artistId={artistId}
              entityIds={[release.id, ...release.songs.map((s) => s.id)]}
              label="Listens · 30d"
            />
          </div>

          {/* Type */}
          <div className="mt-6 flex items-center gap-2.5">
            <Icon name="tracks" size={15} className="flex-none text-ink-faint" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Type</span>
            <SaveForm
              action={setReleaseTypeAction.bind(null, release.id, artistId)}
              className="ml-1 flex items-center gap-2"
            >
              <select
                name="release_type"
                defaultValue={release.release_type}
                className="rounded-lg border border-hairline bg-paper px-2.5 py-1.5 font-space text-sm text-ink outline-none focus:border-ink-faint"
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
          </div>

          {/* Streaming links — one fixed slot per platform, brand icon coloured when set */}
          <div className="mt-7 flex items-center gap-2">
            <Icon name="links" size={15} className="flex-none text-ink-faint" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Streaming links</span>
          </div>
          <div className="mt-3 space-y-2.5">
            {STREAMING_PLATFORMS.map((p) => {
              const idx = release.links.findIndex((l) => l.label === p.label)
              const link = idx >= 0 ? release.links[idx] : null
              return (
                <div key={p.label} className="flex items-center gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface">
                    <p.Icon size={18} className={link ? p.color : 'text-ink-faint'} />
                  </span>
                  {link ? (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink">{p.label}</div>
                        <a
                          href={safeHref(link.url) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-[11px] text-ink-faint hover:text-ink-muted"
                        >
                          {link.url}
                        </a>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${p.label}`}
                        onClick={async () => {
                          const res = await removeReleaseLinkAction(release.id, idx, artistId)
                          if (res?.error) toast(res.error, 'error')
                          else toast(`${p.label} removed`)
                        }}
                        className="flex-none rounded-lg p-2 text-ink-faint transition-colors hover:bg-danger-soft hover:text-accent-red"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  ) : (
                    <SaveForm
                      action={addReleaseLinkAction.bind(null, release.id, artistId)}
                      savedMessage={`${p.label} added`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <input type="hidden" name="label" value={p.label} />
                      <input
                        name="url"
                        type="url"
                        required
                        placeholder={p.placeholder}
                        className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 font-space text-[12px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline"
                      />
                      <button
                        type="submit"
                        aria-label={`Add ${p.label}`}
                        className="flex-none rounded-lg bg-ink p-2 text-white transition-colors hover:bg-ink/85"
                      >
                        <Icon name="plus" size={15} />
                      </button>
                    </SaveForm>
                  )}
                </div>
              )
            })}
          </div>

          {/* Tracklist */}
          {songCount > 0 && (
            <>
              <div className="mt-7 flex items-center gap-2">
                <Icon name="tracks" size={15} className="flex-none text-ink-faint" />
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Tracklist</span>
              </div>
              <ul className="mt-3 max-h-44 space-y-0.5 overflow-auto">
                {release.songs.map((s, i) => (
                  <li key={s.id} className="flex items-baseline gap-2 py-1 text-[13px]">
                    <span className="w-5 flex-none text-right text-ink-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{s.title}</span>
                    {feat(s) && <span className="max-w-[40%] flex-none truncate text-ink-faint">{feat(s)}</span>}
                    {s.stat ? (
                      <span className="ml-auto flex-none tabular-nums text-ink-faint">{s.stat.toLocaleString()}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </CardModal>

      {/* Per-song links: click a song in the tracklist to add/edit its streaming link. */}
      <CardModal open={linkSong !== null} onClose={() => setLinkSong(null)}>
        {linkSong && (
          <div className="font-space">
            <h3 className="text-lg font-bold tracking-[-0.01em]">{linkSong.title}</h3>
            {feat(linkSong) && <div className="mt-0.5 text-[12px] text-ink-faint">{feat(linkSong)}</div>}

            {/* One slot per platform, same visual language as the release modal. Setting any
                marks the song Released by derivation; Save writes all three at once. */}
            <SaveForm
              action={updateContentAction.bind(null, 'track', linkSong.id, artistId)}
              savedMessage="Links saved"
              className="mt-5 space-y-3"
            >
              {SONG_PLATFORMS.map((p) => {
                const value = linkSong[p.field]
                return (
                  <div key={p.field} className="flex items-center gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface">
                      <p.Icon size={18} className={value ? p.color : 'text-ink-faint'} />
                    </span>
                    <label className="min-w-0 flex-1">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                        {p.label}
                      </span>
                      <input
                        name={p.field}
                        type="url"
                        defaultValue={value ?? ''}
                        placeholder={p.placeholder}
                        className="w-full rounded-lg bg-surface px-3 py-2 font-space text-[12px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline"
                      />
                    </label>
                  </div>
                )
              })}
              <button type="submit" className={cx(buttonClass('solid'), 'mt-1 w-full justify-center')}>
                Save links
              </button>
            </SaveForm>
          </div>
        )}
      </CardModal>
    </div>
  )
}
