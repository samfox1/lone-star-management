'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { compactNumber } from '@/lib/format'
import { Icon } from '@/components/ui/icons'
import { Avatar, KLabel, initials } from '@/components/ui/ui'

export type RosterTotals = {
  artists: number
  pending: number
  views: number
  plays: number
  linkClicks: number
}

/**
 * Right-hand roster stats panel. Collapsible (peeks open on load, then tucks away
 * to advertise itself) via a pull-tab on its edge — matches the prototype. All
 * figures are REAL (last-30-day site analytics); streaming totals get an honest
 * empty state until sources are connected. Absolutely-positioned handle, so the
 * parent roster container must be `relative`.
 */
export function StatsPanel({
  totals,
  top,
}: {
  totals: RosterTotals
  top: { name: string; views: number } | null
}) {
  const [open, setOpen] = useState(true)

  // Peek open on mount, then close — so the user learns the panel is there.
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 1200)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      <aside
        className={cx(
          'hidden flex-none overflow-hidden border-l transition-[width,border-color] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] md:block',
          open ? 'w-[312px] border-hairline' : 'w-0 border-transparent',
        )}
      >
        <div className="w-[312px] px-[22px] pb-7 pt-5">
          <div className="flex items-center justify-between">
            <KLabel>Roster totals</KLabel>
            <button
              onClick={() => setOpen(false)}
              title="Hide"
              className="inline-flex text-ink-faint transition-colors hover:text-ink"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>

          <div className="mt-4 font-space text-[31px] font-bold tracking-[-0.02em]">
            {compactNumber(totals.views)}
          </div>
          <div className="mt-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            Site views · 30 days
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-[18px] border-b border-hairline pb-[22px]">
            <PanelStat v={totals.artists} k="Artists" />
            <PanelStat v={totals.pending} k="In progress" />
            <PanelStat v={totals.plays} k="Plays · 30d" />
            <PanelStat v={totals.linkClicks} k="Link clicks · 30d" />
          </div>

          {top && top.views > 0 && (
            <>
              <KLabel className="mt-5">Top by views · 30 days</KLabel>
              <div className="mt-1.5 flex items-center gap-3 py-2">
                <Avatar initials={initials(top.name)} size={28} />
                <span className="flex-1 truncate text-[13px] font-semibold">{top.name}</span>
                <span className="font-space text-xs text-ink-muted">{compactNumber(top.views)}</span>
              </div>
            </>
          )}

          <div className="mt-5 rounded-xl border border-dashed border-hairline p-3.5">
            <KLabel>Streaming totals</KLabel>
            <p className="mt-1.5 font-space text-[11px] leading-relaxed text-ink-muted">
              Connect Spotify or Apple Music on each artist to see listener trends here.
            </p>
          </div>
        </div>
      </aside>

      <button
        onClick={() => setOpen((o) => !o)}
        title="Toggle stats panel"
        style={{ right: open ? 312 : 0 }}
        className="absolute top-1/2 z-10 hidden h-[46px] w-6 -translate-y-1/2 items-center justify-center rounded-l-[9px] border border-r-0 border-hairline bg-paper text-ink-muted shadow-[-3px_0_10px_rgba(0,0,0,0.05)] transition-[right] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-ink md:flex"
      >
        <Icon name="chevronLeft" size={16} className={cx('transition-transform', !open && 'rotate-180')} />
      </button>
    </>
  )
}

function PanelStat({ v, k }: { v: number; k: string }) {
  return (
    <div>
      <div className="font-space text-[21px] font-bold tracking-[-0.02em]">{compactNumber(v)}</div>
      <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">{k}</div>
    </div>
  )
}
