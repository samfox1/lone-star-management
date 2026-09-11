import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { dashboardDiff, getShopifyDomain, requireArtist } from '../_data'
import { SyncDialog } from '../sync-dialog'
import { sourcesForSection } from '../sync-sections'
import { syncSectionAction } from '../sync-section-action'
import { MerchBrowser } from './merch-browser'
import { MerchAddButton } from './merch-add'

/**
 * Merch: a cover grid with the Music-page toolbar (filter · sort · connect · + Add ·
 * publish). "+ Add" opens the two-pane modal (Auto scrapes a pasted product link).
 * New/imported products land off-site until selected + published.
 */
export default async function MerchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  // Gate, Shopify domain, product rows, and 30-day counts are all independent — one
  // parallel wave instead of gate → domain → content serially. requireArtist stays
  // cache()d, so the layout's parallel call to it is deduped.
  const [, shopifyDomain, rows, counts, diff, latest] = await Promise.all([
    requireArtist(id),
    getShopifyDomain(id),
    listContent(supabase, 'merch', id),
    entityCounts(supabase, id, daysAgo(30)),
    dashboardDiff(id),
    supabase.rpc('latest_revisions', { p_artist_id: id }),
  ])
  // What the PUBLISHED copy says about presence (PRESENCE_PLAN, revised 2026-09-11), so a
  // row's check can show "checked, publish to put on site" while the draft and the
  // snapshot disagree. Never published = not on the site, whatever the working row says.
  const publishedOnSite = new Map<string, boolean>()
  for (const r of (latest.data ?? []) as { entity_type: string; entity_id: string | null; data: Record<string, unknown> }[]) {
    if (r.entity_type === 'merch' && r.entity_id && r.data._deleted !== true) publishedOnSite.set(r.entity_id, (r.data.on_site as boolean | null) ?? true)
  }


  return (
    <MerchBrowser
      artistId={id}
      dirty={diff.merch.dirty}
      items={rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        price: (row.price as string | number | null) ?? null,
        url: (row.url as string | null) ?? null,
        image_url: (row.image_url as string | null) ?? null,
        source: (row.source as string | null) ?? null,
        on_site: (row.on_site as boolean | null) ?? true,
        published_on_site: publishedOnSite.get(row.id as string) ?? false,
        stat: metricValue(counts, 'merch', [row.id as string]),
      }))}
      trailing={
        <>
          {/* A DIALOG, not a trip to the integrations page (Sam, 2026-09-09). Sync used
              to be a link: a manager who wanted their products refreshed was sent to a
              settings screen to find a button. The dialog still offers that route, as a
              link, out of the way of the press everyone came for. */}
          <SyncDialog
            artistId={id}
            section="merch"
            sources={sourcesForSection('merch', {}, Boolean(shopifyDomain))}
            run={syncSectionAction}
            integrationsHref={`/artists/${id}/tools/integrations`}
          />
          <MerchAddButton artistId={id} />
        </>
      }
    />
  )
}
