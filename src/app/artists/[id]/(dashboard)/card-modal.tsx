'use client'

import { useEffect, type ReactNode } from 'react'
import { buttonClass, modalOverlayClass, modalCardClass } from '@/components/ui/ui'

type BoundAction = (formData: FormData) => void | Promise<void>

/**
 * The one modal shell for the dashboard's cover-grid cards (tracks, releases,
 * merch, videos, tour). Owns the overlay, click-outside / Escape dismissal, the
 * dialog a11y roles, and the shared Delete / Done footer — so each card only
 * supplies its unique body. Delete is optional (video/tour pass it; a
 * view-only modal can omit it).
 */
export function CardModal({
  open,
  onClose,
  deleteAction,
  deleteLabel = 'Delete',
  children,
}: {
  open: boolean
  onClose: () => void
  deleteAction?: BoundAction
  deleteLabel?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={modalCardClass}>
        {children}
        <div className="mt-6 flex items-center justify-between">
          {deleteAction ? (
            <form action={deleteAction}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
              >
                {deleteLabel}
              </button>
            </form>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className={buttonClass('ghost')}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
