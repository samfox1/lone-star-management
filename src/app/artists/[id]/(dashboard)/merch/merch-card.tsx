'use client'

import { Icon } from '@/components/ui/icons'
import { safeHref } from '@/lib/url'
import { GridCard } from '../grid-card'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { KvField, MetaDot, ModalHeader } from '../modal-kit'
import { deleteContentAction, updateContentAction } from '../actions'
import { toast } from '../toast'

export type MerchItem = {
  id: string
  title: string
  price: string | number | null
  url: string | null
  image_url: string | null
  source: string | null
  /** Whether the item is currently live on the public site. */
  on_site: boolean
  /** What the PUBLISHED copy says (draft presence, 2026-09-11). */
  published_on_site?: boolean
  /** Manager-owned even for a Shopify product — the sync never writes it (lib/merch/sync). */
  in_stock?: boolean
  /** 30-day buy-clicks (from analytics_by_entity). */
  stat?: number
}

/** Format a price as a bold mono figure ("$24"), tolerant of string/number/null. */
function priceLabel(price: string | number | null): string | null {
  if (price === null || price === '') return null
  const n = typeof price === 'number' ? price : Number(price)
  if (Number.isNaN(n)) return String(price)
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

const STOCK_OPTIONS = [
  { value: 'true', label: 'In stock' },
  { value: 'false', label: 'Sold out' },
]

/**
 * A merch item as a cover-grid tile; opens its modal — built on modal-kit (prototype G,
 * Sam, 2026-09-11): image · title · price / source / stock meta, then rows that save
 * their own field (Title, Price, Link, Image, Stock), Delete / Done in the footer.
 *
 * READ-ONLY WHERE SHOPIFY OWNS IT — the rule the editor's merch panel got on 2026-09-09
 * (1f95083): nothing typed here can reach Shopify, the next pull overwrites title, price,
 * link and image, and the site prices the product LIVE at render — an edited price would
 * show in the dashboard, be reverted on the next sync, and never be what a buyer is
 * charged. Those rows are still SHOWN (a card that hides them reads as broken, not as
 * owned elsewhere); a Source row says where they are edited. Stock stays the manager's.
 */
export function MerchCard({
  item,
  artistId,
  selected,
  onToggleSelect,
}: {
  item: MerchItem
  artistId: string
  selected: boolean
  onToggleSelect: () => void
}) {
  const price = priceLabel(item.price)
  const badge = item.source && item.source !== 'manual' ? item.source : null
  // `source`, not a shopify_product_id: it is what this card is handed, and the sync
  // sets both together (lib/merch/sync.ts `source: 'shopify'`).
  const fromShopify = item.source === 'shopify'
  const inStock = item.in_stock !== false
  const buyHref = safeHref(item.url ?? '')

  const fail = (message: string) => toast(message, 'error')
  /** One row → one field. Absent keys are skipped server-side (extractUpdate). */
  const saveField = (field: string) => async (value: string) => {
    if (field === 'title' && !value) return { error: 'Give the item a name.' }
    const fd = new FormData()
    fd.set(field, value)
    return updateContentAction('merch', item.id, artistId, fd)
  }

  const image = (size: 'tile' | 'square') =>
    item.image_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.image_url} alt="" className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface text-ink-faint">
        <Icon name="merch" size={size === 'tile' ? 30 : 22} />
      </div>
    )

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'merch', item.id, artistId)}
      deleteLabel="Delete"
      deleteNoun="Product"
      selected={selected}
      onToggleSelect={onToggleSelect}
      onSite={item.published_on_site ?? item.on_site}
      selectLabel={item.title}
      label={item.title}
      analyticsHref={`/artists/${artistId}`}
      tile={
        <>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface text-ink-faint">{image('tile')}</div>
          <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-2">
            {price && <span className="font-space text-[13px] font-bold tracking-[-0.01em]">{price}</span>}
            {badge && <span className="font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">{badge}</span>}
          </div>
          <CardStat value={item.stat ?? 0} label={metricLabel('merch')} />
        </>
      }
    >
      <ModalHeader
        square={image('square')}
        title={item.title}
        meta={
          <>
            {price ? <b className="text-[14px] text-ink">{price}</b> : null}
            {price && badge ? <MetaDot /> : null}
            {badge ? <span className="capitalize">{badge}</span> : null}
            {price || badge ? <MetaDot /> : null}
            <span>{inStock ? 'In stock' : 'Sold out'}</span>
          </>
        }
      />
      <div className="mt-5">
        <KvField label="Title" value={item.title} readOnly={fromShopify} onSave={saveField('title')} onError={fail} />
        <KvField label="Price" value={item.price === null ? '' : String(item.price)} mono readOnly={fromShopify} onSave={saveField('price')} onError={fail} />
        <KvField
          label="Link"
          value={item.url ?? ''}
          type="url"
          mono
          readOnly={fromShopify}
          onSave={saveField('url')}
          onError={fail}
          trailing={
            buyHref ? (
              <a
                href={buyHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open buy page in a new tab"
                title="Open buy page"
                className="flex-none text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="external" size={14} />
              </a>
            ) : null
          }
        />
        <KvField label="Image" value={item.image_url ?? ''} type="url" mono readOnly={fromShopify} onSave={saveField('image_url')} onError={fail} />
        {/* Stock is the manager's call on every product; the sync never touches it. */}
        <KvField label="Stock" value={String(inStock)} options={STOCK_OPTIONS} required onSave={saveField('in_stock')} onError={fail} />
        {fromShopify && (
          <KvField label="Source" value="Shopify" readOnly onSave={async () => undefined} trailing={<span className="flex-none font-space text-[11px] text-ink-faint">name, price, link and image are edited in Shopify</span>} />
        )}
      </div>
    </GridCard>
  )
}
