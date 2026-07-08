'use client'

import { Icon } from '@/components/ui/icons'
import { CreateModal } from '../create-modal'
import { addContentAction, scrapeMerchUrlAction } from '../actions'

function priceLabel(p?: string): string | null {
  if (!p) return null
  const n = Number(p)
  return Number.isFinite(n) ? `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}` : null
}

function MerchPreview({ image, title, price }: { image?: string; title?: string; price?: string }) {
  const pl = priceLabel(price)
  return (
    <div className="w-32">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-surface text-ink-faint">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="merch" size={26} />
        )}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{title || 'New product'}</div>
      {pl && <div className="mt-0.5 font-space text-[13px] font-bold">{pl}</div>}
    </div>
  )
}

/** The Merch "Add" button: Auto (paste product link → Open-Graph scrape) or Manual. */
export function MerchAddButton({ artistId }: { artistId: string }) {
  return (
    <CreateModal
      kind="Product"
      title="Add product"
      auto={{
        placeholder: 'Paste a product link',
        resolve: async (url) => {
          const r = await scrapeMerchUrlAction(url)
          if (!r.ok) return { error: r.error }
          return { values: { url, title: r.title ?? '', image_url: r.image_url ?? '', price: r.price ?? '' } }
        },
      }}
      fields={[
        { name: 'title', placeholder: 'Item name', required: true },
        { name: 'price', placeholder: 'Price', type: 'number', row: 1, width: 'sm' },
        { name: 'url', placeholder: 'Buy URL', type: 'url', row: 1, width: 'grow' },
        { name: 'image_url', placeholder: 'Image URL', type: 'url' },
      ]}
      preview={(v) => <MerchPreview image={v.image_url} title={v.title} price={v.price} />}
      submit={(fd) => addContentAction('merch', artistId, fd)}
    />
  )
}
