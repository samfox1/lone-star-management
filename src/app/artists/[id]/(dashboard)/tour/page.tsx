import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { requireArtist } from '../_data'
import { ToolbarIconLink } from '../toolbar'
import { TourBrowser } from './tour-browser'
import { TourAddButton } from './tour-add'

/**
 * Tour dates: a centered, spacious date list with the Music-page toolbar (filter ·
 * sort · sync · + Add · publish). "+ Add" opens the two-pane modal (manual). Sync
 * from Bandsintown / Ticketmaster lives in Integrations. New/imported dates land
 * off-site until selected + published. (Map is a later opt-in view.)
 */
export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const [rows, counts] = await Promise.all([
    listContent(supabase, 'tour_date', id),
    entityCounts(supabase, id, daysAgo(30)),
  ])

  return (
    <TourBrowser
      artistId={id}
      tours={rows.map((row) => ({
        id: row.id as string,
        date: (row.date as string | null) ?? null,
        venue: (row.venue as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        ticket_url: (row.ticket_url as string | null) ?? null,
        source: (row.source as string | null) ?? null,
        on_site: (row.on_site as boolean | null) ?? true,
        stat: metricValue(counts, 'tour_date', [row.id as string]),
      }))}
      trailing={
        <>
          <ToolbarIconLink
            href={`/artists/${id}/tools/integrations`}
            title="Sync from Bandsintown / Ticketmaster"
            icon="refresh"
            label="Sync"
          />
          <TourAddButton artistId={id} />
        </>
      }
    />
  )
}
