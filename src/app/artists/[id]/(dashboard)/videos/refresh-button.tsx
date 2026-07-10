'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass, modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { useLockBodyScroll } from '../use-lock-body-scroll'

/**
 * Videos-page "Refresh" (import): a toolbar icon that first asks to confirm, then
 * pulls every upload from the artist's linked YouTube channel into draft videos
 * (Shorts classified, manual videos preserved). The bound server action returns
 * status so we can spin, surface an error, and refresh the list on success.
 */
export function RefreshButton({ action }: { action: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  useLockBodyScroll(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !pending && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending])

  function run() {
    setError(null)
    start(async () => {
      const res = await action()
      if (res.ok) {
        setOpen(false)
        router.refresh()
      } else {
        setError(res.error ?? 'Import failed.')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        title="Refresh from YouTube"
        aria-label="Refresh from YouTube"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        {/* Label stays collapsed until hover, then slides open to the left (matches Music Refresh). */}
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[90px] group-hover:pl-1 group-hover:pr-1.5">
          Refresh
        </span>
        <Icon name="refresh" size={15} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && !pending && setOpen(false)}
        >
          <div className={modalCardClass}>
            <h3 className="text-lg font-bold tracking-[-0.01em]">Refresh videos</h3>
            <p className="mt-2 text-sm text-ink-muted">
              Import all posts from your linked YouTube channel? New uploads arrive as drafts, sorted into Videos and
              Shorts.
            </p>
            {error && <p className="mt-3 font-space text-xs text-accent-red">{error}</p>}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={buttonClass('ghost')}
              >
                Cancel
              </button>
              <button type="button" onClick={run} disabled={pending} className={buttonClass()}>
                {pending ? 'Refreshing…' : 'Update videos'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
