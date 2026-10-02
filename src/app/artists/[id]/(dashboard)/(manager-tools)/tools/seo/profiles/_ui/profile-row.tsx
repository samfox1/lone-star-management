import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { FOCUS_RING } from '../../../../_ui/focus-ring'
import { DisclosureCard, DisclosureItem, QuietItem, RowFace, RowMark, RowValue } from '../../../../_ui/disclosure'

/**
 * THE PROFILES TAB'S ROWS, in the AI test's row and card (Batch 2, Sam 2026-10-02,
 * prototypes/batch2_compare_20261002.html §1 "A"): the look is _ui/disclosure.tsx's;
 * this file only puts its pieces together for the tab's three lists, the Apple Music & Amazon
 * bio (profiles-tab.tsx), Discogs and Wikidata (outside-rows.tsx), and the Outside bios
 * (bio-rows.tsx).
 *
 *   a row:   a round mark (a check once done), the name, its state in Space Mono, a chevron
 *   a quiet row: a dashed ring, nothing to open (`later`: a profile still to come, greyed)
 *   a card:  ProfileCard, LABEL | value rows (disclosure.tsx's CardField)
 *
 * No directive: only client components render these.
 */

/** The ids a row and its card share: `base` is the caller's useId(). */
const rowId = (base: string) => `${base}row`
const cardId = (base: string) => `${base}card`

/** A row that opens a card. `mark` is one or more glyphs before the name; `bad` turns the state
 *  red ("may be out of date"). `note`: a small link under the state, outside the button. */
export function ProfileRow({
  id,
  open,
  onToggle,
  mark,
  name,
  status,
  bad = false,
  itemData,
  note,
  children,
}: {
  id: string
  open: boolean
  onToggle: () => void
  mark: ReactNode
  name: string
  status: string
  bad?: boolean
  itemData?: { [key: `data-${string}`]: string | undefined }
  note?: ReactNode
  /** The card (ProfileCard with the same `id`), shown while open. */
  children: ReactNode
}) {
  return (
    <DisclosureItem
      buttonId={rowId(id)}
      cardId={cardId(id)}
      open={open}
      onToggle={onToggle}
      itemData={itemData}
      note={note}
      face={
        <RowFace
          mark={mark}
          name={name}
          value={
            <RowValue bad={bad} whole>
              {status}
            </RowValue>
          }
          open={open}
        />
      }
    >
      {children}
    </DisclosureItem>
  )
}

/** A row with nothing to open: still checking, no site, couldn't check, or `later` (a profile
 *  still to come, greyed whole). */
export function QuietRow({ name, status, later = false }: { name: string; status: string; later?: boolean }) {
  return (
    <QuietItem>
      <RowFace
        mark={<RowMark kind="dashed" />}
        name={name}
        tone={later ? 'faint' : 'ink'}
        value={
          <RowValue bad={false} whole>
            {status}
          </RowValue>
        }
      />
    </QuietItem>
  )
}

/** The white card under an open row; `id` is its row's. */
export function ProfileCard({ id, children }: { id: string; children: ReactNode }) {
  return (
    <DisclosureCard id={cardId(id)} labelledBy={rowId(id)}>
      {children}
    </DisclosureCard>
  )
}

/** A card value in plain text. */
export const VALUE = 'text-[13.5px] leading-[1.6]'

/** A link to another site, as a card value: underlined Space Mono, a new tab. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx('break-all border-b border-hairline font-space text-[13px] leading-[1.7] text-ink hover:text-accent', FOCUS_RING)}>
      {children}
    </a>
  )
}
