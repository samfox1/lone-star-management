'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { useLockBodyScroll } from './use-lock-body-scroll'

/**
 * Lets the modal's content (DriveBrowser) report whether an import is in flight,
 * so the shell can refuse to close mid-import. Null outside a DriveImportButton —
 * consumers no-op. See useDriveModalBusy.
 */
const DriveModalBusyContext = createContext<((busy: boolean) => void) | null>(null)

/** DriveBrowser calls this to publish its busy state up to the modal shell. */
export function useDriveModalBusy(busy: boolean) {
  const report = useContext(DriveModalBusyContext)
  useEffect(() => {
    report?.(busy)
    return () => report?.(false)
  }, [busy, report])
}

/**
 * A toolbar button that opens the Drive browser in a modal — for surfaces that
 * have no SectionToolbar Import slot (Videos page, Media panel). Same collapsed
 * icon-label affordance as the Add/Refresh toolbar buttons.
 */
export function DriveImportButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // The child reports its import-busy state here; close() refuses while true so
  // Escape / an overlay click can't unmount the browser mid-import.
  const busyRef = useRef(false)
  const setModalBusy = (busy: boolean) => {
    busyRef.current = busy
  }
  function close() {
    if (busyRef.current) return
    setOpen(false)
  }
  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
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
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className={modalCardClass}>
            <div className="border-b border-hairline pb-3.5">
              <KLabel>Google Drive</KLabel>
              <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">{title}</h2>
            </div>
            {/* The browser mounts on open — that's when it lists the folder. */}
            <div className="mt-4">
              <DriveModalBusyContext.Provider value={setModalBusy}>{children}</DriveModalBusyContext.Provider>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
