'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { buttonClass, modalOverlayClass, modalCardClass, modalCardWideClass } from '@/components/ui/ui'
import { useLockBodyScroll } from './use-lock-body-scroll'
import { toast } from './toast'

/** A delete server action, pre-bound to its (type, id, artistId), returning {error?}. */
type DeleteAction = () => Promise<{ error?: string } | void>

/**
 * The one modal shell for the dashboard's cover-grid cards (tracks, releases,
 * merch, videos, tour). Owns the overlay, click-outside / Escape dismissal, the
 * dialog a11y roles, and the shared Delete / Done footer — so each card only
 * supplies its unique body. Delete is optional and confirms with a toast
 * ("{deleteNoun} deleted", or the error).
 */
export function CardModal({
  open,
  onClose,
  deleteAction,
  deleteLabel = 'Delete',
  deleteNoun = 'Item',
  confirmText,
  wide = false,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  deleteAction?: DeleteAction
  deleteLabel?: string
  deleteNoun?: string
  /** Overrides the confirmation wording. The prompt itself cannot be waived. */
  confirmText?: string
  /** Wide, two-column card that sizes to its content instead of scrolling. */
  wide?: boolean
  /** Replaces the default Delete / Done footer row (e.g. a single Save button). Pass `null`
   *  to render NO footer at all — for modals that carry their own action inside the body. */
  footer?: ReactNode | null
  children: ReactNode
}) {
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function del() {
    // `deleting` is STATE: two fast clicks both read the pre-render value and delete
    // twice. The ref is the actual latch; the state only drives the label.
    if (!deleteAction || deleting || deletingRef.current) return
    // Every card grid deletes through this footer, and there is no undo and no trash.
    if (!window.confirm(confirmText ?? `Delete this ${deleteNoun.toLowerCase()}? This can't be undone.`)) return
    deletingRef.current = true
    setDeleting(true)
    try {
      const res = await deleteAction()
      if (res && 'error' in res && res.error) {
        toast(res.error, 'error')
        return
      }
      toast(`${deleteNoun} deleted`)
      onClose()
    } catch {
      toast(`Couldn't delete that ${deleteNoun.toLowerCase()}.`, 'error')
    } finally {
      // In `finally` so one transient failure doesn't leave the modal permanently dead.
      deletingRef.current = false
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={wide ? modalCardWideClass : modalCardClass}>
        {children}
        {footer === null ? null : footer !== undefined ? (
          <div className="mt-6">{footer}</div>
        ) : (
          <div className="mt-6 flex items-center justify-between">
            {deleteAction ? (
              <button
                type="button"
                onClick={del}
                disabled={deleting}
                className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : deleteLabel}
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={onClose} className={buttonClass('ghost')}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
