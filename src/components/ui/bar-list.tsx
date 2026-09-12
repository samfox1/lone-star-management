import { cx } from '@/lib/cx'
import type { Bar } from '@/lib/analytics'

/**
 * A ranked list of magnitudes — where visits came from, where they were, what they
 * were read on.
 *
 * A horizontal bar, because the categories are named things of unequal length
 * ("Instagram", "AI assistants", "United States") and a column chart would set
 * every one of those on its side. The label sits ON the row rather than inside the
 * bar, so a one-visit row reads exactly as well as the top one — a label inside a
 * short bar is the commonest way these lists break.
 *
 * Every bar is the same weight. Shading them by size would encode the length twice
 * and say nothing the length has not already said.
 */
export function BarList({
  bars,
  unit = 'visits',
  empty = 'Nothing yet.',
  className,
}: {
  bars: Bar[]
  unit?: string
  empty?: string
  className?: string
}) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  if (bars.length === 0) {
    return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  }
  return (
    <ol className={cx('space-y-1', className)}>
      {bars.map((b) => (
        <li key={b.key} className="relative isolate flex items-baseline gap-3 px-2 py-1.5">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 -z-10 rounded-[3px] bg-track"
            style={{ width: `${Math.max(2, (b.value / max) * 100)}%` }}
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {b.label}
            {b.sub ? <span className="ml-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{b.sub}</span> : null}
          </span>
          <span className="font-space text-xs tabular-nums text-ink-muted">
            {b.value.toLocaleString('en-US')}
            <span className="sr-only"> {unit}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
