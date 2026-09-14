import { cx } from '@/lib/cx'
import { DEVICE_KINDS, waffleCells, type DeviceShares, type WaffleCell } from '@/lib/analytics'
import { DeviceGlyph } from '@/components/ui/device-glyphs'

/**
 * Mobile, tablet, computer as a WAFFLE: a 10 × 10 grid of a hundred squares,
 * one per percent of everyone, filled kind by kind. A reader sees the split as
 * area before reading a single number; the three shares beside it are the
 * legend — percentages only, no counts (Sam, 2026-09-13: "the percentage is
 * enough"), and the whole thing sits in half a row. The colours are fixed per device — mobile the blue accent,
 * tablet the red accent, computer ink — so they never repaint between artists,
 * and the unclassified are the hairline grey so the grid stays honest about
 * what the three leave out.
 */
const CELL: Record<WaffleCell, string> = { mobile: 'bg-accent', tablet: 'bg-accent-red', desktop: 'bg-ink', other: 'bg-hairline' }

export function DeviceSplit({ shares, empty = 'No visits yet.', className }: { shares: DeviceShares; empty?: string; className?: string }) {
  if (shares.total === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  const pct = (n: number) => `${Math.round((n / shares.total) * 100)}%`
  const cells = waffleCells(shares)

  return (
    <div className={cx('flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10', className)}>
      <div
        role="img"
        aria-label={DEVICE_KINDS.map((k) => `${pct(shares[k.key])} ${k.label.toLowerCase()}`).join(', ')}
        data-waffle
        className="grid w-[224px] shrink-0 grid-cols-10 gap-[3px]"
      >
        {cells.map((kind, i) => (
          <span key={i} data-cell={kind} className={cx('aspect-square rounded-[3px]', CELL[kind])} />
        ))}
      </div>

      <dl className="flex flex-1 flex-wrap gap-x-10 gap-y-5 sm:flex-col sm:gap-5">
        {DEVICE_KINDS.map((k) => (
          <div key={k.key} className="flex items-center gap-4">
            <span aria-hidden className={cx('h-3 w-3 shrink-0 rounded-[3px]', CELL[k.key])} />
            <DeviceGlyph device={k.key} className="shrink-0 text-ink" />
            <dt className="w-20 font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{k.label}</dt>
            <dd className="font-space text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{pct(shares[k.key])}</dd>
          </div>
        ))}
        {shares.other > 0 && (
          <div className="flex items-center gap-4">
            <span aria-hidden className={cx('h-3 w-3 shrink-0 rounded-[3px]', CELL.other)} />
            <dt className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {pct(shares.other)} on something the door could not classify
            </dt>
          </div>
        )}
      </dl>
    </div>
  )
}
