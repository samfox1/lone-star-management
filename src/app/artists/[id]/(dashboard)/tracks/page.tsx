import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { ContentSection } from '../content-sections'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { saveSpotifyIdAction, syncSpotifyAction } from '../actions'

export default async function TracksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'track', id)

  return (
    <SectionShell title="Tracks" publishType="track" artistId={id}>
      <SyncPanel
        title="Spotify"
        idName="spotify_artist_id"
        idValue={artist?.spotify_artist_id ?? ''}
        placeholder="Spotify artist ID"
        hasId={!!artist?.spotify_artist_id}
        pullLabel="Pull from Spotify"
        saveAction={saveSpotifyIdAction.bind(null, id)}
        pullAction={syncSpotifyAction.bind(null, id)}
      />
      <ContentSection type="track" artistId={id} rows={rows} />
    </SectionShell>
  )
}
