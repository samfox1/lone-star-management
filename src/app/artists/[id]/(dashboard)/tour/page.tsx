import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { dashboardDiff, requireArtist } from '../_data'
import { ToolbarIconLink } from '../toolbar'
import { TourBrowser } from './tour-browser'
import { TourAddButton } from './tour-add'

/**
 * Tour dates: a centered, spacious date list with the Music-page toolbar (filter ·
 * sort · sync · + Add · publish). "+ Add" opens the two-pane modal (manual). Sync
 * from Bandsintown / Ticketmaster lives in Integrations. New/imported dates land
 * off-site; the per-row toggle puts one ON the site live, here or in the editor
 * (ADR 0009) — a date must be published once first, since the door serves the
 * published snapshot and gates it on the working row. (Map is a later opt-in view.)
 */
export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  // diffUnpublished is the only way to know whether there are unpublished date EDITS,
  // now that presence is live and no longer a selection delta. It's the same query
  // behind the nav's pending dot, so the PublishBar and the dot always agree.
  const [rows, counts, diff] = await Promise.all([
    listContent(supabase, 'tour_date', id),
    entityCounts(supabase, id, daysAgo(30)),
    dashboardDiff(id),
  ])

  return (
    <TourBrowser
      artistId={id}
      dirty={diff.tour_date.dirty}
      tours={rows.map((row) => ({
        id: row.id as string,
        date: (row.date as string | null) ?? null,
        venue: (row.venue as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        state: (row.state as string | null) ?? null,
        country: (row.country as string | null) ?? null,
        is_past: (row.is_past as boolean | null) ?? false,
        support: (row.support as string[] | null) ?? [],
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
