'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { type IconType } from 'react-icons'
import { SiApplemusic, SiDeezer, SiSoundcloud, SiSpotify } from 'react-icons/si'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { type TrackPlatformIds } from '@/lib/music'
import { CardModal } from '../card-modal'
import { SaveForm } from '../save-form'
import { toast } from '../toast'
import { SelectToggle } from '../select-toggle'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { EntitySparkline } from '../entity-sparkline'
import {
  deleteContentAction,
  setReleaseLinkAction,
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
  { label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Spotify link' },
  { label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Apple Music link' },
  { label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'SoundCloud link' },
  { label: 'Deezer', Icon: SiDeezer, color: 'text-[#A238FF]', placeholder: 'Deezer link' },
]

/** A song's editable per-platform link fields (the sync-only ids like spotify_id/deezer_id
 *  aren't manually set, so they aren't slots here). */
const SONG_PLATFORMS: { field: 'stream_url' | 'soundcloud_url' | 'apple_url'; label: string; Icon: IconType; color: string; placeholder: string }[] = [
  { field: 'stream_url', label: 'Spotify', Icon: SiSpotify, color: 'text-[#1DB954]', placeholder: 'Spotify link' },
  { field: 'soundcloud_url', label: 'SoundCloud', Icon: SiSoundcloud, color: 'text-[#FF5500]', placeholder: 'SoundCloud link' },
  { field: 'apple_url', label: 'Apple Music', Icon: SiApplemusic, color: 'text-[#FA243C]', placeholder: 'Apple Music link' },
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // The tracklist song whose links modal is open (click a song to add/edit its link).
  const [linkSong, setLinkSong] = useState<ReleaseSong | null>(null)
  const year = release.release_date?.slice(0, 4)
  const songCount = release.songs.length
  // Only EPs and albums have a tracklist (Sam, 2026-07-24) — a single IS its song, so its
  // modal drops the tracklist and lets the cover/details fill the space instead.
  const expandable = release.release_type === 'ep' || release.release_type === 'album'
  // Singles read as just the year (no song count — a single is one track); EPs/albums keep
  // the count. No year → no meta line at all (never a "—" placeholder).
  const meta = expandable
    ? [year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
    : (year ?? '')

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Share the public release page — native sheet where available, clipboard otherwise.
  async function share() {
    setMenuOpen(false)
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/${artistSlug}/r/${release.slug}`
    if (navigator.share) {
      try {
        await navigator.share({ title: release.title, url })
        return
      } catch {
        // cancelled or unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast("Couldn't copy the link.", 'error')
    }
  }

  async function del() {
    setMenuOpen(false)
    const res = await deleteContentAction('release', release.id, artistId)
    if (res?.error) toast(res.error, 'error')
    else toast('Release deleted')
  }

  // A release link slot saves on blur: type a url and it's stored, clear it and it's
  // dropped — no add/remove buttons. Skips the write when nothing changed.
  async function saveReleaseLink(label: string, input: HTMLInputElement) {
    const val = input.value.trim()
    const current = release.links.find((l) => l.label === label)?.url ?? ''
    if (val === current) return
    const fd = new FormData()
    fd.set('url', val)
    const res = await setReleaseLinkAction(release.id, artistId, label, fd)
    if (res?.error) toast(res.error, 'error')
    else toast(val ? `${label} saved` : `${label} removed`)
  }

  // Same save-on-blur for a song's own platform link (track column).
  async function saveSongLink(songId: string, field: string, current: string, input: HTMLInputElement) {
    const val = input.value.trim()
    if (val === current) return
    const fd = new FormData()
    fd.set(field, val)
    const res = await updateContentAction('track', songId, artistId, fd)
    if (res?.error) toast(res.error, 'error')
    else toast(val ? 'Link saved' : 'Link removed')
  }

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

        {/* Top-right 3-dots: Edit / Share / Delete. */}
        <div ref={menuRef} className="absolute right-2 top-2 z-20">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`${release.title} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink-muted shadow-sm transition-colors hover:text-ink"
          >
            <Icon name="more" size={16} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-8 w-36 overflow-hidden rounded-xl border border-hairline bg-paper py-1 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setEditing(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <Icon name="edit" size={15} /> Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={share}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <Icon name="share" size={15} /> Share
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={del}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-red hover:bg-danger-soft"
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          )}
        </div>

        {/* Every release opens the one wide editor modal (cover + tracklist on the left,
            analytics + links on the right). */}
        <button
          type="button"
          onClick={() => setEditing(true)}
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

      <CardModal
        open={editing}
        // Escape/click-outside closes ONE layer: while a song's link modal is open it guards
        // this one, so Escape dismisses the link modal and leaves the editor. Delete lives in
        // the card's 3-dots menu now, so the footer is just Done.
        onClose={() => !linkSong && setEditing(false)}
        wide
      >
        {/* Two columns, font-space throughout: LEFT is the release itself (cover, details,
            tracklist); RIGHT is its performance + streaming links. Sized to fit — no scroll. */}
        <div className="grid grid-cols-2 gap-8 font-space">
          {/* LEFT — the release itself. Singles have no tracklist, so the cover goes big and
              fills the column; EPs/albums keep a compact cover beside a scrollable tracklist. */}
          <div className="flex min-w-0 flex-col gap-6">
            {expandable ? (
              <div className="flex items-start gap-4">
                <div className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
                  {release.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="h-9 w-9 rounded-full bg-ink" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold leading-tight tracking-[-0.01em]">{release.title}</h3>
                  {meta && <div className="mt-1 text-[12px] text-ink-muted">{meta}</div>}
                  <Link
                    href={`/${artistSlug}/r/${release.slug}`}
                    className="mt-1.5 flex items-center gap-1 truncate text-xs text-ink-muted hover:text-ink"
                  >
                    <Icon name="external" size={12} className="flex-none" />
                    <span className="truncate">/{artistSlug}/r/{release.slug}</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-surface">
                  {release.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="h-16 w-16 rounded-full bg-ink" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold leading-tight tracking-[-0.01em]">{release.title}</h3>
                  {meta && <div className="mt-1 text-[13px] text-ink-muted">{meta}</div>}
                  <Link
                    href={`/${artistSlug}/r/${release.slug}`}
                    className="mt-1.5 flex items-center gap-1 truncate text-xs text-ink-muted hover:text-ink"
                  >
                    <Icon name="external" size={12} className="flex-none" />
                    <span className="truncate">/{artistSlug}/r/{release.slug}</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Type */}
            <div className="flex items-center gap-2.5">
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

            {/* Tracklist — EPs/albums only; click a song to edit its per-platform links */}
            {expandable && songCount > 0 && (
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="tracks" size={15} className="flex-none text-ink-faint" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Tracklist</span>
                </div>
                <ol className="mt-3 max-h-[280px] space-y-0.5 overflow-auto">
                  {release.songs.map((s, i) => (
                    <li key={s.id} className="flex items-baseline gap-2 py-1 text-[13px]">
                      <span className="w-5 flex-none text-right text-ink-faint">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => setLinkSong(s)}
                        title="Add or edit links"
                        className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent"
                      >
                        {s.title}
                      </button>
                      {feat(s) && <span className="max-w-[40%] flex-none truncate text-ink-faint">{feat(s)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* RIGHT — analytics + streaming links */}
          <div className="flex min-w-0 flex-col gap-6">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Icon name="analytics" size={15} className="flex-none text-ink-faint" />
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Performance</span>
              </div>
              <EntitySparkline
                artistId={artistId}
                entityIds={[release.id, ...release.songs.map((s) => s.id)]}
                label="Listens · 30d"
              />
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2">
                <Icon name="links" size={15} className="flex-none text-ink-faint" />
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Streaming links</span>
              </div>
              {/* One input per platform — paste a link and it saves on blur, clear it and it's
                  removed. No add/remove buttons. The icon lights up when a link is set. */}
              <div className="space-y-2.5">
                {STREAMING_PLATFORMS.map((p) => {
                  const link = release.links.find((l) => l.label === p.label) ?? null
                  return (
                    <div key={p.label} className="flex items-center gap-3">
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface">
                        <p.Icon size={18} className={link ? p.color : 'text-ink-faint'} />
                      </span>
                      <input
                        // Remount when the saved url changes so the uncontrolled default resyncs.
                        key={link?.url ?? ''}
                        defaultValue={link?.url ?? ''}
                        type="url"
                        placeholder={p.placeholder}
                        aria-label={`${p.label} link`}
                        onBlur={(e) => saveReleaseLink(p.label, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-center font-space text-[12px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </CardModal>

      {/* Per-song links: click a song in the tracklist to add/edit its streaming link. */}
      <CardModal open={linkSong !== null} onClose={() => setLinkSong(null)}>
        {linkSong && (
          <div className="font-space">
            <h3 className="text-lg font-bold tracking-[-0.01em]">{linkSong.title}</h3>
            {feat(linkSong) && <div className="mt-0.5 text-[12px] text-ink-faint">{feat(linkSong)}</div>}

            {/* One slot per platform. Each saves on blur — paste a link and it's stored, clear
                it and it's removed. Setting any marks the song Released by derivation. */}
            <div className="mt-5 space-y-3">
              {SONG_PLATFORMS.map((p) => {
                const value = linkSong[p.field] ?? ''
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
                        key={value}
                        type="url"
                        defaultValue={value}
                        placeholder={p.placeholder}
                        onBlur={(e) => saveSongLink(linkSong.id, p.field, value, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        className="w-full rounded-lg bg-surface px-3 py-2 font-space text-[12px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline"
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardModal>
    </div>
  )
}
