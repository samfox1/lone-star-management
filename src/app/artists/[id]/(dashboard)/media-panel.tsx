/**
 * Media manager for the dashboard: upload/list/delete the artist's hero videos
 * and profile photo. Uploads go direct to Storage (MediaUploader); deletes use
 * a server action.
 */
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
      noun={row.purpose === 'profile_photo' ? 'Photo' : 'Video'}
      className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
    />
  )
}

export function MediaPanel({ artistId, media }: { artistId: string; media: MediaRow[] }) {
  const heroVideos = media.filter((m) => m.purpose === 'hero_video')
  const profile = media.find((m) => m.purpose === 'profile_photo')

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
    </section>
  )
}
