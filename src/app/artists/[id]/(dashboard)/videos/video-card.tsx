'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { buttonClass, inputClass, KLabel, modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { metricLabel } from '@/lib/analytics'
import { publicVideoSrc } from '@/lib/video-render'
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
  visible: boolean
  /** Global YouTube view count (cached on sync); null if unknown. */
  youtube_views?: number | null
  /** 30-day clicks from the artist's own site (video_click), from analytics_by_entity. */
  stat?: number
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
 * the video on YouTube in a new tab. A three-dots menu (top-right) shares the link
 * (native share sheet, or copy to clipboard) or deletes the video. A select checkbox
 * + "On site" badge (top-left) drive the password-gated publish, owned by the parent.
 */
export function VideoCard({
  video,
  artistId,
  selected,
  onToggleSelect,
}: {
  video: VideoItem
  artistId: string
  selected: boolean
  onToggleSelect: () => void
}) {
  const badgeRaw = video.source && video.source !== 'manual' ? video.source : video.provider
  const badge = badgeRaw ? (BADGE_LABEL[badgeRaw] ?? badgeRaw) : null
  const url = videoOpenUrl(video)

  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(video.title)
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const busyRef = useRef(false) // hard re-entry latch shared by delete + rename
  async function del() {
    if (busyRef.current) return
    busyRef.current = true
    setMenuOpen(false)
    try {
      const res = await deleteContentAction('video', video.id, artistId)
      if (res?.error) toast(res.error, 'error')
      else toast('Video deleted')
    } catch {
      toast("Couldn't delete that video.", 'error')
    } finally {
      busyRef.current = false
    }
  }

  async function saveRename() {
    if (busyRef.current || !name.trim()) return
    busyRef.current = true
    setSaving(true)
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
      setSaving(false)
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

  useEffect(() => {
    if (!renameOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRenameOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [renameOpen])

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
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — nothing more we can do silently
    }
  }

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 z-10">
        <SelectToggle selected={selected} visible={video.visible} onToggle={onToggleSelect} label={video.title} />
      </div>

      <div ref={menuRef} className="absolute right-2 top-2 z-20">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Video options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
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
              onClick={share}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
            >
              <Icon name="share" size={15} /> Share
            </button>
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
              onClick={del}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-red hover:bg-danger-soft"
            >
              <Icon name="trash" size={15} /> Delete
            </button>
          </div>
        )}
      </div>

      <a href={url} target="_blank" rel="noopener noreferrer" className="group block">
        <div
          className={`relative flex ${video.is_short ? 'aspect-[9/16]' : 'aspect-video'} items-center justify-center overflow-hidden rounded-xl bg-ink`}
        >
          {video.poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.poster}
              alt=""
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
          )}
          <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Icon name="videos" size={18} />
          </span>
          {copied && (
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-white">
              Link copied
            </span>
          )}
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
      </a>

      {renameOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && setRenameOpen(false)}
        >
          <div className={modalCardClass}>
            <KLabel>Video</KLabel>
            <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">Rename</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveRename()}
              placeholder="Video title"
              className={`${inputClass} mt-4 w-full`}
            />
            <div className="mt-5 flex justify-end gap-2 border-t border-hairline pt-4">
              <button type="button" onClick={() => setRenameOpen(false)} className={buttonClass('ghost')}>
                Cancel
              </button>
              <button type="button" onClick={saveRename} disabled={saving || !name.trim()} className={buttonClass('solid')}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
