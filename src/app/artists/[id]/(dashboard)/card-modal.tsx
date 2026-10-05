'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { ICON_HOVER } from '@/components/ui/icon-hover'
import { buttonClass, modalOverlayClass, modalCardClass, modalCardNarrowClass, modalCardWideClass, modalTitleClass } from '@/components/ui/ui'
import { useConfirm } from './confirm-dialog'
import { useLockBodyScroll } from '@/components/ui/use-lock-body-scroll'
import { toast } from './toast'

/** The footer pair is one control read twice: same pill, same width, so neither reads as
 *  the bigger half (Sam, 2026-09-12: "the same size as the delete button"). */
const PAIR = 'min-w-[88px] justify-center'

/** A delete server action, pre-bound to its (type, id, artistId), returning {error?}. */
type DeleteAction = () => Promise<{ error?: string } | void>

/**
 * The one modal shell for the dashboard's cover-grid cards (tracks, releases,
 * merch, videos, tour). Owns the overlay, click-outside / Escape dismissal, the
 * dialog a11y roles, the top bar (an optional plain title · the corner icons · ×), and
 * the shared Delete / Save footer — so each card only supplies its unique body. Delete
 * is optional and confirms with a toast ("{deleteNoun} deleted", or the error).
 *
 * THE TITLE (Sam, 2026-10-02: "I dont like these type of headers in modals. Remove it if
 * its not needed, or make it simple, a few words, no icons"): most modals pass none — the
 * click that opened them already said what they are — and still pass `label`, so the
 * dialog keeps its accessible name. A title is kept only to say WHICH item is open (a
 * song's name, a show's date and venue). It is plain words in `modalTitleClass`: no icon,
 * mark or picture beside it, no meta line under it.
 */
export function CardModal({
  open,
  onClose,
  deleteAction,
  deleteLabel = 'Delete',
  deleteNoun = 'Item',
  confirmText,
  wide = false,
  narrow = false,
  footer,
  footerLeft,
  footerFill,
  title,
  label,
  analyticsHref,
  corner,
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
  /** A small card for one short task (the code window). Ignored with `wide`. */
  narrow?: boolean
  /** Replaces the default Delete / Save footer row (e.g. a single Add button). Pass `null`
   *  to render NO footer at all — for modals that carry their own action inside the body. */
  footer?: ReactNode | null
  /** Extra controls in the footer's LEFT group, before Delete (a flag pill, "Merge into…").
   *  Ignored when `footer` replaces the whole row. */
  footerLeft?: ReactNode
  /** One control STRETCHED across the footer between the left group and Save — the song
   *  player, which wants the width (Sam, 2026-09-12) and belongs with the actions rather
   *  than boxed into a row's value column. */
  footerFill?: ReactNode
  /** The plain title on the top bar — which item is open. Omit it when the opener already
   *  said what this is (most modals). Never an icon, a picture or a meta line. */
  title?: ReactNode
  /** Accessible name for the dialog (the thing's name, or "Add date"). Defaults to the
   *  title when that is a string; a modal with no title must pass one. */
  label?: string
  /** Where the analytics button goes. The modal shows no numbers of its own (Sam,
   *  2026-09-11: "I don't need the click info on these modals") — one button takes the
   *  manager to the analytics page instead.
   *  TODO(analytics): deep-link to THIS item once the analytics page can take one
   *  (being built separately); today every button lands on the artist's page. */
  analyticsHref?: string
  /** Extra icon buttons in the top-right corner, between Analytics and × (Share, say). */
  corner?: ReactNode
  children: ReactNode
}) {
  const [deleting, setDeleting] = useState(false)
  const { ask, dialog: confirmDialog } = useConfirm()
  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    // While the question is up, Escape answers IT — dismissing the card underneath would
    // lose the manager's place to a keypress meant for the dialog on top.
    // An Escape a field inside already handled (EditList, AddRow: preventDefault) closes
    // that field, not the card. stopPropagation cannot say so: in the app React's root IS
    // document, the node this listens on, so it would hear the Escape anyway.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function del() {
    // `deleting` guards the in-flight window; there is no ref latch beside it, unlike
    // ActionButton. The delete cannot start until the question is answered, and the
    // question is a full-screen dialog over this footer — so no second click reaches
    // here first. One question at a time is `useConfirm`'s job (confirm-dialog.tsx).
    if (!deleteAction || deleting) return
    // Every card grid deletes through this footer, and there is no undo and no trash.
    if (!(await ask(confirmText ?? `Delete this ${deleteNoun.toLowerCase()}? This can't be undone.`, { action: deleteLabel }))) return
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
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={wide ? modalCardWideClass : narrow ? modalCardNarrowClass : modalCardClass}>
        {/* The top bar is IN FLOW (it used to float over the body), so a modal with no title
            can start its content right under the × without the two colliding. The negative
            margins keep the icons where they always sat, 16px in from the corner. */}
        <div className="-mr-3 -mt-3 flex min-h-8 items-center gap-3">
          {title ? <h2 className={`${modalTitleClass} min-w-0 flex-1 truncate`}>{title}</h2> : <div className="flex-1" />}
          {/* Above the body, so content pulled up beside the × (the enquiry modal) never
              covers it or takes its clicks. */}
          <div className="relative z-10 flex flex-none items-center gap-0.5">
            {analyticsHref ? (
              <Link
                href={analyticsHref}
                aria-label="Analytics"
                title="Analytics"
                className={`flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors ${ICON_HOVER}`}
              >
                <Icon name="analytics" size={16} />
              </Link>
            ) : null}
            {corner}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors ${ICON_HOVER}`}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
        {children}
        {footer === null ? null : footer !== undefined ? (
          <div className="mt-6">{footer}</div>
        ) : (
          <div className="mt-7 flex items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              {footerLeft}
              {deleteAction ? (
                <button type="button" onClick={del} disabled={deleting} className={buttonClass('danger', PAIR)}>
                  {deleting ? 'Deleting…' : deleteLabel}
                </button>
              ) : null}
            </div>
            {footerFill ? <div className="min-w-0 flex-1">{footerFill}</div> : null}
            {/* SAVE, not Done (Sam, 2026-09-12) — in ink, and the same size as Delete
                beside it. Every row in a card saves itself as it is edited, so this closes
                rather than writing; it is named for what the manager means by pressing. */}
            <button type="button" onClick={onClose} className={buttonClass('confirm', PAIR)}>
              Save
            </button>
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  )
}
