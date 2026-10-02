import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { FOCUS_RING } from '../../../../_ui/focus-ring'
import { RowIcon, type RowIconProps } from '../../../../_ui/row-icon'

/**
 * THE PROFILES TAB'S ROW AND CARD (Sam, 2026-09-30, prototypes/profiles_bio_pack_20260930.html),
 * drawn once for its three lists: the Apple Music & Amazon bio (profiles-tab.tsx), Discogs and
 * Wikidata (outside-rows.tsx), and the Outside bios (bio-rows.tsx).
 *
 *   a row:   a round mark, the name, its state in Space Mono, a chevron; a quiet row has no
 *            chevron and nothing to open
 *   a card:  a white box under the open row, LABEL | value rows, then the bare action glyphs
 *
 * No directive: only client components render these.
 */

/** A group's mono caps label ("OUTSIDE PROFILES"), and a card row's. */
export const LABEL = 'font-space text-[10.5px] font-bold uppercase leading-none tracking-[0.14em] text-ink-faint'
const ROW = 'flex w-full items-center gap-3.5 border-b border-hairline px-2.5 py-[13px] text-left'

/** A card value in plain text. */
export const VALUE = 'text-[13.5px] leading-[1.6]'

/** The round mark at a row's start: a ring, filled with a check once done. */
export function RoundMark({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className={cx('flex h-4 w-4 flex-none items-center justify-center rounded-full border-[1.5px] border-ink', done && 'bg-ink text-paper')}>
      {done ? <Icon name="check" size={10} /> : null}
    </span>
  )
}

/** The dashed ring: a row that couldn't be checked, or isn't here yet. */
export function DashedMark() {
  return <span aria-hidden="true" className="h-4 w-4 flex-none rounded-full border-[1.5px] border-dashed border-ink-faint" />
}

/** A row that opens a card. `mark` is one or more glyphs before the name; `statusClassName`
 *  replaces the state's grey (a red "may be out of date"). */
export function ProfileRow({
  open,
  controls,
  onToggle,
  mark,
  name,
  status,
  statusClassName,
}: {
  open: boolean
  controls: string
  onToggle: () => void
  mark: ReactNode
  name: string
  status: string
  statusClassName?: string
}) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className={cx(ROW, 'transition-colors hover:bg-surface-hover', FOCUS_RING, 'focus-visible:-outline-offset-2')}>
      {mark}
      <span className="flex-1 text-[15px]">{name}</span>
      <span className={cx('font-space text-[12px]', statusClassName ?? 'text-ink-muted')}>{status}</span>
      <Icon name="chevronRight" size={16} className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90 text-ink')} />
    </button>
  )
}

/** A row with nothing to open: still checking, no site, couldn't check, or `later` (a profile
 *  still to come, greyed whole). */
export function QuietRow({ name, status, later = false }: { name: string; status: string; later?: boolean }) {
  return (
    <div className={cx(ROW, later ? 'text-ink-faint' : 'text-ink-muted')}>
      <DashedMark />
      <span className={cx('flex-1 text-[15px]', !later && 'text-ink')}>{name}</span>
      <span className="font-space text-[12px]">{status}</span>
    </div>
  )
}

/** The white card under an open row. */
export function ProfileCard({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="mb-[18px] mt-1.5 rounded-[14px] border border-hairline bg-paper px-6 py-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {children}
    </div>
  )
}

/** One LABEL | value row of a card; the label above its value on a phone. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 border-t border-hairline-soft py-3 first:border-t-0 first:pt-0.5 min-[600px]:grid-cols-[120px_minmax(0,1fr)] min-[600px]:gap-[18px]">
      <span className={cx(LABEL, 'pt-[3px]')}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A link to another site, as a card value: underlined Space Mono, a new tab. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx('break-all border-b border-hairline font-space text-[13px] leading-[1.7] text-ink hover:text-accent', FOCUS_RING)}>
      {children}
    </a>
  )
}

/** The card's last line: its actions, left to right (`ml-auto` sends one to the right edge). */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap items-center gap-4 border-t border-hairline-soft pt-4">{children}</div>
}

/** One action: a bare 18px glyph (RowIcon `bare`), its name on hover. */
export function CardAction({ className, ...props }: Omit<RowIconProps, 'variant' | 'glyphSize'>) {
  return <RowIcon {...props} variant="bare" glyphSize={18} className={cx('p-1', className)} />
}
