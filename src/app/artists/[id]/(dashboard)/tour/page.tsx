import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { dashboardDiff, requireArtist } from '../_data'
import { isPastShow, todayIso } from '@/lib/tour'
import { SyncDialog } from '../sync-dialog'
import { sourcesForSection } from '../sync-sections'
import { syncSectionAction } from '../sync-section-action'
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
  const today = todayIso()
  const supabase = await createClient()
  // requireArtist folded into the wave (still the RLS ownership gate — a non-owner 404s).
  // diffUnpublished is the only way to know whether there are unpublished date EDITS,
  // now that presence is live and no longer a selection delta. It's the same query
  // behind the nav's pending dot, so the PublishBar and the dot always agree.
  const [artist, rows, counts, diff, latest] = await Promise.all([
    requireArtist(id),
    listContent(supabase, 'tour_date', id),
    entityCounts(supabase, id, daysAgo(30)),
    dashboardDiff(id),
    supabase.rpc('latest_revisions', { p_artist_id: id }),
  ])
  // What the PUBLISHED copy says about presence (PRESENCE_PLAN, revised 2026-09-11), so a
  // row's check can show "checked, publish to put on site" while the draft and the
  // snapshot disagree. Never published = not on the site, whatever the working row says.
  const publishedOnSite = new Map<string, boolean>()
  for (const r of (latest.data ?? []) as { entity_type: string; entity_id: string | null; data: Record<string, unknown> }[]) {
    if (r.entity_type === 'tour_date' && r.entity_id && r.data._deleted !== true) publishedOnSite.set(r.entity_id, (r.data.on_site as boolean | null) ?? true)
  }


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
        // By date, with the flag as the override — computed ONCE here, on the server, so the
        // row cannot disagree with itself between server and client (lib/tour).
        past: isPastShow({ date: (row.date as string | null) ?? null, is_past: (row.is_past as boolean | null) ?? false }, today),
        support: (row.support as string[] | null) ?? [],
        support_urls: (row.support_urls as Record<string, string> | null) ?? {},
        ticket_url: (row.ticket_url as string | null) ?? null,
        source: (row.source as string | null) ?? null,
        on_site: (row.on_site as boolean | null) ?? true,
        published_on_site: publishedOnSite.get(row.id as string) ?? false,
        stat: metricValue(counts, 'tour_date', [row.id as string]),
      }))}
      trailing={
        <>
          {/* A DIALOG, like Music, Videos and Merch (Sam, 2026-09-09). This was the same
              redirect-to-integrations link Merch had: a manager who wanted their dates
              refreshed was sent to a settings page to find a button. */}
          <SyncDialog
            artistId={id}
            section="tour"
            sources={sourcesForSection('tour', artist, false)}
            run={syncSectionAction}
            integrationsHref={`/artists/${id}/tools/integrations`}
          />
          <TourAddButton artistId={id} />
        </>
      }
    />
  )
}
