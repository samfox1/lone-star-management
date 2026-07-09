/**
 * Media manager for the dashboard: upload/list/delete the artist's hero videos,
 * profile photo, and gallery images. Uploads go direct to Storage
 * (MediaUploader); deletes use a server action. `driveImport` (optional) is the
 * Drive copy-import affordance for gallery images, bound by the page.
 */
import type { ReactNode } from 'react'
import { mediaUrl } from '@/lib/site'
import { MediaUploader } from './media-uploader'
import { MediaDeleteButton } from './media-delete-button'

export type MediaRow = {
  id: string
  purpose: 'hero_video' | 'profile_photo' | 'gallery_image'
  storage_path: string
}

function DeleteButton({ row, artistId }: { row: MediaRow; artistId: string }) {
  return (
    <MediaDeleteButton
      mediaId={row.id}
      storagePath={row.storage_path}
      artistId={artistId}
      noun={row.purpose === 'hero_video' ? 'Video' : row.purpose === 'profile_photo' ? 'Photo' : 'Image'}
      className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
    />
  )
}

export function MediaPanel({
  artistId,
  media,
  driveImport,
}: {
  artistId: string
  media: MediaRow[]
  driveImport?: ReactNode
}) {
  const heroVideos = media.filter((m) => m.purpose === 'hero_video')
  const profile = media.find((m) => m.purpose === 'profile_photo')
  const gallery = media.filter((m) => m.purpose === 'gallery_image')

  return (
    <section className="mb-4 rounded-xl border border-hairline bg-paper p-4">
      <h2 className="text-[15px] font-bold tracking-[-0.01em]">Media</h2>

      {/* Hero videos */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
            Hero videos {heroVideos.length > 0 && `(${heroVideos.length})`}
          </span>
          <MediaUploader
            artistId={artistId}
            purpose="hero_video"
            folder="hero-videos"
            accept="video/*"
            label="Add video"
          />
        </div>
        {heroVideos.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {heroVideos.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-hairline p-2"
              >
                <video
                  src={mediaUrl(m.storage_path)}
                  className="h-12 w-20 rounded object-cover"
                  muted
                  preload="metadata"
                />
                <span className="flex-1 truncate font-space text-[11px] text-ink-faint">
                  {m.storage_path.split('/').pop()}
                </span>
                <DeleteButton row={m} artistId={artistId} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-space text-xs text-ink-faint">No hero videos yet.</p>
        )}
      </div>

      {/* Profile photo */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
            Profile photo
          </span>
          <MediaUploader
            artistId={artistId}
            purpose="profile_photo"
            folder="profile"
            accept="image/*"
            label={profile ? 'Replace photo' : 'Add photo'}
          />
        </div>
        {profile ? (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-hairline p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(profile.storage_path)} alt="" className="h-16 w-16 rounded object-cover" />
            <span className="flex-1 truncate font-space text-[11px] text-ink-faint">
              {profile.storage_path.split('/').pop()}
            </span>
            <DeleteButton row={profile} artistId={artistId} />
          </div>
        ) : (
          <p className="mt-2 font-space text-xs text-ink-faint">
            No profile photo — the public About falls back to the hero image.
          </p>
        )}
      </div>

      {/* Gallery images — dashboard-managed pool (no public gallery section yet). */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
            Gallery images {gallery.length > 0 && `(${gallery.length})`}
          </span>
          <div className="flex items-center gap-2">
            {driveImport}
            <MediaUploader
              artistId={artistId}
              purpose="gallery_image"
              folder="gallery"
              accept="image/*"
              label="Add image"
            />
          </div>
        </div>
        {gallery.length > 0 ? (
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {gallery.map((m) => (
              <li key={m.id} className="group relative overflow-hidden rounded-xl border border-hairline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(m.storage_path)} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute right-1 top-1 rounded bg-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                  <DeleteButton row={m} artistId={artistId} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-space text-xs text-ink-faint">No gallery images yet.</p>
        )}
      </div>
    </section>
  )
}
