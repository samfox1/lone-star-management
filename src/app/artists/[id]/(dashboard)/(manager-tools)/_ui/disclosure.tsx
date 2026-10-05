import type { ReactNode } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { FOCUS_RING } from './focus-ring'
import { EditRow } from './edit-row'
import { HoverLabel, RowIcon, type RowIconProps } from './row-icon'
import { CAPS_LABEL, EDIT_TARGET, EYEBROW, MONO_META } from './styles'

/**
 * THE "A" ROW AND CARD ("Dropdown A · Card", Sam 2026-09-29, prototypes/
 * seo_variants_20260929_r10.html), drawn once for every list that opens: the AI test's results
 * (tools/seo/test/test-row.tsx), How crawlers see your site (test/crawl-section.tsx), since
 * Batch 2 (Sam 2026-10-02, prototypes/batch2_compare_20261002.html §1, "A") the Profiles tab's
 * three lists (tools/seo/profiles/), and since Batch 3 (prototypes/batch3_20261002.html) the
 * enquiry kinds under Settings › Email (enquiries/kind-rows.tsx). Lived in tools/seo/_ui until
 * that second tool used it.
 *
 *   a group:  mono caps title · a count on the right (when there is one), then its rows
 *   a row:    a full-width button (mark · name · value · chevron); open, it turns grey
 *   a quiet row: the same face with nothing to open (no chevron)
 *   the card: a white box under the open row, LABEL | value rows (label above on a phone)
 *
 * The row's FACE is the caller's (a test has tags, a profile has a platform mark); the box
 * around it, its divider, the mark, the value, the chevron and the card are here. No
 * directive: only client components render these.
 */

/** `data-*` hooks a caller puts on an element (tests and keyboard nav find rows by them). */
type DataAttrs = { [key: `data-${string}`]: string | undefined }

/**
 * The thin line between two closed rows (a shadow, so it takes no room). It draws ITSELF from
 * the row's neighbours: none on the first row, none on an open row (it is its own grey block),
 * none on the row right under an open one. So a list built from several components (the
 * Profiles tab's) needs no caller to know which row is open. An open row carries `data-open`.
 */
const DIVIDER = '[&:not(:first-child):not([data-open]):not([data-open]+*)]:shadow-[0_-1px_0_var(--color-hairline-soft)]'

/** A group: its mono caps title and count, then its rows (pulled out 12px, so a row's grey
 *  reaches past the text column). */
export function DisclosureGroup({ title, count, countData, children }: { title: string; count?: string; countData?: DataAttrs; children: ReactNode }) {
  return (
    <>
      <div className="mb-0.5 mt-[26px] flex items-baseline justify-between gap-4">
        <h3 className={cx(EYEBROW, 'font-normal')}>{title}</h3>
        {count !== undefined ? (
          <span {...countData} className={MONO_META}>
            {count}
          </span>
        ) : null}
      </div>
      <div className="-mx-3">{children}</div>
    </>
  )
}

/** One row that opens: the box, its button (`face` inside), and `children` (the card) while
 *  open. `note`: a small link pinned under the row's value, outside the button (a link can't
 *  sit inside one). */
export function DisclosureItem({
  buttonId,
  cardId,
  open,
  onToggle,
  itemData,
  rowData,
  rowClassName,
  note,
  face,
  children,
}: {
  buttonId: string
  cardId: string
  open: boolean
  onToggle: () => void
  itemData?: DataAttrs
  rowData?: DataAttrs
  /** Extra on the button, e.g. `scroll-mt-28` where a deep link scrolls a row into view. */
  rowClassName?: string
  note?: ReactNode
  face: ReactNode
  children?: ReactNode
}) {
  const button = (
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
  )
  return (
    <div {...itemData} data-open={open ? '' : undefined} className={cx('rounded-xl', DIVIDER, open && 'my-1 bg-surface')}>
      {note ? (
        <div className="relative">
          {button}
          <span className="absolute bottom-1 right-10 leading-none">{note}</span>
        </div>
      ) : (
        button
      )}
      {open ? children : null}
    </div>
  )
}

/** A row with nothing to open: the same box, divider and face, no button. `className` is the
 *  row's own look (the AI test dims an untested one). */
export function QuietItem({ itemData, className, children }: { itemData?: DataAttrs; className?: string; children: ReactNode }) {
  return (
    <div {...itemData} className={cx('rounded-xl', DIVIDER)}>
      <div className={cx('flex items-center gap-3.5 p-3', className)}>{children}</div>
    </div>
  )
}

/** A row that goes somewhere else instead of opening (the press kit's missing photo → Profile,
 *  Batch 3): the same box, divider, face and grey hover as a row that opens, as a link. `label`
 *  names where it goes, on hover (a RowFace with `open={false}` gives it the chevron). */
export function LinkItem({ href, label, itemData, children }: { href: string; label: string; itemData?: DataAttrs; children: ReactNode }) {
  return (
    <div {...itemData} className={cx('rounded-xl', DIVIDER)}>
      <Link
        href={href}
        className={cx('group/trow relative flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-surface', FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        {children}
        <HoverLabel label={label} />
      </Link>
    </div>
  )
}

/**
 * The mark at a row's start, in a 20px slot so every name lines up:
 *
 *   check    done, passing                    ring        not done yet (Profiles)
 *   alert    needs the manager                faint-ring  not tested (a plain hollow ring)
 *   minus    doesn't apply                    red-ring    out of date (a bio)
 *                                             dashed      couldn't check, or still to come
 */
export type RowMarkKind = 'check' | 'alert' | 'minus' | 'ring' | 'faint-ring' | 'red-ring' | 'dashed'

const RING: Record<Extract<RowMarkKind, `${string}ring` | 'dashed'>, string> = {
  ring: 'border-ink',
  'faint-ring': 'border-ink-faint',
  'red-ring': 'border-accent-red',
  dashed: 'border-dashed border-ink-faint',
}

export function RowMark({ kind, data, className }: { kind: RowMarkKind | null; data?: DataAttrs; className?: string }) {
  return (
    <span aria-hidden="true" data-row-mark={kind ?? ''} {...data} className={cx('flex w-5 flex-none justify-center', className)}>
      {kind === 'check' ? (
        <Icon name="check" size={17} className="text-ink" />
      ) : kind === 'alert' ? (
        <Icon name="alert" size={17} className="text-accent-red" />
      ) : kind === 'minus' ? (
        <Icon name="minus" size={17} className="text-ink-faint" />
      ) : kind ? (
        <span className={cx('h-[13px] w-[13px] rounded-full border-[1.6px]', RING[kind])} />
      ) : null}
    </span>
  )
}

const NAME_TONE = { ink: 'text-ink', muted: 'text-ink-muted', faint: 'text-ink-faint' } as const

/**
 * The inside of a row: mark · name · (`extra`, then `value`) · chevron. The NAME WRAPS, never
 * truncates, at every width (review L6: on a phone six rows read "Nothing on your site tu…").
 * On a phone `extra` and the value drop under the name; from `sm` up they sit on the right.
 * `open` undefined: a quiet row, no chevron. `srWord` is read after the name ("passing").
 */
export function RowFace({
  mark,
  name,
  nameData,
  tone = 'ink',
  srWord,
  extra,
  value,
  open,
}: {
  mark: ReactNode
  name: ReactNode
  nameData?: DataAttrs
  tone?: keyof typeof NAME_TONE
  srWord?: string
  extra?: ReactNode
  value?: ReactNode
  open?: boolean
}) {
  return (
    <>
      {mark}
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3.5">
        <span {...nameData} className={cx('min-w-0 flex-1 text-[15px] font-medium leading-[1.35] [overflow-wrap:anywhere]', NAME_TONE[tone])}>
          {name}
        </span>
        {srWord ? <span className="sr-only">, {srWord}</span> : null}
        {extra || value ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex-none sm:flex-nowrap sm:gap-3.5">
            {extra}
            {value}
          </span>
        ) : null}
      </span>
      {open !== undefined ? <RowChevron open={open} /> : null}
    </>
  )
}

/** A row's short value on the right: faint, red when it needs the manager. Truncates at 200px,
 *  unless `whole` (a status that must be read to its end: "may be out of date since Sep 30"). */
export function RowValue({ bad, whole = false, data, children }: { bad: boolean; whole?: boolean; data?: DataAttrs; children: ReactNode }) {
  return (
    <span
      {...data}
      className={cx(
        'min-w-0 max-w-full font-space text-[12px]',
        whole ? 'sm:text-right' : 'truncate whitespace-nowrap sm:max-w-[200px]',
        bad ? 'text-accent-red' : 'text-ink-faint',
      )}
    >
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

/** The white card under an open row: LABEL | value rows, beside each other from 700px. It sits
 *  under the row's name (past the 20px mark); `noMark`, for a list whose rows carry none (the
 *  enquiry kinds), starts it at the row's own edge instead. */
export function DisclosureCard({ id, labelledBy, noMark = false, children }: { id: string; labelledBy: string; noMark?: boolean; children: ReactNode }) {
  return (
    <div id={id} role="region" aria-labelledby={labelledBy} className={cx('px-3 pb-3 pt-0.5 sm:pb-[22px] sm:pr-3.5', noMark ? 'sm:pl-3' : 'sm:pl-[46px]')}>
      <div className="grid grid-cols-1 gap-y-1.5 rounded-xl border border-hairline bg-paper px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] min-[700px]:grid-cols-[100px_minmax(0,1fr)] min-[700px]:gap-x-5 min-[700px]:gap-y-5">
        {children}
      </div>
    </div>
  )
}

/** One LABEL | value row of the card (RESULT, WHAT WE SAW, PAGE…). Above its value on a phone.
 *  `name` is the value's `data-card` hook; `className` lays the value out. The value is its
 *  pencil's EDIT_TARGET (styles.ts): a pencil in it shows only while the pointer is on that line,
 *  and a click anywhere on the line opens it (EditRow, edit-row.tsx). */
export function CardField({ label, name, className, children }: { label: string; name?: string; className?: string; children: ReactNode }) {
  return (
    <>
      <span className={cx(CAPS_LABEL, 'pt-3 leading-[1.4] text-ink-faint first:pt-0 min-[700px]:pt-1 min-[700px]:first:pt-1')}>{label}</span>
      <EditRow data-card={name} className={cx('min-w-0', className)}>
        {children}
      </EditRow>
    </>
  )
}

/** A card's last line when its actions are more than one sentence can end in (the bio email's
 *  Open in Mail · Copy · Download · Mark as sent): bare glyphs in the value column, no line
 *  above them. `ml-auto` on one sends it to the right edge. The line is a pencil's EDIT_TARGET,
 *  but not an EditRow: it is nothing but glyphs, each its own control, so the gaps between them
 *  stand for none of them. */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className={cx(EDIT_TARGET, 'flex flex-wrap items-center gap-4 pt-3 min-[700px]:col-start-2 min-[700px]:pt-0')}>{children}</div>
}

/** One glyph of CardActions: bare, 17px, its name on hover (RowIcon `bare`). */
export function CardAction({ className, ...props }: Omit<RowIconProps, 'variant' | 'glyphSize'>) {
  return <RowIcon {...props} variant="bare" glyphSize={17} className={className} />
}

/** The bare glyph that ends a card's sentence: pencil to a setting, ↗ to another site, wrench
 *  for a fix, plug to Connections (RowIcon `bare`, 17px, its name on hover opening to the right). */
export function SentenceAction(props: Omit<RowIconProps, 'variant' | 'glyphSize' | 'labelAlign' | 'className'>) {
  return <RowIcon {...props} variant="bare" glyphSize={17} labelAlign="start" className="ml-2.5 align-[-3px]" />
}
