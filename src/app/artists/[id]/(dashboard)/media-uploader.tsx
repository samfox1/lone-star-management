'use client'

import { createClient } from '@/lib/supabase/client'
import type { SiteMedia } from '@/lib/site'
import { orientationOf, type Orientation } from '@/lib/site-editor/gallery'
import { IMAGE_UPLOAD_RULES, VIDEO_UPLOAD_RULES } from '@/lib/upload'
import type { AssetBudget } from '@/lib/site-editor/asset-budget'
import { UploadField } from './upload-field'

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
 * write to the artist's own folder), then registers it in the `media` table. The drop
 * field, the upload dance and the compression gate all come from `UploadField`.
 */
export function MediaUploader({
  artistId,
  purpose,
  folder,
  accept,
  label,
  budget,
  onUploaded,
}: {
  artistId: string
  purpose: SiteMedia['purpose']
  folder: string
  accept: string
  label: string
  /** The site's declared budget for this upload (manifest.assetBudgets). Absent = no
   *  gate — the dashboard pages have no manifest in scope and keep their byte caps. */
  budget?: AssetBudget | null
  /** Fires after the row is written, with the new media id + path (for optimistic UI). */
  onUploaded?: (media: { id: string; storage_path: string }) => void
}) {
  const isVideo = accept.includes('video')
  const noun = isVideo ? 'video' : accept.includes('image') ? 'image' : 'file'

  return (
    <UploadField
      accept={accept}
      label={label}
      kind={isVideo ? 'video' : 'image'}
      budget={budget}
      bucket="media"
      artistId={artistId}
      category={folder}
      noun={noun}
      rules={isVideo ? VIDEO_UPLOAD_RULES : IMAGE_UPLOAD_RULES}
      writeRow={async (path) => {
        const { data, error: rowErr } = await createClient()
          .from('media')
          .insert({ artist_id: artistId, purpose, storage_path: path, sort_order: Math.floor(Date.now() / 1000) })
          .select('id')
          .single()
        if (rowErr) return rowErr.message
        if (data) onUploaded?.({ id: data.id as string, storage_path: path })
        return null
      }}
    />
  )
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
  budget,
  onUploaded,
}: {
  artistId: string
  /** Fallback orientation if the file's dimensions can't be measured. */
  orientation: Orientation
  label?: string
  /** The site's declared budget for this slot/kind. Absent = no gate. */
  budget?: AssetBudget | null
  /** Fires after the row is written, with the new photo's id/path + its orientation. */
  onUploaded?: (media: { id: string; storage_path: string; orientation: Orientation }) => void
}) {
  return (
    <UploadField
      accept="image/*"
      label={label}
      kind="image"
      budget={budget}
      bucket="media"
      artistId={artistId}
      category="gallery"
      noun="image"
      rules={IMAGE_UPLOAD_RULES}
      // Measured inside writeRow, from the file that is ACTUALLY being stored. It used to
      // be measured before the upload and stashed in a ref, which was one more thing to
      // keep in step with the gate — the compressed file is what lands in the library, so
      // it is the one whose shape decides which group the photo joins.
      writeRow={async (path, file) => {
        const size = await readImageSize(file)
        // TWO ways to have no shape, and both fall back to the group: the file would not
        // decode, or it decoded with a degenerate dimension (orientationOf returns null).
        const orient = (size ? orientationOf(size.width, size.height) : null) ?? orientation
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
      }}
    />
  )
}
