'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/cx'
import { Icon } from './icons'
import { ICON_HOVER } from './icon-hover'
import { useLockBodyScroll } from './use-lock-body-scroll'

/**
 * A panel down the right side of the page, over a light scrim: where the Analytics page
 * opens its full tables (All days, All sources, All countries; the r12 mock, Sam
 * 2026-10-06: "a button along right edge that indicates clicking it opens up a side
 * panel table"). It slides in, and out again when closed; nothing moves under reduced
 * motion.
 *
 * `onBack` puts a back arrow before the title, for a panel that has been stepped into
 * (a country's cities). Escape, the ×, and a click on the scrim close the whole panel.
 * Escape is caught in the CAPTURE phase and stopped, as in PortalModal, so it closes
 * this and nothing beneath it. The page behind does not scroll, and focus goes to the ×
 * on opening and back to whatever opened the panel on closing.
 *
 * The caller mounts it to open it and unmounts it in `onClose`.
 */
export function SideSheet({ title, onClose, onBack, children }: {
  title: string
  onClose: () => void
  onBack?: () => void
  children: ReactNode
}) {
  const [leaving, setLeaving] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)
  useLockBodyScroll(true)

  // Out with motion when the browser animates; otherwise at once.
  const close = () => {
    const animates = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    if (animates) setLeaving(true)
    else onClose()
  }
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div aria-hidden className={cx('fixed inset-0 z-[80] bg-ink/20', leaving ? 'scrim-out' : 'scrim-in')} onClick={close} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('fixed inset-y-0 right-0 z-[90] flex w-[min(620px,100vw)] flex-col bg-paper shadow-[-20px_0_50px_rgba(17,17,17,0.12)]', leaving ? 'sheet-out' : 'sheet-in')}
        onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onClose() }}
      >
        <div className="flex items-center gap-2.5 px-[26px] pb-3.5 pt-[22px]">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back" className={cx('-ml-1 text-ink-faint transition-colors', ICON_HOVER)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
          )}
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          <button
            ref={closeBtn}
            type="button"
            onClick={close}
            aria-label="Close"
            className={cx('ml-auto text-ink-faint transition-[color,transform] duration-200 hover:rotate-90', ICON_HOVER)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[26px] pb-8">{children}</div>
      </aside>
    </>,
    document.body,
  )
}

/**
 * The button that opens a side panel: the panel glyph alone, and its words slide out to the
 * glyph's LEFT while it is hovered or focused (Sam, 2026-10-06: "the text shouldnt appear until
 * hovering over that side panel button"). It sits at a right edge, so it grows leftward and the
 * glyph never moves. The words are always its name, for a screen reader and for touch.
 */
export function SheetButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('group inline-flex items-center whitespace-nowrap py-1.5 font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted outline-none transition-colors hover:text-ink focus-visible:text-ink', className)}
    >
      <span
        data-sheet-label
        className="max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(.22,.8,.24,1)] group-hover:mr-2 group-hover:max-w-[180px] group-hover:opacity-100 group-focus-visible:mr-2 group-focus-visible:max-w-[180px] group-focus-visible:opacity-100"
      >
        {label}
      </span>
      <Icon name="panel" size={20} className="transition-[stroke-width] duration-200 group-hover:[stroke-width:2] group-focus-visible:[stroke-width:2]" />
    </button>
  )
}
