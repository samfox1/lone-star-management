'use client'

import { cx } from '@/lib/cx'

/**
 * The segmented control shared by the dashboard's small view switches (the same
 * language as the On-site filter): bordered pill group, ink-filled active
 * segment. Generic over the option key strings.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  /** Accessible name for the control group. */
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-none gap-0.5 rounded-lg border border-hairline p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={o.key === value}
          className={cx(
            'rounded-md px-2.5 py-1 font-space text-xs transition-colors',
            o.key === value ? 'bg-ink font-semibold text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
