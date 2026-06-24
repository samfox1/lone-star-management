import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { ContentSection } from '../content-sections'
import { ShopifyPanel } from '../shopify-panel'
import { SectionShell } from '../section-shell'
import {
  connectShopifyAction,
  disconnectShopifyAction,
  syncShopifyAction,
} from '../actions'

export default async function MerchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: shopify } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('artist_id', id)
    .eq('provider', 'shopify')
    .maybeSingle()
  const shopifyDomain = (shopify?.metadata as { store_domain?: string } | null)?.store_domain ?? null
  const rows = await listContent(supabase, 'merch', id)

  return (
    <SectionShell title="Merch" publishType="merch" artistId={id}>
      <ShopifyPanel
        storeDomain={shopifyDomain}
        connectAction={connectShopifyAction.bind(null, id)}
        pullAction={syncShopifyAction.bind(null, id)}
        disconnectAction={disconnectShopifyAction.bind(null, id)}
      />
      <ContentSection type="merch" artistId={id} rows={rows} />
    </SectionShell>
  )
}
