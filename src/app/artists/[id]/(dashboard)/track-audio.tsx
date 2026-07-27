'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrackAudioUploader } from './track-audio-uploader'

/**
 * The audio section shown on every single-style modal (release single, album song,
 * orphan single): a player when the track has uploaded audio, plus the add/replace
 * uploader. Draft audio lives in the PRIVATE `audio` bucket, so the owner streams it
 * through a short-lived signed URL (RLS scopes storage to the artist's folder). It only
 * renders when the modal is open (its parent unmounts the body on close), so it fetches
 * on mount; a failure just hides the player.
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
      {url && <audio controls src={url} className="w-full" />}
      <TrackAudioUploader artistId={artistId} trackId={trackId} hasAudio={!!audioPath} />
    </div>
  )
}
