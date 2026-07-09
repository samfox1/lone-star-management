'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'

type View = 'released' | 'unreleased'

/**
 * The Music page's two halves as a segmented switch (same control language as
 * OnSiteFilter). Released is the default; the inactive half unmounts, so the
 * publish pill only exists on Released — Unreleased is dashboard-only and has
 * no publish affordance by design.
 */
export function MusicTabs({
  releasedCount,
  unreleasedCount,
  released,
  unreleased,
}: {
  releasedCount: number
  unreleasedCount: number
  released: ReactNode
  unreleased: ReactNode
}) {
  const [view, setView] = useState<View>('released')

  const tab = (key: View, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setView(key)}
      aria-pressed={view === key}
      className={cx(
        'rounded-md px-3 py-1.5 font-space text-xs transition-colors',
        view === key ? 'bg-ink font-semibold text-white' : 'text-ink-muted hover:text-ink',
      )}
    >
      {label} <span className={cx('tabular-nums', view === key ? 'text-white/60' : 'text-ink-faint')}>{count}</span>
    </button>
  )

  return (
    <div className="space-y-6">
      <div role="group" aria-label="Music view" className="inline-flex gap-0.5 rounded-lg border border-hairline p-0.5">
        {tab('released', 'Released', releasedCount)}
        {tab('unreleased', 'Unreleased', unreleasedCount)}
      </div>
      {view === 'released' ? released : unreleased}
    </div>
  )
}
