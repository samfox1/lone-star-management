'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { PortalModal } from '@/components/ui/portal-modal'
import { createClient } from '@/lib/supabase/client'
import { acceptFor, AUDIO_UPLOAD_RULES } from '@/lib/upload'
import { FileDropField } from './file-drop-field'
import { useStorageUpload } from './use-storage-upload'
import { toast } from './toast'

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
 * The drop zone's modal is the shared PortalModal: portaled (so uploading never resizes
 * the modal it's opened from) with the capture-phase Escape that closes THIS modal only,
 * not the CardModal under it. The `open` gate stays here so call sites keep their shape.
 */
function AudioUploadModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <PortalModal ariaLabel="Upload audio" onClose={onClose}>
      {children}
    </PortalModal>
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
    rules: AUDIO_UPLOAD_RULES,
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
      .then(({ data, error }) => {
        if (!alive) return
        if (error) toast("Couldn't load this audio file.", 'error')
        setUrl(data?.signedUrl ?? null)
      })
    return () => {
      alive = false
    }
  }, [audioPath])

  // A file EXISTS whenever the track has an audio_path. `url` is only the resolved signed
  // URL — so we gate play/plus and the uploader on the FILE (never offer to overwrite an
  // existing file via the plus), and gate actual playback/scrub on the URL being ready.
  const hasFile = !!audioPath
  const canPlay = !!url
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
        {hasFile ? (
          <button
            type="button"
            onClick={toggle}
            disabled={!canPlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex-none text-ink transition-opacity enabled:hover:opacity-70 disabled:opacity-40"
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
          disabled={!canPlay}
          aria-label="Seek"
          className={cx('h-1 flex-1 accent-ink', canPlay ? 'cursor-pointer' : 'cursor-default opacity-40')}
        />
        <span className={cx('flex-none font-space text-[11px] tabular-nums', canPlay ? 'text-ink-faint' : 'text-ink-faint/50')}>
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

      {/* The plus opens the drop zone in its OWN portaled modal, so the player never resizes.
          Gated on hasFile so it can never open for a track that already has audio. */}
      <AudioUploadModal open={uploadOpen && !hasFile} onClose={() => setUploadOpen(false)}>
        <h3 className="text-lg font-bold tracking-[-0.01em]">Add audio</h3>
        <div className="mt-4">
          <FileDropField
            accept={acceptFor(AUDIO_UPLOAD_RULES)}
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
