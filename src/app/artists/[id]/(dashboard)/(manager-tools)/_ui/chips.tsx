'use client'

import type { Ref } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { FOCUS_RING } from './focus-ring'
import { HoverLabel } from './row-icon'

/**
 * THE CHIP LOOK, one copy (batch 2, 2026-10-02, prototypes/batch2_compare_20261002.html item 3:
 * Settings › Email takes the SEO Facts chips). The pieces, not a list: each tool's list holds
 * different things (a genre is a word; an email recipient is an address with an optional name,
 * added through two fields), so each composes these and keeps its own add flow and save.
 *
 * Users: Settings › Email (enquiries/kind-rows.tsx). The ledger's `Chips` (_ui/fields.tsx,
 * Profile's genre and other names) still draws the same look inline; it moves onto these next.
 */

/** One chip: its text, and a × that is always visible (a touch screen has no hover). */
export function Chip({ text, title, removeLabel, onRemove }: { text: string; title?: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span title={title} className="group/chip relative inline-flex items-center gap-1 rounded-full border border-hairline bg-paper py-1 pl-2.5 pr-1.5 text-[12px] text-ink">
      {text}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className={cx('-my-1 -mr-1 inline-flex rounded-full p-1 text-ink-faint transition-colors hover:text-accent-red', FOCUS_RING)}
      >
        <Icon name="close" size={11} />
      </button>
    </span>
  )
}

/** The dashed + at the end of a list. Blue on hover, its label on hover and as its name. */
export function ChipPlus({ label, onClick, ref }: { label: string; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx('relative inline-flex items-center rounded-full border border-dashed border-hairline px-2 py-[5px] text-ink-faint transition-colors hover:border-ink-faint hover:text-accent', FOCUS_RING)}
    >
      <Icon name="plus" size={12} />
      <HoverLabel label={label} />
    </button>
  )
}

/** A one-line field in the chip row, as round and as small as a chip. Width is the caller's. */
export const CHIP_FIELD = 'rounded-full border border-hairline bg-paper px-2.5 py-1 text-[12px] text-ink outline-none focus:border-ink'
