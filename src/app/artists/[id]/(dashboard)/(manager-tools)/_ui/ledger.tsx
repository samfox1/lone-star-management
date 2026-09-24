import { useId, type ComponentProps, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { NoteField, RowTitle } from './inline-text'

/**
 * LAYOUT A, "LEDGER" (Sam, 2026-09-23; prototypes/brand_variants_20260923.html). No cards:
 * a mono section word in a 150px left column, rows on the right split by hairlines, label
 * left and control right. Below 900px the columns stack, as in the prototype.
 *
 * No directive: a server page can render an empty LedgerSection (the stub tabs do), and a
 * client component renders LedgerRows with their save callbacks.
 */
export function LedgerSection({ label, children }: { label: string; children?: ReactNode }) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      // `last-of-type`, not `last`: the layout's Publish bar follows the page, so a section
      // is never the last CHILD and `last:` left a stray rule under the final one.
      // `group/ledger-list`: its rows reserve the trash column when the list can hold one.
      className="group/ledger-list grid grid-cols-1 gap-x-8 border-b border-hairline pb-7 pt-2 last-of-type:border-b-0 min-[900px]:grid-cols-[150px_minmax(0,1fr)]"
    >
      <h2 id={id} className="pt-4 font-space text-[11px] uppercase tracking-[0.1em] text-ink-faint min-[900px]:pt-[22px]">
        {label}
      </h2>
      <div className="flex min-w-0 flex-col">{children}</div>
    </section>
  )
}

/** The note an added row carries — NoteField's props, minus what the row decides. */
export type LedgerNote = Pick<ComponentProps<typeof NoteField>, 'value' | 'onSave' | 'primaryRef' | 'autoFocus'>

type LedgerRowBase = {
  /** The row's title. Fixed text, unless `onRename` makes it a RowTitle. */
  title: string
  /** Makes the title renamable (every added row, every colour). */
  onRename?: ComponentProps<typeof RowTitle>['onRename']
  /** A line under the guide / note — a font's weights, say. */
  meta?: ReactNode
  /** The right-hand controls: a tile, a swatch, RowIcons. NOT the trash — see `remove`. */
  children?: ReactNode
  /** An added row's trash (`<RowIcon icon="trash" … />`). It goes in the row's END SLOT, a
   *  fixed-width column every row in the list reserves, so the controls line up. */
  remove?: ReactNode
}

/**
 * Built-in rows (Primary logo, Tab icon, Browser bar…) pass a `guide`: fixed grey text,
 * an approved exception to the no-instruction-copy rule, Brand only. Added rows pass a
 * `note` instead. Never both.
 */
export type LedgerRowProps = LedgerRowBase & ({ guide?: string; note?: never } | { guide?: never; note?: LedgerNote })

/**
 * THE TRASH COLUMN (visual check, 2026-09-23). Added rows end in a trash, built-in rows do
 * not, and with the controls pushed right an added row's tile sat ~42px left of the
 * built-in rows above it. So the trash goes in an END SLOT as wide as a faint RowIcon
 * (p-1.5 around a 20px glyph = 32px, `w-8`), and a row without one renders the same slot
 * EMPTY. The empty slot is hidden on its own and opened by the list (LedgerSection is
 * `group/ledger-list`) when any row in it has a trash or it has an Add row (AddRow's
 * `data-ledger-add`) that could make one. A list of built-ins only reserves nothing.
 */
const END_SLOT = 'w-8 flex-none items-center justify-center'

export function LedgerRow({ title, onRename, guide, note, meta, children, remove }: LedgerRowProps) {
  return (
    <div
      data-ledger-row=""
      // `group/ledger`: a faint RowIcon (row-icon.tsx) lights up while its row is hovered.
      className="group/ledger grid grid-cols-1 items-center gap-6 border-b border-hairline-soft py-4 last:border-b-0 min-[900px]:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)]"
    >
      <div className="min-w-0">
        {onRename ? (
          <RowTitle value={title} onRename={onRename} />
        ) : (
          <div className="whitespace-nowrap text-[15px] font-medium text-ink">{title}</div>
        )}
        {guide ? <div className="mt-0.5 max-w-[40ch] text-[13px] text-ink-muted">{guide}</div> : null}
        {note ? <NoteField {...note} /> : null}
        {meta ? <div className="mt-1 font-space text-[11px] text-ink-faint">{meta}</div> : null}
      </div>
      <div className="flex min-w-0 items-center justify-start gap-2.5 min-[900px]:justify-end">
        {children}
        {remove ? (
          <div data-ledger-end="remove" className={cx(END_SLOT, 'flex')}>
            {remove}
          </div>
        ) : (
          <div
            data-ledger-end="empty"
            aria-hidden="true"
            className={cx(END_SLOT, 'hidden group-has-[[data-ledger-end=remove]]/ledger-list:flex group-has-[[data-ledger-add]]/ledger-list:flex')}
          />
        )}
      </div>
    </div>
  )
}
