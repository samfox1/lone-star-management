'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { createClient } from '@/lib/supabase/client'
import { FileDropField } from './file-drop-field'
import { useStorageUpload } from './use-storage-upload'

const PlayIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
)
const PauseIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
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
 * A small modal for the drop zone, so uploading never resizes the modal it's opened from.
 * It's PORTALED to document.body (not nested in the parent modal's DOM), so it can't affect
 * the parent's layout at all. It sits on top of another CardModal, so its Escape handler runs
 * in the CAPTURE phase and stops immediate propagation — Escape closes THIS modal only, not
 * the parent (whose keydown listener is on document in the bubble phase).
 */
function AudioUploadModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cx(modalCardClass, 'relative font-space')}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-ink-faint transition-colors hover:text-ink"
        >
          <Icon name="plus" size={18} className="rotate-45" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The audio section on every single-style modal. One control at the left: when the song
 * HAS audio it's a bare black play/pause driving the scrub timeline; when it has NONE it's
 * a plus that reveals a drag-and-drop / click upload zone. No separate "Add audio" button.
 * Draft audio lives in the PRIVATE `audio` bucket, streamed to the owner through a
 * short-lived signed URL (RLS scopes storage to the artist's folder).
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
  const [uploadOpen, setUploadOpen] = useState(false)
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  const { busy, error, progress, upload } = useStorageUpload({
    bucket: 'audio',
    artistId,
    category: 'audio',
    noun: 'audio',
    rules: { allowedExt: ['mp3', 'm4a'], maxBytes: 30 * 1024 * 1024, allowedMime: ['audio/mpeg', 'audio/mp4'] },
    writeRow: async (path) => {
      const { error: rowErr } = await createClient().from('tracks').update({ audio_path: path }).eq('id', trackId)
      return rowErr?.message ?? null
    },
    onSuccess: () => setUploadOpen(false),
  })

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

  const hasAudio = !!url
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
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface px-3 py-2">
        {hasAudio ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex-none text-ink transition-opacity hover:opacity-70"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setUploadOpen((v) => !v)}
            aria-label="Add audio"
            aria-expanded={uploadOpen}
            className="flex-none text-ink transition-opacity hover:opacity-70"
          >
            <Icon name="plus" size={20} />
          </button>
        )}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(frac * 1000)}
          onChange={seek}
          disabled={!hasAudio}
          aria-label="Seek"
          className={cx('h-1 flex-1 accent-ink', hasAudio ? 'cursor-pointer' : 'cursor-default opacity-40')}
        />
        <span className={cx('flex-none font-space text-[11px] tabular-nums', hasAudio ? 'text-ink-faint' : 'text-ink-faint/50')}>
          {fmtTime(current)} / {fmtTime(duration)}
        </span>
        {url && (
          <audio
            ref={ref}
            src={url}
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

      {/* The plus opens the drop zone in its OWN portaled modal, so the player never resizes. */}
      <AudioUploadModal open={uploadOpen && !hasAudio} onClose={() => setUploadOpen(false)}>
        <h3 className="text-lg font-bold tracking-[-0.01em]">Add audio</h3>
        <div className="mt-4">
          <FileDropField
            accept="audio/mpeg,audio/mp4,.mp3,.m4a"
            label="Drop an audio file, or click to upload"
            busy={busy}
            progress={progress}
            error={error}
            onFile={upload}
          />
        </div>
      </AudioUploadModal>
    </div>
  )
}
