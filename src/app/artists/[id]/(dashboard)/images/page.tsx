import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../_data'
import { importDriveFileAction, listDriveFilesAction } from '../actions'
import { AssetsShell } from '../assets-rail'
import { DriveBrowser } from '../drive-browser'
import { DriveImportButton } from '../drive-import-button'
import { PhotosBrowser, type PhotoItem } from './photos-browser'
import { PhotoAddButton } from './photo-add'

/**
 * Photos — the image half of the Assets library: the Videos page's layout
 * without a Refresh (nothing to pull), the Videos/Shorts split, or publish
 * machinery (photos are stored assets the manager places onto the site from
 * its own surfaces).
 */
export default async function ImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const { data: rows } = await supabase
    .from('media')
    .select('id, storage_path, created_at')
    .eq('artist_id', id)
    .eq('purpose', 'gallery_image')
    .order('created_at', { ascending: false })

  const photos: PhotoItem[] = (rows ?? []).map((m) => ({
    id: m.id as string,
    storage_path: m.storage_path as string,
    created_at: (m.created_at as string | null) ?? '',
  }))

  return (
    <AssetsShell artistId={id} active="photos">
      <PhotosBrowser
        photos={photos}
        artistId={id}
        trailing={
          <>
            {artist.drive_folder_id && (
              <DriveImportButton title="Import photos from Drive">
                <DriveBrowser
                  kind="image"
                  listAction={listDriveFilesAction.bind(null, id, 'image')}
                  importAction={importDriveFileAction.bind(null, id, 'image')}
                />
              </DriveImportButton>
            )}
            <PhotoAddButton artistId={id} />
          </>
        }
      />
    </AssetsShell>
  )
}
