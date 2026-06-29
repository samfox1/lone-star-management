'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const MAX_BYTES = 30 * 1024 * 1024 // 30 MB
const OK_EXT = new Set(['mp3', 'm4a'])

/**
 * Uploads a track's audio straight to the PRIVATE `audio` bucket (RLS scopes the
 * write to the artist's folder), then sets tracks.audio_path. A random filename
 * means the stored path leaks nothing. The file is draft until the track is
 * published; the public site only ever gets a signed URL for published audio.
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
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!OK_EXT.has(ext)) {
      setError('Use an mp3 or m4a file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Audio must be under 30 MB.')
      return
    }

    setBusy(true)
    const supabase = createClient()
    const path = `${artistId}/audio/${crypto.randomUUID()}.${ext}`
    // Send a content-type the bucket's allowed_mime_types accepts (browsers report
    // m4a inconsistently), so a valid file isn't rejected by the bucket guard.
    const contentType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4'

    const { error: upErr } = await supabase.storage
      .from('audio')
      .upload(path, file, { contentType, upsert: false })
    if (upErr) {
      setError(upErr.message)
      setBusy(false)
      return
    }

    const { error: rowErr } = await supabase.from('tracks').update({ audio_path: path }).eq('id', trackId)
    if (rowErr) {
      await supabase.storage.from('audio').remove([path]) // no orphan on failure
      setError(rowErr.message)
      setBusy(false)
      return
    }

    if (inputRef.current) inputRef.current.value = ''
    setBusy(false)
    router.refresh()
  }

  return (
    <label className="inline-flex w-fit cursor-pointer items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink">
      {busy ? 'Uploading…' : hasAudio ? '♪ Replace audio' : '♪ Add audio'}
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,.mp3,.m4a"
        onChange={onChange}
        disabled={busy}
        className="hidden"
      />
      {error && <span className="ml-2 text-accent-red">{error}</span>}
    </label>
  )
}
