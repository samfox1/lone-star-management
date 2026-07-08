'use client'

import { type ReactNode } from 'react'
import { cx } from '@/lib/cx'

/**
 * A lightweight filter + sort control for the dashboard grids: a row of pill
 * chips (single-select) on the left, an optional segmented sort control on the
 * right. Client-side only — the parent holds the state and re-filters its list,
 * so switching is instant. Generic over the chip / sort key strings.
 */
export function FilterBar<T extends string, S extends string>({
  leading,
  trailing,
  chips,
  active,
  onChip,
  sortOptions,
  sort,
  onSort,
}: {
  /** Optional element rendered before the chips (e.g. the item count). */
  leading?: ReactNode
  /** Optional element rendered on the right, before the sort control (e.g. a Refresh / import button). */
  trailing?: ReactNode
  chips: { key: T; label: string }[]
  active: T
  onChip: (key: T) => void
  sortOptions?: { key: S; label: string }[]
  sort?: S
  onSort?: (key: S) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {leading && <div className="mr-1.5">{leading}</div>}
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChip(c.key)}
            aria-pressed={c.key === active}
            className={cx(
              'rounded-full px-3 py-1.5 font-space text-xs font-medium tracking-[0.01em] transition-colors',
              c.key === active
                ? 'bg-ink text-white'
                : 'border border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-none items-center gap-2">
        {trailing}
        {sortOptions && sort !== undefined && onSort && (
          <div className="inline-flex flex-none gap-0.5 rounded-lg border border-hairline p-0.5">
            {sortOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => onSort(o.key)}
                aria-pressed={o.key === sort}
                className={cx(
                  'rounded-md px-2.5 py-1 font-space text-xs transition-colors',
                  o.key === sort ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
