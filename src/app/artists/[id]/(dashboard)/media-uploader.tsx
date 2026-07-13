'use client'

import { createClient } from '@/lib/supabase/client'
import type { SiteMedia } from '@/lib/site'
import { useStorageUpload } from './use-storage-upload'
import { FileDropField } from './file-drop-field'

/**
 * Uploads a media file straight from the browser to the `media` bucket (RLS scopes the
 * write to the artist's own folder), then registers it in the `media` table. The
 * upload/orphan dance lives in useStorageUpload; the UI is the shared drop field.
 */
export function MediaUploader({
  artistId,
  purpose,
  folder,
  accept,
  label,
  onUploaded,
}: {
  artistId: string
  purpose: SiteMedia['purpose']
  folder: string
  accept: string
  label: string
  /** Fires after the row is written, with the new media id + path (for optimistic UI). */
  onUploaded?: (media: { id: string; storage_path: string }) => void
}) {
  const isVideo = accept.includes('video')
  const noun = isVideo ? 'video' : accept.includes('image') ? 'image' : 'file'
  const rules = isVideo
    ? { allowedExt: ['mp4', 'webm', 'mov'], maxBytes: 524288000, allowedMime: ['video/mp4', 'video/webm', 'video/quicktime'] }
    : {
        allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        maxBytes: 26214400,
        allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      }
  const { busy, error, upload } = useStorageUpload({
    bucket: 'media',
    artistId,
    category: folder,
    noun,
    rules,
    writeRow: async (path) => {
      const { data, error: rowErr } = await createClient()
        .from('media')
        .insert({ artist_id: artistId, purpose, storage_path: path, sort_order: Math.floor(Date.now() / 1000) })
        .select('id')
        .single()
      if (rowErr) return rowErr.message
      if (data) onUploaded?.({ id: data.id as string, storage_path: path })
      return null
    },
  })

  return <FileDropField accept={accept} label={label} busy={busy} error={error} onFile={upload} />
}
