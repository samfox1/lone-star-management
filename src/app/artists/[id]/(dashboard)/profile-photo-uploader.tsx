'use client'

import type { AssetBudget } from '@/lib/site-editor/asset-budget'
import { MediaUploader } from './media-uploader'
import { toast } from './toast'
import { setProfilePhotoAction } from './(manager-tools)/profile/photo-actions'

/**
 * An upload that becomes THE profile photo the way the Profile page's picker does it
 * (photo-picker.tsx): the photo lands in Images first (MediaUploader: a `gallery_image` row in
 * the `gallery` folder, off the site, the same as the Images page), then the slot takes THAT
 * Images photo by its id (setProfilePhotoAction), so the profile row shares the library file.
 *
 * Sam, 2026-10-02: "an upload lands in Images too". These doors used to upload into `profile/`
 * only, so after a replace the old photo was named by nothing a manager could pick, and no Revert
 * brings a profile photo back (the editor's restore only re-places gallery photos). Now every
 * photo that was ever the profile photo is still in Images, one pick away.
 *
 * If the set fails, the photo stays in Images: its row was written, so the upload is not undone,
 * and the toast says so.
 *
 * Two doors use it: the Site & profile page (template sites) and the editor's Profile photo tile.
 */
export function ProfilePhotoUploader({
  artistId,
  label,
  budget,
  onSet,
}: {
  artistId: string
  label: string
  /** The site's image budget, from the editor (manifest.assetBudgets). The page has none. */
  budget?: AssetBudget | null
  /** Told the new photo's file once it IS the profile photo (the editor repaints its tile). */
  onSet?: (path: string) => void
}) {
  async function makeProfilePhoto(m: { id: string; storage_path: string }) {
    let error: string | undefined
    try {
      error = (await setProfilePhotoAction(artistId, m.id)).error
    } catch {
      error = 'Could not set the profile photo.'
    }
    if (error) return toast(`The photo is in Images, but it is not the profile photo yet: ${error}`, 'error')
    onSet?.(m.storage_path)
  }

  return (
    <MediaUploader
      artistId={artistId}
      purpose="gallery_image"
      folder="gallery"
      accept="image/*"
      label={label}
      budget={budget}
      onUploaded={(m) => void makeProfilePhoto(m)}
    />
  )
}
