'use client'

import { useState, type ReactNode } from 'react'
import { CardModal } from './card-modal'
import { SelectToggle } from './select-toggle'

type BoundAction = (formData: FormData) => void | Promise<void>

/**
 * A cover-grid tile that opens an edit modal — the interaction shared by the
 * Tracks, Releases, Merch, and Videos cards. Owns the open state, the full-width
 * trigger button, and the CardModal lifecycle, so each card is reduced to its two
 * bits of content: the `tile` (cover + title + meta) and the modal body
 * (`children`). Tour uses CardModal directly because its trigger is a partial row,
 * not a full-tile button.
 *
 * Pass `onToggleSelect` to make the tile publish-selectable: a SelectToggle
 * (top-left) drives the password-gated publish and encodes the on-site state in the
 * check itself (ink = live, amber = unpublished change).
 */
export function GridCard({
  tile,
  deleteAction,
  deleteLabel,
  children,
  selected,
  onToggleSelect,
  visible,
  selectLabel,
}: {
  tile: ReactNode
  deleteAction?: BoundAction
  deleteLabel?: string
  children: ReactNode
  /** On-site selection state. Omit `onToggleSelect` for a non-selectable tile. */
  selected?: boolean
  onToggleSelect?: () => void
  /** Whether the item is currently live on the public site (drives the badge). */
  visible?: boolean
  /** Accessible name for the checkbox, e.g. the item title. */
  selectLabel?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="relative">
        {onToggleSelect && (
          <div className="absolute left-2 top-2 z-10">
            <SelectToggle
              selected={!!selected}
              visible={!!visible}
              onToggle={onToggleSelect}
              label={selectLabel ?? 'item'}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group block w-full text-left"
        >
          {tile}
        </button>
      </div>
      <CardModal
        open={open}
        onClose={() => setOpen(false)}
        deleteAction={deleteAction}
        deleteLabel={deleteLabel}
      >
        {children}
      </CardModal>
    </>
  )
}
