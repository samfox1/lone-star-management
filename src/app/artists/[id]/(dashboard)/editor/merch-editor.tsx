'use client'

import { useState } from 'react'
import { type EditorMerch } from './inspector-types'
import { Icon } from '@/components/ui/icons'
import { FIELD, FieldRow, SaveLine } from './inspector-shared'
import { useDebouncedFieldSave } from './use-debounced-field-save'
import { EditorPanel } from './editor-panel'
import { updateContentAction } from '../actions'
import { useRouter } from 'next/navigation'

/**
 * ONE merch item, opened full-panel from the grid's Edit button (Sam, 2026-08-18: "The
 * merch should be in grids like the music page then they should have an edit button then
 * when you edit you can change the title, the price, the link, and maybe … a 'out of
 * stock' toggle").
 *
 * Same shape as TourDateEditor: details debounce-save through the generic merch CRUD,
 * `router.refresh()` re-fetches the draft, and the new draft identity re-sends
 * init-data to the frame — that is what updates the preview.
 */
export function MerchEditor({
  item,
  artistId,
  onBack,
  onRemove,
}: {
  item: EditorMerch
  artistId: string
  onBack: () => void
  /** Take the product off for good — same remove the old rows offered. */
  onRemove: () => void
}) {
  const router = useRouter()
  const [details, setDetails] = useState({
    title: item.title,
    price: item.price,
    url: item.url,
  })
  const [inStock, setInStock] = useState(item.inStock)

  // Title required; price blank-or-number — the same rules the old inline rows enforced
  // (a bad value is dropped, not sent, so the server never sees it).
  const invalid = (field: string, value: string) =>
    (field === 'title' && value.trim() === '') ||
    (field === 'price' && value.trim() !== '' && Number.isNaN(Number(value)))

  const { status, save, runNow } = useDebouncedFieldSave<string>({
    persist: (field, value) => {
      const fd = new FormData()
      fd.set(field, value)
      return updateContentAction('merch', item.id, artistId, fd).then((res) => {
        if (!res?.error) router.refresh()
        return res
      })
    },
    normalize: (v) => v,
  })

  /**
   * SHOPIFY OWNS THE SYNCED FIELDS (Sam, 2026-09-09). The gate is here, in the writer,
   * not only on the markup: a control added later cannot write one of these by being a
   * different kind of element.
   */
  function edit(field: 'title' | 'price' | 'url', value: string) {
    if (item.fromShopify) return
    setDetails((d) => ({ ...d, [field]: value }))
    if (!invalid(field, value)) save(field, value)
  }

  /** The stock flag is a discrete press, not a debounce — flipped and written at once. */
  function toggleStock() {
    const next = !inStock
    setInStock(next)
    runNow('in_stock', async () => {
      const fd = new FormData()
      fd.set('in_stock', String(next))
      const res = await updateContentAction('merch', item.id, artistId, fd)
      if (res?.error) setInStock(!next)
      else router.refresh()
      return res
    })
  }

  return (
    <EditorPanel label={item.title || 'Product'} onBack={onBack}>
      <div className="px-5 pt-4">
        {item.image_url && (
          <div className="mb-3 h-24 w-24 overflow-hidden rounded-lg border border-hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.image_url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        {/* A SHOPIFY product's name, price and link are read-only here — shown, because a
            manager still has to see what the product is, but not editable, because
            nothing typed here can reach Shopify (the storefront token is read-only) and
            two things would undo it anyway: the next sync overwrites these columns, and
            the site prices the product LIVE at render. An editable price is the sharp
            one — with the live lane down it would render, and Shopify would still charge
            its own. (Sam, 2026-09-09.) */}
        {item.fromShopify ? (
          <>
            <FieldRow label="Name">
              <span className="block truncate py-1.5 text-[13px] text-ink">{item.title || 'Untitled'}</span>
            </FieldRow>
            <FieldRow label="Price">
              <span className="block py-1.5 text-[13px] text-ink">
                {item.price.trim() === '' ? 'Not set' : `$${item.price}`}
              </span>
            </FieldRow>
            <FieldRow label="Link">
              <span className="block truncate py-1.5 text-[13px] text-ink-muted">{item.url || 'Not set'}</span>
            </FieldRow>
            {/* WHY, and where to go instead — a control that refuses without saying so
                reads as broken. */}
            <p className="pt-1 font-space text-[10px] leading-relaxed text-ink-faint">
              Synced from Shopify. Change the name, price or link in Shopify — the site
              reads the price live, so it updates without republishing.
            </p>
          </>
        ) : (
          <>
            <FieldRow label="Name">
              <input
                aria-label="Product name"
                aria-invalid={invalid('title', details.title) || undefined}
                value={details.title}
                onChange={(e) => edit('title', e.target.value)}
                className={FIELD}
              />
            </FieldRow>
            <FieldRow label="Price">
              <input
                aria-label="Price"
                aria-invalid={invalid('price', details.price) || undefined}
                value={details.price}
                onChange={(e) => edit('price', e.target.value)}
                inputMode="decimal"
                placeholder="28"
                className={FIELD}
              />
            </FieldRow>
            <FieldRow label="Link">
              <input
                aria-label="Product link"
                type="url"
                value={details.url}
                onChange={(e) => edit('url', e.target.value)}
                placeholder="https://…"
                className={FIELD}
              />
            </FieldRow>
          </>
        )}

        {/* Stock is presence-independent: a sold-out item STAYS on the site, shown as
            sold out — taking it off entirely is the Merch page's on-site selection. */}
        <div className="flex items-center justify-between pt-3">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            Out of stock
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!inStock}
            aria-label="Out of stock"
            onClick={toggleStock}
            className={
              'relative h-5 w-9 rounded-full transition-colors ' +
              (!inStock ? 'bg-accent' : 'bg-hairline')
            }
          >
            <span
              className={
                'absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-all ' +
                (!inStock ? 'left-[18px]' : 'left-0.5')
              }
            />
          </button>
        </div>

        <div className="pt-5">
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint hover:border-accent-red hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={12} />
            Remove product
          </button>
        </div>
      </div>
      <SaveLine status={status} />
    </EditorPanel>
  )
}
