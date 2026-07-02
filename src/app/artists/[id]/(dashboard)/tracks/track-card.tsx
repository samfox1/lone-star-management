'use client'

import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { deleteContentAction, updateContentAction } from '../actions'
import { TrackAudioUploader } from '../track-audio-uploader'

export type Track = {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  source: string | null
  audio_path: string | null
}

/**
 * A track as a cover-grid card (Spotify/synced cover + title); clicking opens a
 * modal to rename, attach hosted audio, open the source, or delete. Keeps the
 * grid clean while preserving the full inline editor.
 */
export function TrackCard({ track, artistId }: { track: Track; artistId: string }) {
  const [open, setOpen] = useState(false)
  const badge = track.source && track.source !== 'manual' ? track.source : null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
          {track.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="h-9 w-9 rounded-full bg-ink" />
          )}
        </div>
        <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{track.title}</div>
        {badge && (
          <div className="mt-0.5 font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">
            {badge}
          </div>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-[440px] max-w-full rounded-2xl bg-paper p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface">
                {track.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="h-7 w-7 rounded-full bg-ink" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <form
                  action={updateContentAction.bind(null, 'track', track.id, artistId)}
                  className="flex items-center gap-2"
                >
                  <input name="title" defaultValue={track.title} required className={`${inputClass} flex-1`} />
                  <button type="submit" className={buttonClass('ghost')}>
                    Save
                  </button>
                </form>
                {badge && (
                  <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                    from {badge}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <TrackAudioUploader artistId={artistId} trackId={track.id} hasAudio={!!track.audio_path} />
              {track.stream_url && (
                <a
                  href={track.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-space text-xs text-ink-muted hover:underline"
                >
                  Open source ↗
                </a>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <form action={deleteContentAction.bind(null, 'track', track.id, artistId)}>
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                >
                  Delete track
                </button>
              </form>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost')}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
