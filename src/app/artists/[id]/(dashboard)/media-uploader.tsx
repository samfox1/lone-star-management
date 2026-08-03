'use client'

import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SiteMedia } from '@/lib/site'
import { orientationOf, type Orientation } from '@/lib/site-editor/gallery'
import { IMAGE_UPLOAD_RULES, VIDEO_UPLOAD_RULES } from '@/lib/upload'
import { useStorageUpload } from './use-storage-upload'
import { FileDropField } from './file-drop-field'

/** Read an image file's natural pixel size in the browser, for orientation detection.
 *  Resolves null if it can't decode (then we simply don't warn). */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

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
  const rules = isVideo ? VIDEO_UPLOAD_RULES : IMAGE_UPLOAD_RULES
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

/**
 * The uploader inside a gallery orientation group's asset picker (the editor's Images
 * panel). A new photo lands in the LIBRARY (off-site) tagged with its OWN measured shape
 * — a photo is horizontal or vertical by its real dimensions, not by which picker you
 * uploaded from — so a portrait uploaded from the Horizontal picker joins the Vertical
 * library. The `orientation` prop is only the fallback when the file can't be measured.
 * The manager then places it into the collage.
 */
export function GallerySlotUploader({
  artistId,
  orientation,
  label = 'Drop a photo or click to upload',
  onUploaded,
}: {
  artistId: string
  /** Fallback orientation if the file's dimensions can't be measured. */
  orientation: Orientation
  label?: string
  /** Fires after the row is written, with the new photo's id/path + its orientation. */
  onUploaded?: (media: { id: string; storage_path: string; orientation: Orientation }) => void
}) {
  // A photo IS horizontal or vertical by its real shape, not by which picker uploaded it
  // — measured here and stored, so it lands in the matching group. `orientation` (the
  // group) is only the fallback for an unmeasurable file.
  const detectedRef = useRef<Orientation | null>(null)
  const { busy, error, upload } = useStorageUpload({
    bucket: 'media',
    artistId,
    category: 'gallery',
    noun: 'image',
    rules: IMAGE_UPLOAD_RULES,
    writeRow: async (path) => {
      const orient = detectedRef.current ?? orientation
      const { data, error: rowErr } = await createClient()
        .from('media')
        .insert({
          artist_id: artistId,
          purpose: 'gallery_image',
          storage_path: path,
          orientation: orient,
          on_site: false,
          sort_order: Math.floor(Date.now() / 1000),
        })
        .select('id')
        .single()
      if (rowErr) return rowErr.message
      if (data) onUploaded?.({ id: data.id as string, storage_path: path, orientation: orient })
      return null
    },
  })

  async function onFile(file: File) {
    const size = await readImageSize(file)
    detectedRef.current = size ? orientationOf(size.width, size.height) : null
    await upload(file)
  }

  return <FileDropField accept="image/*" label={label} busy={busy} error={error} onFile={onFile} />
}
