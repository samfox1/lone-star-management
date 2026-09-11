'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { metricLabel } from '@/lib/analytics'
import { safeHref } from '@/lib/url'
import { publicVideoSrc } from '@/lib/video-render'
import { CardModal } from '../card-modal'
import { KvField, MetaDot, ModalHeader } from '../modal-kit'
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
  return video.is_short ? `https://www.youtube.com/shorts/${m[1]}` : `https://www.youtube.com/watch?v=${m[1]}`
}

/**
 * A video as a thumbnail tile (16:9, or 9:16 for a Short). Clicking it opens its modal —
 * built on modal-kit (prototype G, Sam, 2026-09-11): poster · title · provider / views
 * meta, the player, then rows — Title (renames on the spot), Link (read-only, opens the
 * public page). Share and Analytics in the corner, Delete / Done in the footer. No ⋯
 * menu, no Rename sheet, no Save, no click numbers. The checkbox (top-left) is a LIVE
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
  const uploadedSrc =
    video.provider === 'uploaded' && video.storage_path
      ? publicVideoSrc({ provider: 'uploaded', embed_url: null, storage_path: video.storage_path })
      : null
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(video.title)

  async function rename(next: string) {
    if (!next) return { error: 'Give the video a title.' }
    const res = await renameVideoAction(video.id, artistId, next)
    if (!res?.error) setTitle(next)
    return res
  }

  // Share the public video page — native sheet where available, clipboard otherwise.
  async function share() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url })
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
  const poster = (size: number) =>
    video.poster ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={video.poster} alt="" className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-ink text-white/70">
        <Icon name="videos" size={size} />
      </div>
    )

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 z-10">
        {/* selected === onSite under a live toggle, so this only ever reads live or
            off — SelectToggle's pending-add/pending-drop states can't arise here. */}
        <SelectToggle selected={onSite} onSite={onSite} onToggle={onToggleOnSite} label={title} />
      </div>
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
        <div className={cx('relative flex items-center justify-center overflow-hidden rounded-xl bg-ink', aspect)}>
          {video.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.poster} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
          ) : uploadedSrc ? (
            <video src={`${uploadedSrc}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
          ) : null}
          <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Icon name="videos" size={18} />
          </span>
        </div>
        <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{title}</div>
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

      <CardModal
        open={open}
        onClose={() => setOpen(false)}
        label={title}
        analyticsHref={`/artists/${artistId}`}
        deleteAction={deleteContentAction.bind(null, 'video', video.id, artistId)}
        deleteLabel="Delete"
        deleteNoun="Video"
        corner={
          <button
            type="button"
            onClick={share}
            aria-label="Share"
            title="Share the video"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="share" size={16} />
          </button>
        }
      >
        <ModalHeader
          square={poster(20)}
          title={title}
          meta={
            <>
              {badge ? <span>{badge}</span> : null}
              {badge && video.youtube_views != null ? <MetaDot /> : null}
              {video.youtube_views != null ? (
                <span>
                  <b className="text-ink">{compact(video.youtube_views)}</b> views
                </span>
              ) : null}
              {video.is_short ? (
                <>
                  <MetaDot />
                  <span>Short</span>
                </>
              ) : null}
            </>
          }
        />
        {/* The player, full width under the header; a Short keeps its portrait frame. */}
        <div className={cx('mt-5 overflow-hidden rounded-2xl bg-ink', video.is_short ? 'mx-auto w-full max-w-[220px] aspect-[9/16]' : 'aspect-video')}>
          {uploadedSrc ? (
            <video src={uploadedSrc} controls playsInline className="h-full w-full" />
          ) : video.embed_url ? (
            <iframe
              src={video.embed_url}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">{poster(28)}</div>
          )}
        </div>
        <div className="mt-4">
          <KvField label="Title" value={title} onSave={rename} onError={(m) => toast(m, 'error')} />
          <KvField
            label="Link"
            value={url}
            mono
            readOnly
            onSave={async () => undefined}
            trailing={
              <a
                href={safeHref(url) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the video in a new tab"
                title="Open video"
                className="flex-none text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="external" size={14} />
              </a>
            }
          />
        </div>
      </CardModal>
    </div>
  )
}
