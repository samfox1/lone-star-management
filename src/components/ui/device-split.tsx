import { cx } from '@/lib/cx'
import { DEVICE_KINDS, type DeviceShares } from '@/lib/analytics'
import { DeviceGlyph } from '@/components/ui/device-glyphs'

/**
 * Mobile, tablet, computer: three shares, biggest number first in reading
 * order, and nothing per browser. Sam, 2026-09-13: the artist needs to know
 * which view of the site most people see, so that view gets built out well.
 * Shares are of EVERYONE; a line underneath counts what the door could not
 * classify, so the three never quietly sum to less than they claim.
 */
export function DeviceSplit({ shares, empty = 'No visits yet.', className }: { shares: DeviceShares; empty?: string; className?: string }) {
  if (shares.total === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  const pct = (n: number) => `${Math.round((n / shares.total) * 100)}%`

  return (
    <div className={className}>
      <dl className="grid grid-cols-3 gap-6">
        {DEVICE_KINDS.map((k) => (
          <div key={k.key} className="flex flex-col gap-2">
            <dt className="flex items-center gap-2 font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              <DeviceGlyph device={k.key} className="text-ink" />
              {k.label}
            </dt>
            <dd className="font-space text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{pct(shares[k.key])}</dd>
            <dd className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {shares[k.key].toLocaleString('en-US')} {shares[k.key] === 1 ? 'visitor' : 'visitors'}
            </dd>
          </div>
        ))}
      </dl>
      {shares.other > 0 && (
        <p className="mt-4 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          {shares.other.toLocaleString('en-US')} visitors on something the door could not classify
        </p>
      )}
    </div>
  )
}
