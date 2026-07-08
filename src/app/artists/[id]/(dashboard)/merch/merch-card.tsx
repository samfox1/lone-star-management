'use client'

import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { GridCard } from '../grid-card'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { EntitySparkline } from '../entity-sparkline'
import { deleteContentAction, updateContentAction } from '../actions'

export type MerchItem = {
  id: string
  title: string
  price: string | number | null
  url: string | null
  image_url: string | null
  source: string | null
  /** Whether the item is currently live on the public site. */
  visible: boolean
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

  return (
    <GridCard
      deleteAction={deleteContentAction.bind(null, 'merch', item.id, artistId)}
      deleteLabel="Delete item"
      deleteNoun="Product"
      selected={selected}
      onToggleSelect={onToggleSelect}
      visible={item.visible}
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

      <form action={updateContentAction.bind(null, 'merch', item.id, artistId)} className="mt-5 space-y-2">
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
      </form>
    </GridCard>
  )
}
