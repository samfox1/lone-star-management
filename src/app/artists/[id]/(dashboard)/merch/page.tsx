import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionShell } from '../section-shell'
import { SectionMeta, ConnectLink } from '../section-meta'
import { CardGrid } from '../card-grid'
import { getShopifyDomain, requireArtist } from '../_data'
import { addContentAction } from '../actions'
import { MerchCard } from './merch-card'

export default async function MerchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const shopifyDomain = await getShopifyDomain(id)
  const rows = await listContent(supabase, 'merch', id)

  return (
    <SectionShell title="Merch" publishType="merch" artistId={id}>
      <SectionMeta count={rows.length} singular="product" plural="products">
        {shopifyDomain ? (
          <span className="inline-flex items-center gap-1.5 font-space text-[11px] text-ink-muted">
            <span className="h-[7px] w-[7px] rounded-full bg-accent" /> synced from Shopify
          </span>
        ) : (
          <ConnectLink href={`/artists/${id}/tools/integrations`}>Connect Shopify →</ConnectLink>
        )}
      </SectionMeta>

      <form action={addContentAction.bind(null, 'merch', id)} className="flex flex-wrap items-center gap-2">
        <input name="title" placeholder="Item name" required className={`${inputClass} w-44`} />
        <input name="price" type="number" step="any" placeholder="Price" className={`${inputClass} w-24`} />
        <input name="url" type="url" placeholder="Buy URL" className={`${inputClass} w-44`} />
        <input name="image_url" type="url" placeholder="Image URL" className={`${inputClass} flex-1`} />
        <button type="submit" className={buttonClass('solid')}>
          Add
        </button>
      </form>

      <CardGrid size="md" count={rows.length} empty="No products yet.">
        {rows.map((row) => (
          <MerchCard
            key={row.id as string}
            artistId={id}
            item={{
              id: row.id as string,
              title: row.title as string,
              price: (row.price as string | number | null) ?? null,
              url: (row.url as string | null) ?? null,
              image_url: (row.image_url as string | null) ?? null,
              source: (row.source as string | null) ?? null,
            }}
          />
        ))}
      </CardGrid>
    </SectionShell>
  )
}
