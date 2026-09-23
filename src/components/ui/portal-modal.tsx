'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { modalOverlayClass } from './ui'
import { useLockBodyScroll } from './use-lock-body-scroll'

/**
 * A SMALL portaled modal for a single focused action (an upload drop zone), stacked on
 * top of whatever opened it. Portaled to document.body so it can never resize the parent
 * modal's layout; half the standard card width because a drop zone doesn't need 560px.
 *
 * Escape is handled in the CAPTURE phase with `stopImmediatePropagation`: the parent
 * dialog's own Escape listens on document in the bubble phase, and Escape must close
 * THIS modal only. Backdrop click closes too. This shape was copy-pasted per feature
 * (audio upload, image upload) before it lived here.
 *
 * `cardClass` widens it for callers that need more than a drop zone (the analytics
 * View-all list passes `modalCardClass`). It exists so those callers reuse THIS
 * Escape handling — and the body-scroll lock — rather than growing a fourth copy of it.
 */
const DROP_ZONE_CARD =
  'relative flex max-h-[88vh] w-[280px] max-w-[90vw] flex-col overflow-auto rounded-2xl bg-paper p-7 font-space shadow-2xl'

export function PortalModal({
  ariaLabel,
  onClose,
  cardClass = DROP_ZONE_CARD,
  children,
}: {
  ariaLabel: string
  onClose: () => void
  /** The card's own classes. Defaults to the narrow drop-zone card. */
  cardClass?: string
  children: React.ReactNode
}) {
  // The page behind a dialog must not scroll. Every OTHER modal in the dashboard locks it
  // (13 of them call this hook); PortalModal did not, so the analytics View-all window
  // scrolled the page underneath it. Unconditional because this component only exists
  // while it is open — its callers mount and unmount it rather than passing `open`.
  //
  // The hook is stacking-safe: each lock remembers the value it replaced, so a PortalModal
  // opened ON TOP of a CardModal restores the card's lock when it closes, not the page's
  // original scroll.
  useLockBodyScroll(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cardClass}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-ink-faint transition-colors hover:text-ink"
        >
          <Icon name="plus" size={18} className="rotate-45" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
