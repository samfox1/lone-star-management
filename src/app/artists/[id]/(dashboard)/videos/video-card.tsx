'use client'

import { useEffect, useRef, useState } from 'react'
import { type IconType } from 'react-icons'
import { SiSoundcloud, SiYoutube } from 'react-icons/si'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { metricLabel } from '@/lib/analytics'
import { safeHref } from '@/lib/url'
import { publicVideoSrc } from '@/lib/video-render'
import { CardModal } from '../card-modal'
import { EntitySparkline } from '../entity-sparkline'
import { SelectToggle } from '../select-toggle'
import { CardStat } from '../card-stat'
import { deleteContentAction, renameVideoAction } from '../actions'
import { toast } from '../toast'

export type VideoItem = {
  id: string
  title: string
  provider: string | null
  poster: string | null
  embed_url: string | null
  /** Path in the public `videos` bucket for an uploaded (self-hosted) video; null for embeds. */
  storage_path: string | null
  source: string | null
  /** True for a YouTube Short (shown in the Shorts tab, not the default Videos tab). */
  is_short: boolean
  /** Whether the video is currently live on the public site. */
  on_site: boolean
  /** Global YouTube view count (cached on sync); null if unknown. */
  youtube_views?: number | null
  /** 30-day clicks from the artist's own site (video_click), from analytics_by_entity. */
  stat?: number
  /** When the row was created — the LIBRARY's sort key (Sam, 2026-09-09: newest first,
   *  top-left of its section). Not a display field; nothing renders it. '' on a row
   *  loaded before this was surfaced. */
  created_at?: string
}

const BADGE_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  uploaded: 'Uploaded',
}

/** Compact count label: 1.2M / 45.3K / 812. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

/** The link to open/share: an uploaded video's public file URL, else the public
 *  YouTube link (/shorts/<id> for a Short, /watch?v=<id> otherwise). */
function videoOpenUrl(video: VideoItem): string {
  if (video.provider === 'uploaded') {
    return publicVideoSrc({ provider: 'uploaded', embed_url: null, storage_path: video.storage_path }) ?? '#'
  }
  const m = (video.embed_url ?? '').match(/embed\/([\w-]{6,})/)
  if (!m) return video.embed_url ?? '#'
  return video.is_short
    ? `https://www.youtube.com/shorts/${m[1]}`
    : `https://www.youtube.com/watch?v=${m[1]}`
}

/**
 * A video as a thumbnail tile (16:9, or 9:16 for a Short). Clicking the tile opens
 * the same single-style detail modal the music cards use — the video plays on the
 * left with a 3-dots (Edit / Share / Delete), its 30-day performance on the right —
 * with a separate rename modal behind "Edit". The checkbox (top-left) is a LIVE
 * on-site toggle owned by the parent browser (ADR 0009).
 */
export function VideoCard({
  video,
  artistId,
  onSite,
  onToggleOnSite,
}: {
  video: VideoItem
  artistId: string
  /** Live on-site state (optimistic — may lead `video.on_site` for a beat). */
  onSite: boolean
  onToggleOnSite: () => void
}) {
  const badgeRaw = video.source && video.source !== 'manual' ? video.source : video.provider
  const badge = badgeRaw ? (BADGE_LABEL[badgeRaw] ?? badgeRaw) : null
  const url = videoOpenUrl(video)
  // Brand mark for the link row (same shape as the music streaming-link rows).
  const brand: { Icon: IconType; color: string } =
    video.provider === 'youtube'
      ? { Icon: SiYoutube, color: 'text-[#FF0000]' }
      : video.provider === 'soundcloud'
        ? { Icon: SiSoundcloud, color: 'text-[#FF5500]' }
        : { Icon: SiYoutube, color: 'text-ink-faint' }
  const uploadedSrc =
    video.provider === 'uploaded' && video.storage_path
      ? publicVideoSrc({ provider: 'uploaded', embed_url: null, storage_path: video.storage_path })
      : null

  const [menuOpen, setMenuOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(video.title)
  const menuRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false) // hard re-entry latch shared by delete + rename

  async function del() {
    if (busyRef.current) return
    busyRef.current = true
    setMenuOpen(false)
    try {
      const res = await deleteContentAction('video', video.id, artistId)
      if (res?.error) toast(res.error, 'error')
      else {
        toast('Video deleted')
        setDetailOpen(false)
      }
    } catch {
      toast("Couldn't delete that video.", 'error')
    } finally {
      busyRef.current = false
    }
  }

  async function saveRename() {
    if (busyRef.current || !name.trim()) return
    busyRef.current = true
    try {
      const res = await renameVideoAction(video.id, artistId, name)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      toast('Video renamed')
      setRenameOpen(false)
    } catch {
      toast("Couldn't rename that video.", 'error')
    } finally {
      busyRef.current = false
    }
  }

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

  async function share() {
    setMenuOpen(false)
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: video.title, url })
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

  const aspect = video.is_short ? 'aspect-[9/16]' : 'aspect-video'

  const kebabMenu = (
    <div ref={menuRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`${video.title} options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <Icon name="more" size={18} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-10 w-36 overflow-hidden rounded-xl border border-hairline bg-paper py-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              setName(video.title)
              setRenameOpen(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
          >
            <Icon name="edit" size={15} /> Rename
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
  )

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 z-10">
        {/* selected === onSite under a live toggle, so this only ever reads live or
            off — SelectToggle's pending-add/pending-drop states can't arise here. */}
        <SelectToggle selected={onSite} onSite={onSite} onToggle={onToggleOnSite} label={video.title} />
      </div>

      <button type="button" onClick={() => setDetailOpen(true)} className="group block w-full text-left">
        <div className={cx('relative flex items-center justify-center overflow-hidden rounded-xl bg-ink', aspect)}>
          {video.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.poster}
              alt=""
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
          ) : uploadedSrc ? (
            <video
              src={`${uploadedSrc}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
          ) : null}
          <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Icon name="videos" size={18} />
          </span>
        </div>
        <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{video.title}</div>
        <div className="mt-0.5 flex items-center gap-2 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">
          {video.youtube_views != null && (
            <span>
              <span className="font-bold text-ink-muted">{compact(video.youtube_views)}</span> views
            </span>
          )}
          {badge && <span>{badge}</span>}
        </div>
        <CardStat value={video.stat ?? 0} label={metricLabel('video')} />
      </button>

      {/* Detail modal — same single-style layout as the music cards. */}
      <CardModal
        open={detailOpen}
        onClose={() => !renameOpen && setDetailOpen(false)}
        wide
        footer={null}
      >
        <div className="font-space">
          <div className="grid grid-cols-2 gap-8">
            {/* LEFT — the player + title + 3-dots. */}
            <div className="flex min-w-0 flex-col gap-4">
              <div
                className={cx(
                  'relative flex items-center justify-center overflow-hidden rounded-2xl bg-ink',
                  video.is_short ? 'mx-auto w-full max-w-[260px] aspect-[9/16]' : 'aspect-video',
                )}
              >
                {uploadedSrc ? (
                  <video src={uploadedSrc} controls playsInline className="h-full w-full" />
                ) : video.embed_url ? (
                  <iframe
                    src={video.embed_url}
                    title={video.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full"
                  />
                ) : video.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={video.poster} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="videos" size={28} className="text-white/70" />
                )}
              </div>
              {/* Smaller than the music title — YouTube titles run long. */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 text-base font-bold leading-snug tracking-[-0.01em]">{video.title}</h3>
                {kebabMenu}
              </div>
            </div>

            {/* RIGHT — 30-day performance + the link row (same setup as the music link slots),
                with Close/Save pinned to the bottom. */}
            <div className="flex min-w-0 flex-col gap-6">
              <EntitySparkline artistId={artistId} entityIds={[video.id]} label="Clicks · 30d" />

              {/* Link row: brand icon · url · ↗ open — mirrors the streaming-link rows. */}
              <div className="flex items-center gap-3">
                <brand.Icon size={22} className={cx('flex-none', brand.color)} />
                <span className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 font-space text-[12px] text-ink">
                  {url}
                </span>
                <a
                  href={safeHref(url) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the video in a new tab"
                  title="Open video"
                  className="flex-none text-ink-muted transition-colors hover:text-ink"
                >
                  <Icon name="external" size={16} />
                </a>
              </div>

              {video.youtube_views != null && (
                <div className="font-space text-[11px] text-ink-faint">
                  <span className="font-bold text-ink-muted">{compact(video.youtube_views)}</span> views
                </div>
              )}

              <div className="mt-auto flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-paper px-5 py-2.5 font-space text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </CardModal>

      {/* Rename — a separate modal opened from the detail modal's 3-dots "Rename". */}
      <CardModal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-paper px-5 py-2.5 font-space text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveRename}
              disabled={!name.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-5 font-space">
          <h3 className="text-lg font-bold tracking-[-0.01em]">Rename video</h3>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Title</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveRename()}
              placeholder="Video title"
              className="w-full rounded-lg bg-surface px-3 py-2 font-space text-sm text-ink outline-none focus:bg-paper focus:ring-1 focus:ring-hairline"
            />
          </label>
        </div>
      </CardModal>
    </div>
  )
}
