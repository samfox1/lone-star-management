'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
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
  footerLeft,
  label,
  analyticsHref,
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
  /** Extra controls in the footer's LEFT group, before Delete (a flag pill, "Merge into…").
   *  Ignored when `footer` replaces the whole row. */
  footerLeft?: ReactNode
  /** Accessible name for the dialog (the thing's name, or "Add date"). */
  label?: string
  /** Where the analytics button goes. The modal shows no numbers of its own (Sam,
   *  2026-09-11: "I don't need the click info on these modals") — one button takes the
   *  manager to the analytics page instead.
   *  TODO(analytics): deep-link to THIS item once the analytics page can take one
   *  (being built separately); today every button lands on the artist's page. */
  analyticsHref?: string
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
      aria-label={label}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={wide ? modalCardWideClass : modalCardClass}>
        <div className="absolute right-4 top-4 flex items-center gap-0.5">
          {analyticsHref ? (
            <Link
              href={analyticsHref}
              aria-label="Analytics"
              title="Analytics"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <Icon name="analytics" size={16} />
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
        {footer === null ? null : footer !== undefined ? (
          <div className="mt-6">{footer}</div>
        ) : (
          <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
            <div className="flex items-center gap-3">
              {footerLeft}
              {deleteAction ? (
                <button
                  type="button"
                  onClick={del}
                  disabled={deleting}
                  className="rounded-md px-1.5 py-1 font-space text-[11px] uppercase tracking-[0.06em] text-accent-red transition-colors hover:bg-danger-soft disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : deleteLabel}
                </button>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className={buttonClass('ghost')}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
