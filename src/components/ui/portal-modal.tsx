'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { modalOverlayClass } from './ui'

/**
 * A SMALL portaled modal for a single focused action (an upload drop zone), stacked on
 * top of whatever opened it. Portaled to document.body so it can never resize the parent
 * modal's layout; half the standard card width because a drop zone doesn't need 560px.
 *
 * Escape is handled in the CAPTURE phase with `stopImmediatePropagation`: the parent
 * dialog's own Escape listens on document in the bubble phase, and Escape must close
 * THIS modal only. Backdrop click closes too. This shape was copy-pasted per feature
 * (audio upload, image upload) before it lived here.
 */
export function PortalModal({
  ariaLabel,
  onClose,
  children,
}: {
  ariaLabel: string
  onClose: () => void
  children: React.ReactNode
}) {
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
      <div className="relative flex max-h-[88vh] w-[280px] max-w-[90vw] flex-col overflow-auto rounded-2xl bg-paper p-7 font-space shadow-2xl">
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
