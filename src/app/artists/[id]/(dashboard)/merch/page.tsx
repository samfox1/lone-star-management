import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { getShopifyDomain, requireArtist } from '../_data'
import { ToolbarIconLink } from '../toolbar'
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
  await requireArtist(id)
  const shopifyDomain = await getShopifyDomain(id)
  const [rows, counts] = await Promise.all([
    listContent(supabase, 'merch', id),
    entityCounts(supabase, id, daysAgo(30)),
  ])

  return (
    <MerchBrowser
      artistId={id}
      items={rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        price: (row.price as string | number | null) ?? null,
        url: (row.url as string | null) ?? null,
        image_url: (row.image_url as string | null) ?? null,
        source: (row.source as string | null) ?? null,
        on_site: (row.on_site as boolean | null) ?? true,
        stat: metricValue(counts, 'merch', [row.id as string]),
      }))}
      trailing={
        <>
          <ToolbarIconLink
            href={`/artists/${id}/tools/integrations`}
            title={shopifyDomain ? 'Synced from Shopify' : 'Connect Shopify'}
            icon={shopifyDomain ? 'refresh' : 'download'}
            label={shopifyDomain ? 'Sync' : 'Connect'}
          />
          <MerchAddButton artistId={id} />
        </>
      }
    />
  )
}
