import { cx } from '@/lib/cx'
import { useDragReorder } from '../use-drag-reorder'
import { Icon } from '@/components/ui/icons'
import { type EditorMerch } from '../inspector-types'
import type { SelectTarget } from '@samfox1/site-bridge/protocol'
import { AddLink } from '../inspector-grid'

/* ── Merch tools: a cover grid like Music, one card per product (Sam, 2026-08-18).
 * The card face SELECTS (outlines the product on the site); the pencil opens the
 * full-panel MerchEditor — title / price / link / out-of-stock live there now, not in
 * always-open inline rows. Remove lives in the editor too. Cards DRAG to reorder,
 * the same gesture as the Music cards and tour rows. */
export function MerchTools({
  merch,
  artistId,
  onEdit,
  onReorder,
  focusedKey,
  onFocus,
}: {
  merch: EditorMerch[]
  artistId: string
  /** Open this product full-panel (the grid's Edit button). */
  onEdit: (m: EditorMerch) => void
  /** Drag a card onto another — renumbers merch.sort_order (20260818150000). */
  onReorder?: (fromId: string, toId: string) => void
  /** Two-way selection, the same contract every other item panel carries. */
  focusedKey?: string | null
  onFocus?: (target: SelectTarget) => void
}) {
  const { dragProps, isOver } = useDragReorder((fromId, toId) => onReorder?.(fromId, toId))

  /**
   * ONLY what is on the site (Sam, 2026-09-09, extending the Music panel's rule). The
   * editor is a view of the SITE; the library is the Merch page, which is where the Add
   * link at the bottom already goes.
   *
   * `onSite`, NOT `inStock`. They are different flags and this card already dims by the
   * second one: a sold-out product is still ON the page — fans see it marked sold out —
   * so filtering by stock would hide the one thing the manager most needs to edit.
   */
  const shown = merch.filter((m) => m.onSite)

  return (
    <div className="space-y-2.5 px-5 py-4">
      <div className="grid grid-cols-3 gap-2.5">
        {shown.map((m) => {
          const focused = focusedKey === `item:merch:${m.id}`
          return (
            <div
              key={m.id}
              {...dragProps(m.id)}
              className={cx(
                'relative overflow-hidden rounded-lg border',
                focused ? 'border-accent ring-2 ring-accent' : 'border-hairline',
                isOver(m.id) && 'ring-2 ring-accent',
              )}
            >
              <button
                type="button"
                aria-label={`Select ${m.title || 'product'}`}
                onClick={() => onFocus?.({ kind: 'item', assetType: 'merch', id: m.id })}
                className="block w-full text-left"
              >
                <div className={cx('relative', !m.inStock && 'opacity-55')}>
                  <span className="flex aspect-square w-full items-center justify-center overflow-hidden bg-track text-ink-faint">
                    {m.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="merch" size={22} />
                    )}
                  </span>
                  {!m.inStock && (
                    <span className="absolute left-1 top-1 rounded bg-ink/70 px-1 py-0.5 font-space text-[8px] font-bold uppercase tracking-[0.06em] text-paper">
                      Sold out
                    </span>
                  )}
                </div>
                <div className={cx('px-1.5 py-1', !m.inStock && 'opacity-55')}>
                  <span className="block truncate text-[11px] text-ink">{m.title || 'Untitled'}</span>
                  <span className="block font-space text-[9px] text-ink-faint">
                    {m.price.trim() !== '' ? `$${m.price}` : ' '}
                  </span>
                </div>
              </button>
              {/* The Edit pencil is a SIBLING overlaid on the card (no button-in-button),
                  the same layering as the Music cards' on-site toggle. */}
              <button
                type="button"
                aria-label={`Edit ${m.title || 'product'}`}
                onClick={() => onEdit(m)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-paper text-ink shadow-sm hover:bg-accent hover:text-white"
              >
                <Icon name="edit" size={11} />
              </button>
            </div>
          )
        })}
      </div>

      <AddLink href={`/artists/${artistId}/merch`} label="Add product" />
    </div>
  )
}
