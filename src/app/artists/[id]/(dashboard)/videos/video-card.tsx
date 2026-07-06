'use client'

import { Icon } from '@/components/ui/icons'
import { GridCard } from '../grid-card'
import { deleteContentAction } from '../actions'

export type VideoItem = {
  id: string
  title: string
  provider: string | null
  poster: string | null
  embed_url: string | null
  source: string | null
}

/**
 * A video as a 16:9 thumbnail tile; opens a modal to open the source or delete.
 * Videos have no editable fields (adds run through embedInfo), so the modal is
 * view/open/delete only.
 */
export function VideoCard({ video, artistId }: { video: VideoItem; artistId: string }) {
  const badge = video.source && video.source !== 'manual' ? video.source : video.provider

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'video', video.id, artistId)}
      deleteLabel="Delete video"
      tile={
        <>
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-ink">
            {video.poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={video.poster} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
            )}
            <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <Icon name="videos" size={18} />
            </span>
          </div>
          <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{video.title}</div>
          {badge && (
            <div className="mt-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">{badge}</div>
          )}
        </>
      }
    >
      <h3 className="truncate text-lg font-bold tracking-[-0.01em]">{video.title}</h3>
      {badge && (
        <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">{badge}</div>
      )}
      {video.embed_url && (
        <a
          href={video.embed_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block font-space text-xs text-ink-muted hover:underline"
        >
          Open source ↗
        </a>
      )}
    </GridCard>
  )
}
