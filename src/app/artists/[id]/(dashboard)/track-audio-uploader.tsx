'use client'

import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useStorageUpload } from './use-storage-upload'

/**
 * Uploads a track's audio to the PRIVATE `audio` bucket (RLS scopes the write to the
 * artist's folder) and sets tracks.audio_path. Draft until the track is published; the
 * public site only ever gets a signed URL for published audio. The upload/orphan dance
 * lives in useStorageUpload; this keeps its inline text label rather than a drop zone.
 */
export function TrackAudioUploader({
  artistId,
  trackId,
  hasAudio,
}: {
  artistId: string
  trackId: string
  hasAudio: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { busy, error, upload } = useStorageUpload({
    bucket: 'audio',
    artistId,
    category: 'audio',
    noun: 'audio',
    rules: { allowedExt: ['mp3', 'm4a'], maxBytes: 30 * 1024 * 1024, allowedMime: ['audio/mpeg', 'audio/mp4'] },
    writeRow: async (path) => {
      const { error: rowErr } = await createClient().from('tracks').update({ audio_path: path }).eq('id', trackId)
      return rowErr?.message ?? null
    },
  })

  return (
    <label className="inline-flex w-fit cursor-pointer items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink">
      {busy ? 'Uploading…' : hasAudio ? '♪ Replace audio' : '♪ Add audio'}
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,.mp3,.m4a"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
        disabled={busy}
        className="hidden"
      />
      {error && <span className="ml-2 text-accent-red">{error}</span>}
    </label>
  )
}
