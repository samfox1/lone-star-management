'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

/**
 * A toolbar button that opens the Drive browser in a modal — for surfaces that
 * have no SectionToolbar Import slot (Videos page, Media panel). Same collapsed
 * icon-label affordance as the Add/Refresh toolbar buttons.
 */
export function DriveImportButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[70px] group-hover:pl-1 group-hover:pr-1.5">
          Drive
        </span>
        <Icon name="upload" size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className={modalCardClass}>
            <div className="border-b border-hairline pb-3.5">
              <KLabel>Google Drive</KLabel>
              <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">{title}</h2>
            </div>
            {/* The browser mounts on open — that's when it lists the folder. */}
            <div className="mt-4">{children}</div>
          </div>
        </div>
      )}
    </>
  )
}
