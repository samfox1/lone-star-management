'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { createClient } from '@/lib/supabase/client'
import { TrackAudioUploader } from './track-audio-uploader'

const PlayIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
  </svg>
)

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * A play/pause + timeline the modal ALWAYS shows — greyed and inert when the song has
 * no audio file, live once one is uploaded. Drives a hidden <audio>; the seek bar is a
 * range the manager can scrub.
 */
function AudioPlayer({ src }: { src: string | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const disabled = !src
  const frac = duration ? current / duration : 0

  function toggle() {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }
  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = ref.current
    if (!a || !duration) return
    a.currentTime = (Number(e.target.value) / 1000) * duration
  }

  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl border border-hairline bg-surface px-3 py-2',
        disabled && 'opacity-45',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-white transition-colors enabled:hover:bg-black disabled:cursor-not-allowed"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(frac * 1000)}
        onChange={seek}
        disabled={disabled}
        aria-label="Seek"
        className="h-1 flex-1 cursor-pointer accent-ink disabled:cursor-not-allowed"
      />
      <span className="flex-none font-space text-[11px] tabular-nums text-ink-faint">
        {fmtTime(current)} / {fmtTime(duration)}
      </span>
      {src && (
        <audio
          ref={ref}
          src={src}
          preload="metadata"
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => setCurrent(ref.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  )
}

/**
 * The audio section shown on every single-style modal (release single, album song,
 * orphan single): the always-present player above, plus the add/replace uploader. Draft
 * audio lives in the PRIVATE `audio` bucket, so the owner streams it through a short-lived
 * signed URL (RLS scopes storage to the artist's folder). It only renders when the modal
 * is open (its parent unmounts the body on close), so it fetches on mount; a failed fetch
 * just leaves the player greyed.
 */
export function TrackAudio({
  artistId,
  trackId,
  audioPath,
}: {
  artistId: string
  trackId: string
  audioPath: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!audioPath) return
    let alive = true
    createClient()
      .storage.from('audio')
      .createSignedUrl(audioPath, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null)
      })
    return () => {
      alive = false
    }
  }, [audioPath])

  return (
    <div className="space-y-2">
      <AudioPlayer src={url} />
      <TrackAudioUploader artistId={artistId} trackId={trackId} hasAudio={!!audioPath} />
    </div>
  )
}
