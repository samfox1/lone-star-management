import { createClient } from '@/lib/supabase/server'
import { mediaUrl } from '@/lib/site'
import { KLabel } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { importDriveFileAction, listDriveFilesAction } from '../actions'
import { AssetsShell } from '../assets-rail'
import { MediaUploader } from '../media-uploader'
import { MediaDeleteButton } from '../media-delete-button'
import { DriveBrowser } from '../drive-browser'
import { DriveImportButton } from '../drive-import-button'
import { EmptyState } from '../empty-state'

/**
 * Photos — the image half of the Assets library (the Videos page's simpler
 * sibling: no Shorts split, and no publish machinery — photos are stored assets
 * the manager will place onto the site from its own surfaces). Upload directly
 * or copy-import from the connected Drive folder; hover a tile to delete.
 */
export default async function ImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const { data: rows } = await supabase
    .from('media')
    .select('id, storage_path')
    .eq('artist_id', id)
    .eq('purpose', 'gallery_image')
    .order('sort_order')
    .order('created_at')
  const photos = rows ?? []

  return (
    <AssetsShell artistId={id} active="photos">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <KLabel>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </KLabel>
          <div className="flex items-center gap-2">
            {artist.drive_folder_id && (
              <DriveImportButton title="Import photos from Drive">
                <DriveBrowser
                  kind="image"
                  listAction={listDriveFilesAction.bind(null, id, 'image')}
                  importAction={importDriveFileAction.bind(null, id, 'image')}
                />
              </DriveImportButton>
            )}
            <MediaUploader artistId={id} purpose="gallery_image" folder="gallery" accept="image/*" label="Add photo" />
          </div>
        </div>

        {photos.length === 0 ? (
          <EmptyState
            icon="photo"
            title="No photos yet"
            hint="Upload images or import them from the connected Drive folder."
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {photos.map((m) => (
              <li key={m.id as string} className="group relative overflow-hidden rounded-2xl border border-hairline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(m.storage_path as string)} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute right-1.5 top-1.5 rounded-md bg-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                  <MediaDeleteButton
                    mediaId={m.id as string}
                    storagePath={m.storage_path as string}
                    artistId={id}
                    noun="Photo"
                    className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AssetsShell>
  )
}
