'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

/**
 * "Refresh" on the Music page: pulls the artist's releases from their linked
 * Spotify (imported off-site, ready to publish). Bound server action does the
 * work; this shows the spinner + any error and refreshes the list on success.
 */
export function RefreshButton({
  action,
  disabled = false,
}: {
  action: () => Promise<{ ok: boolean; error?: string }>
  /** Greyed out where a pull doesn't apply (e.g. the Unreleased view — platform
   *  pulls only ever produce Released music). */
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    if (disabled) return
    setError(null)
    start(async () => {
      const res = await action()
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Refresh failed.')
    })
  }

  const label = pending ? 'Syncing…' : 'Sync'

  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-space text-xs text-accent-red">{error}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={pending || disabled}
        title={disabled ? 'Sync pulls released music from platforms' : label}
        aria-label={label}
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-60"
      >
        {/* Label stays collapsed until hover (or while refreshing), then slides open to the left. */}
        <span
          className={cx(
            'overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[90px] group-hover:pl-1 group-hover:pr-1.5',
            pending ? 'max-w-[90px] pl-1 pr-1.5' : 'max-w-0',
          )}
        >
          {label}
        </span>
        <Icon name="refresh" size={15} className={cx(pending && 'animate-spin')} />
      </button>
    </div>
  )
}
