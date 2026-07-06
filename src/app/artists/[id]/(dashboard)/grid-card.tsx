'use client'

import { useState, type ReactNode } from 'react'
import { CardModal } from './card-modal'

type BoundAction = (formData: FormData) => void | Promise<void>

/**
 * A cover-grid tile that opens an edit modal — the interaction shared by the
 * Tracks, Releases, Merch, and Videos cards. Owns the open state, the full-width
 * trigger button, and the CardModal lifecycle, so each card is reduced to its two
 * bits of content: the `tile` (cover + title + meta) and the modal body
 * (`children`). Tour uses CardModal directly because its trigger is a partial row,
 * not a full-tile button.
 */
export function GridCard({
  tile,
  deleteAction,
  deleteLabel,
  children,
}: {
  tile: ReactNode
  deleteAction?: BoundAction
  deleteLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full text-left"
      >
        {tile}
      </button>
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
