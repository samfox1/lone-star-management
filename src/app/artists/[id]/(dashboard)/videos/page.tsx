import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { dashboardDiff, requireArtist } from '../_data'
import { importDriveFileAction, listDriveFilesAction } from '../actions'
import { VideosBrowser } from './videos-browser'
import { VideoAddButton } from './video-add'
import { SyncDialog } from '../sync-dialog'
import { sourcesForSection } from '../sync-sections'
import { syncSectionAction } from '../sync-section-action'
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
 * New/imported videos land off-site; the per-tile toggle puts one ON the site live,
 * here or in the editor (ADR 0009) — a video must be published once first, since the
 * door serves the published snapshot and gates it on the working row.
 */
export default async function VideosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  // requireArtist folded into the wave (still the RLS ownership gate — a non-owner 404s).
  // diffUnpublished is the only way to know whether there are unpublished video EDITS,
  // now that presence is live and no longer a selection delta. It's the same query
  // behind the nav's pending dot, so the PublishBar and the dot always agree.
  const [artist, rows, counts, diff] = await Promise.all([
    requireArtist(id),
    listContent(supabase, 'video', id),
    entityCounts(supabase, id, daysAgo(30)),
    dashboardDiff(id),
  ])

  return (
    <>
    <VideosBrowser
      artistId={id}
      dirty={diff.video.dirty}
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
          // The library's sort key. listContent hands these over OLDEST first
          // (sort_order, created_at ascending) and the browser flips them; the ordering
          // itself is left alone because lib/site.ts reads the same one for the public site.
          created_at: (row.created_at as string | null) ?? '',
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
          {/* The same dialog Music and Merch use (Sam, 2026-09-09) — one Sync gesture
              across the dashboard rather than three shapes of it. */}
          <SyncDialog
            artistId={id}
            section="videos"
            sources={sourcesForSection('videos', artist, false)}
            run={syncSectionAction}
            integrationsHref={`/artists/${id}/tools/integrations`}
          />
          <VideoAddButton artistId={id} />
        </>
      }
    />
    </>
  )
}
