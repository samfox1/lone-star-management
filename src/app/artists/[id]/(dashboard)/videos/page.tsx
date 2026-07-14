import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { requireArtist } from '../_data'
import { importDriveFileAction, listDriveFilesAction, refreshYouTubeAction } from '../actions'
import { AssetsShell } from '../assets-rail'
import { VideosBrowser } from './videos-browser'
import { VideoAddButton } from './video-add'
import { RefreshButton } from './refresh-button'
import { DriveBrowser } from '../drive-browser'
import { DriveImportButton } from '../drive-import-button'

/** YouTube poster from a normalized embed URL; null for other providers. */
function youtubePoster(url: string, provider: string): string | null {
  if (provider !== 'youtube') return null
  const m = url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * Videos: a 16:9 thumbnail grid with the Music-page toolbar (filter · sort · import ·
 * + Add · publish). "+ Add" opens the two-pane modal (Auto detects a pasted link).
 * New videos land off-site until selected + published.
 */
export default async function VideosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [rows, counts] = await Promise.all([
    listContent(supabase, 'video', id),
    entityCounts(supabase, id, daysAgo(30)),
  ])

  return (
    <AssetsShell artistId={id} active="videos">
    <VideosBrowser
      artistId={id}
      videos={rows.map((row) => {
        const provider = String(row.provider ?? '')
        return {
          id: row.id as string,
          title: row.title as string,
          provider: provider || null,
          poster: youtubePoster(String(row.embed_url ?? ''), provider),
          embed_url: (row.embed_url as string | null) ?? null,
          storage_path: (row.storage_path as string | null) ?? null,
          source: (row.source as string | null) ?? null,
          is_short: (row.is_short as boolean | null) ?? false,
          on_site: (row.on_site as boolean | null) ?? true,
          youtube_views: (row.youtube_views as number | null) ?? null,
          stat: metricValue(counts, 'video', [row.id as string]),
        }
      })}
      trailing={
        <>
          {artist.drive_folder_id && (
            <DriveImportButton title="Import videos from Drive">
              <DriveBrowser
                kind="video"
                listAction={listDriveFilesAction.bind(null, id, 'video')}
                importAction={importDriveFileAction.bind(null, id, 'video')}
              />
            </DriveImportButton>
          )}
          <RefreshButton action={refreshYouTubeAction.bind(null, id)} />
          <VideoAddButton artistId={id} />
        </>
      }
    />
    </AssetsShell>
  )
}
