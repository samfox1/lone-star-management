/**
 * Media manager for the dashboard: upload/list/delete the artist's hero videos
 * and profile photo. Uploads go direct to Storage (MediaUploader); deletes use
 * a server action.
 */
import { mediaUrl } from '@/lib/site'
import { MediaUploader } from './media-uploader'
import { deleteMediaAction } from './actions'

export type MediaRow = {
  id: string
  purpose: 'hero_video' | 'profile_photo' | 'gallery_image'
  storage_path: string
}

function DeleteButton({ row, artistId }: { row: MediaRow; artistId: string }) {
  return (
    <form action={deleteMediaAction.bind(null, row.id, row.storage_path, artistId)}>
      <button
        type="submit"
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
      >
        Delete
      </button>
    </form>
  )
}

export function MediaPanel({ artistId, media }: { artistId: string; media: MediaRow[] }) {
  const heroVideos = media.filter((m) => m.purpose === 'hero_video')
  const profile = media.find((m) => m.purpose === 'profile_photo')

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Media</h2>

      {/* Hero videos */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
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
                className="flex items-center gap-3 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
              >
                <video
                  src={mediaUrl(m.storage_path)}
                  className="h-12 w-20 rounded object-cover"
                  muted
                  preload="metadata"
                />
                <span className="flex-1 truncate text-xs text-zinc-500">
                  {m.storage_path.split('/').pop()}
                </span>
                <DeleteButton row={m} artistId={artistId} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">No hero videos yet.</p>
        )}
      </div>

      {/* Profile photo */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
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
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(profile.storage_path)} alt="" className="h-16 w-16 rounded object-cover" />
            <span className="flex-1 truncate text-xs text-zinc-500">
              {profile.storage_path.split('/').pop()}
            </span>
            <DeleteButton row={profile} artistId={artistId} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">
            No profile photo — the public About falls back to the hero image.
          </p>
        )}
      </div>
    </section>
  )
}
