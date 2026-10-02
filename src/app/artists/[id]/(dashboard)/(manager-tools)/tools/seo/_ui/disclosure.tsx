import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { RowIcon, type RowIconProps } from '../../../_ui/row-icon'
import { EYEBROW, MONO_META } from '../../../_ui/styles'

/**
 * THE AI TEST'S ROW AND CARD ("Dropdown A · Card", Sam 2026-09-29, prototypes/
 * seo_variants_20260929_r10.html), drawn once for both lists that use it: the test results
 * (test/test-row.tsx) and How crawlers see your site (test/crawl-section.tsx).
 *
 *   a group:  mono caps title · "4 of 5" on the right, then its rows
 *   a row:    a full-width button (mark · name · value · chevron); open, it turns grey
 *   the card: a white box under the open row, LABEL | value rows (label above on a phone)
 *
 * The row's FACE is the caller's (a test has tags, a crawl row doesn't); the box around it,
 * its divider, the value, the chevron and the card are here. No directive: only client
 * components render these.
 */

/** `data-*` hooks a caller puts on an element (tests and keyboard nav find rows by them). */
type DataAttrs = { [key: `data-${string}`]: string | undefined }

/** The thin line between two closed rows (a shadow, so it takes no room). */
export const DIVIDER = 'shadow-[0_-1px_0_var(--color-hairline-soft)]'

/** A group: its mono caps title and count, then its rows (pulled out 12px, so a row's grey
 *  reaches past the text column). */
export function DisclosureGroup({ title, count, countData, children }: { title: string; count: string; countData?: DataAttrs; children: ReactNode }) {
  return (
    <>
      <div className="mb-0.5 mt-[26px] flex items-baseline justify-between gap-4">
        <h3 className={cx(EYEBROW, 'font-normal')}>{title}</h3>
        <span {...countData} className={MONO_META}>
          {count}
        </span>
      </div>
      <div className="-mx-3">{children}</div>
    </>
  )
}

/** One row that opens: the box, its button (`face` inside), and `children` (the card) while open. */
export function DisclosureItem({
  buttonId,
  cardId,
  open,
  divider,
  onToggle,
  itemData,
  rowData,
  rowClassName,
  face,
  children,
}: {
  buttonId: string
  cardId: string
  open: boolean
  /** The line above a closed row (none against an open one: it is its own grey block). */
  divider: boolean
  onToggle: () => void
  itemData: DataAttrs
  rowData: DataAttrs
  /** Extra on the button, e.g. `scroll-mt-28` where a deep link scrolls a row into view. */
  rowClassName?: string
  face: ReactNode
  children?: ReactNode
}) {
  return (
    <div {...itemData} className={cx('rounded-xl', open ? 'my-1 bg-surface' : divider && DIVIDER)}>
      <button
        id={buttonId}
        type="button"
        {...rowData}
        aria-expanded={open}
        aria-controls={cardId}
        onClick={onToggle}
        className={cx('group/trow flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-surface', rowClassName, FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        {face}
      </button>
      {open ? children : null}
    </div>
  )
}

/** A row's short value on the right: faint, red when it needs the manager. Truncates. */
export function RowValue({ bad, data, children }: { bad: boolean; data?: DataAttrs; children: ReactNode }) {
  return (
    <span {...data} className={cx('min-w-0 max-w-full truncate whitespace-nowrap font-space text-[12px] sm:max-w-[200px]', bad ? 'text-accent-red' : 'text-ink-faint')}>
      {children}
    </span>
  )
}

/** The chevron at a row's end: faint, ink on hover, turned down while open. */
export function RowChevron({ open }: { open: boolean }) {
  return (
    <Icon
      name="chevronRight"
      size={14}
      aria-hidden="true"
      className={cx('flex-none transition-transform duration-150', open ? 'rotate-90 text-ink' : 'text-ink-faint group-hover/trow:text-ink')}
    />
  )
}

/** The white card under an open row: LABEL | value rows, beside each other from 700px. */
export function DisclosureCard({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return (
    <div id={id} role="region" aria-labelledby={labelledBy} className="px-3 pb-3 pt-0.5 sm:pb-[22px] sm:pl-[46px] sm:pr-3.5">
      <div className="grid grid-cols-1 gap-y-1.5 rounded-xl border border-hairline bg-paper px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] min-[700px]:grid-cols-[100px_minmax(0,1fr)] min-[700px]:gap-x-5 min-[700px]:gap-y-5">
        {children}
      </div>
    </div>
  )
}

/** One LABEL | value row of the card (RESULT, WHAT WE SAW, THE FILE…). Above its value on a
 *  phone. `name` is the value's `data-card` hook; `className` lays the value out. */
export function CardField({ label, name, className, children }: { label: string; name: string; className?: string; children: ReactNode }) {
  return (
    <>
      <span className="pt-3 font-space text-[10px] uppercase leading-[1.4] tracking-[0.1em] text-ink-faint first:pt-0 min-[700px]:pt-1 min-[700px]:first:pt-1">{label}</span>
      <div data-card={name} className={cx('min-w-0', className)}>
        {children}
      </div>
    </>
  )
}

/** The bare glyph that ends a card's sentence: pencil to a setting, ↗ to another site, wrench
 *  for a fix (RowIcon `bare`, 17px, its name on hover opening to the right). */
export function SentenceAction(props: Omit<RowIconProps, 'variant' | 'glyphSize' | 'labelAlign' | 'className'>) {
  return <RowIcon {...props} variant="bare" glyphSize={17} labelAlign="start" className="ml-2.5 align-[-3px]" />
}
