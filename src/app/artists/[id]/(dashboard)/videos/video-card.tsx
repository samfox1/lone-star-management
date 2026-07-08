'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { metricLabel } from '@/lib/analytics'
import { SelectToggle } from '../select-toggle'
import { CardStat } from '../card-stat'
import { deleteContentAction } from '../actions'

export type VideoItem = {
  id: string
  title: string
  provider: string | null
  poster: string | null
  embed_url: string | null
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

/** Compact count label: 1.2M / 45.3K / 812. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

/** The public YouTube link to open/share: /shorts/<id> for a Short, /watch?v=<id>
 *  otherwise. Falls back to the stored embed URL if the id can't be parsed. */
function youtubeUrl(video: VideoItem): string {
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
  const badge = video.source && video.source !== 'manual' ? video.source : video.provider
  const url = youtubeUrl(video)

  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
            <form action={deleteContentAction.bind(null, 'video', video.id, artistId)}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-red hover:bg-danger-soft"
              >
                <Icon name="trash" size={15} /> Delete
              </button>
            </form>
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
    </div>
  )
}
