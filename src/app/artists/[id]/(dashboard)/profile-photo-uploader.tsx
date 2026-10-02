'use client'

import { IMAGE_UPLOAD_RULES } from '@/lib/upload'
import { UploadField } from './upload-field'
import { setProfilePhotoFileAction } from './(manager-tools)/profile/photo-actions'

/**
 * The Site & profile page's profile-photo upload (template sites). It used to INSERT a row, so a
 * replace left two profile photos; it now writes through the same vacate-then-insert as the
 * Profile page and the editor (lib/profile-photo.ts), so all three write the one record. Same
 * bucket, folder and gate as before.
 */
export function ProfilePhotoUploader({ artistId, label }: { artistId: string; label: string }) {
  return (
    <UploadField
      accept="image/*"
      label={label}
      kind="image"
      bucket="media"
      artistId={artistId}
      category="profile"
      noun="image"
      rules={IMAGE_UPLOAD_RULES}
      writeRow={async (path) => (await setProfilePhotoFileAction(artistId, path)).error ?? null}
    />
  )
}
