import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { ContentSection } from '../content-sections'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { saveBandsintownNameAction, syncBandsintownAction } from '../actions'

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'tour_date', id)

  return (
    <SectionShell title="Tour dates" publishType="tour_date" artistId={id}>
      <SyncPanel
        title="Bandsintown"
        idName="bandsintown_name"
        idValue={artist?.bandsintown_name ?? ''}
        placeholder="Bandsintown artist name"
        hasId={!!artist?.bandsintown_name}
        pullLabel="Pull tour dates"
        saveAction={saveBandsintownNameAction.bind(null, id)}
        pullAction={syncBandsintownAction.bind(null, id)}
      />
      <ContentSection type="tour_date" artistId={id} rows={rows} />
    </SectionShell>
  )
}
