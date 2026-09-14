'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { DEVICE_KINDS, waffleCells, type DeviceShares, type WaffleCell } from '@/lib/analytics'
import { DeviceGlyph } from '@/components/ui/device-glyphs'

/**
 * Mobile, tablet, computer as a WAFFLE: a 10 × 10 grid of a hundred squares,
 * one per percent of everyone, filled kind by kind. A reader sees the split as
 * area before reading a single number; the legend beside it is just the three
 * names with their swatches. The number lives on hover: hover any square and
 * its kind lights up as a block, the other kinds fade, its legend row stays
 * full, and a readout follows the pointer with the share (Sam, 2026-09-14:
 * "when I hover over a mobile square, I should see percent" … "remove the
 * percentage next to the type of device"). The colours are fixed per device — mobile the blue accent, tablet
 * the red accent, computer ink — so they never repaint between artists, and the
 * unclassified are the hairline grey so the grid stays honest about what the
 * three leave out.
 */
const CELL: Record<WaffleCell, string> = { mobile: 'bg-accent', tablet: 'bg-accent-red', desktop: 'bg-ink', other: 'bg-hairline' }
const LABEL: Record<WaffleCell, string> = Object.fromEntries([...DEVICE_KINDS.map((k) => [k.key, k.label]), ['other', 'Unclassified']]) as Record<WaffleCell, string>

export function DeviceSplit({ shares, empty = 'No visits yet.', className }: { shares: DeviceShares; empty?: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ kind: WaffleCell; x: number; y: number } | null>(null)
  if (shares.total === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  const pct = (n: number) => `${Math.round((n / shares.total) * 100)}%`
  const cells = waffleCells(shares)

  return (
    <div className={cx('flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8', className)}>
      <div ref={box} className="relative w-[224px] shrink-0" onPointerLeave={() => setHover(null)}>
        <div
          role="img"
          aria-label={DEVICE_KINDS.map((k) => `${pct(shares[k.key])} ${k.label.toLowerCase()}`).join(', ')}
          data-waffle
          className="grid grid-cols-10 gap-[3px]"
        >
          {cells.map((kind, i) => (
            <span
              key={i}
              data-cell={kind}
              data-dim={hover !== null && hover.kind !== kind ? '' : undefined}
              className={cx('aspect-square rounded-[3px] transition-opacity duration-150', CELL[kind], hover !== null && hover.kind !== kind && 'opacity-25')}
              onPointerMove={(e) => {
                const r = box.current?.getBoundingClientRect()
                setHover({ kind, x: r ? e.clientX - r.left : 0, y: r ? e.clientY - r.top : 0 })
              }}
            />
          ))}
        </div>
        {hover && (
          <div
            role="status"
            data-readout
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-paper px-2.5 py-1.5 font-space text-[11px] font-bold tabular-nums text-ink shadow-[0_8px_24px_rgba(17,17,17,0.12)]"
            style={{ left: hover.x + 12, top: hover.y - 34 }}
          >
            {pct(shares[hover.kind])} <span className="font-normal uppercase tracking-[0.1em] text-ink-faint">{LABEL[hover.kind]}</span>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap gap-x-8 gap-y-4 sm:flex-col sm:gap-4" aria-label="Devices">
        {DEVICE_KINDS.map((k) => (
          <li
            key={k.key}
            data-legend={k.key}
            className={cx('flex items-center gap-3 transition-opacity duration-150', hover !== null && hover.kind !== k.key && 'opacity-40')}
          >
            <span aria-hidden className={cx('h-3 w-3 shrink-0 rounded-[3px]', CELL[k.key])} />
            <DeviceGlyph device={k.key} className="shrink-0 text-ink" />
            <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{k.label}</span>
          </li>
        ))}
        {shares.other > 0 && (
          <li className="flex items-center gap-3">
            <span aria-hidden className={cx('h-3 w-3 shrink-0 rounded-[3px]', CELL.other)} />
            <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {pct(shares.other)} unclassified
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}
