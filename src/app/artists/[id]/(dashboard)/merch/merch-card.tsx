'use client'

import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { GridCard } from '../grid-card'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { EntitySparkline } from '../entity-sparkline'
import { deleteContentAction, updateContentAction } from '../actions'
import { SaveForm } from '../save-form'

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

/**
 * A merch item as a cover-grid tile; opens a modal to edit its fields or delete. A
 * select checkbox + "On site" badge drive the password-gated publish (owned by the
 * parent browser).
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

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'merch', item.id, artistId)}
      deleteLabel="Delete item"
      deleteNoun="Product"
      selected={selected}
      onToggleSelect={onToggleSelect}
      onSite={item.published_on_site ?? item.on_site}
      selectLabel={item.title}
      tile={
        <>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface text-ink-faint">
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="merch" size={30} />
            )}
          </div>
          <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-2">
            {price && <span className="font-space text-[13px] font-bold tracking-[-0.01em]">{price}</span>}
            {badge && (
              <span className="font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">{badge}</span>
            )}
          </div>
          <CardStat value={item.stat ?? 0} label={metricLabel('merch')} />
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl bg-surface text-ink-faint">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name="merch" size={22} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold tracking-[-0.01em]">{item.title}</h3>
          {badge && (
            <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">from {badge}</div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <EntitySparkline artistId={artistId} entityIds={[item.id]} label="Buy clicks · 30d" />
      </div>

      {/* READ-ONLY WHERE SHOPIFY OWNS IT — the rule the editor's merch panel got on
          2026-09-09 (1f95083), applied here by the review a day later. Nothing typed on
          this card can reach Shopify, the next pull overwrites these four columns, and the
          site prices the product LIVE at render: an edited price here would show in the
          dashboard, be reverted on the next sync, and never be what a buyer is charged.
          The values are still SHOWN — a card that hides them reads as broken, not as
          owned elsewhere. */}
      {fromShopify ? (
        <div className="mt-5 space-y-1.5">
          <div className="flex items-baseline gap-3">
            <span className="w-14 flex-none font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">Price</span>
            <span className="text-[13px] text-ink">{price ?? 'Not set'}</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="w-14 flex-none font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">Link</span>
            <span className="min-w-0 truncate text-[13px] text-ink-muted">{item.url ?? 'Not set'}</span>
          </div>
          <p className="pt-1 font-space text-[10px] leading-relaxed text-ink-faint">
            Synced from Shopify. Change the name, price, link or image in Shopify — the site
            reads the price live, so it updates without republishing.
          </p>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-block pt-1 font-space text-xs text-ink-muted hover:underline">
              Open buy page ↗
            </a>
          )}
        </div>
      ) : (
      <SaveForm action={updateContentAction.bind(null, 'merch', item.id, artistId)} className="mt-5 space-y-2">
        <input name="title" defaultValue={item.title} required placeholder="Item name" className={`${inputClass} w-full`} />
        <div className="flex gap-2">
          <input name="price" type="number" step="any" defaultValue={item.price ?? ''} placeholder="Price" className={`${inputClass} w-28`} />
          <input name="url" type="url" defaultValue={item.url ?? ''} placeholder="Buy URL" className={`${inputClass} flex-1`} />
        </div>
        <input name="image_url" type="url" defaultValue={item.image_url ?? ''} placeholder="Image URL" className={`${inputClass} w-full`} />
        <div className="flex items-center gap-2">
          <button type="submit" className={buttonClass('ghost')}>
            Save
          </button>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-space text-xs text-ink-muted hover:underline">
              Open buy page ↗
            </a>
          )}
        </div>
      </SaveForm>
      )}
    </GridCard>
  )
}
