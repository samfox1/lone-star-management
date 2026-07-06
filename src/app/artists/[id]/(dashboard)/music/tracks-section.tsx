import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { requireArtist } from '../_data'
import { addContentAction, publishSectionAction } from '../actions'
import { TracksBrowser, type BrowserTrack } from './tracks-browser'

/**
 * Tracks view for the Music tab. Server fetches the catalog (in sort order); the
 * client TracksBrowser handles the source filter + sort + cover grid. Catalog
 * import lives in the Integrations hub.
 */
export async function TracksSection({ id }: { id: string }) {
  const supabase = await createClient()
  await requireArtist(id)
  const rows = await listContent(supabase, 'track', id)

  const tracks: BrowserTrack[] = rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    cover_url: (row.cover_url as string | null) ?? null,
    stream_url: (row.stream_url as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    audio_path: (row.audio_path as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? '',
  }))

  return (
    <TracksBrowser
      tracks={tracks}
      artistId={id}
      addAction={addContentAction.bind(null, 'track', id)}
      publishAction={publishSectionAction.bind(null, 'track', id)}
    />
  )
}
