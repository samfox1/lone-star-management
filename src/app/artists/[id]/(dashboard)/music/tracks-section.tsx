import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { requireArtist } from '../_data'
import { addContentAction, publishSectionAction } from '../actions'
import { TracksBrowser, type BrowserTrack } from './tracks-browser'
import { type ReleaseOption } from '../tracks/track-card'

/**
 * Tracks view for the Music tab. Server fetches the catalog (in sort order) plus
 * the artist's releases (for the per-track "assign to release" selector); the
 * client TracksBrowser handles the source filter + sort + cover grid.
 */
export async function TracksSection({ id }: { id: string }) {
  const supabase = await createClient()
  await requireArtist(id)
  const [rows, releaseRows] = await Promise.all([
    listContent(supabase, 'track', id),
    listContent(supabase, 'release', id),
  ])

  const tracks: BrowserTrack[] = rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    cover_url: (row.cover_url as string | null) ?? null,
    stream_url: (row.stream_url as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    audio_path: (row.audio_path as string | null) ?? null,
    release_id: (row.release_id as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? '',
  }))

  const releases: ReleaseOption[] = releaseRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
  }))

  return (
    <TracksBrowser
      tracks={tracks}
      artistId={id}
      releases={releases}
      addAction={addContentAction.bind(null, 'track', id)}
      publishAction={publishSectionAction.bind(null, 'track', id)}
    />
  )
}
