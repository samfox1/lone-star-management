'use client'

import { cx } from '@/lib/cx'

/**
 * A line's on / off switch above a chart: a small square check beside its name, ONE control (a
 * label forwarding to a separate button fired twice), not a button drawn around the text (Sam,
 * 2026-09-13). The Analytics toggles and the Search page's Clicks.
 */
export function SquareCheck({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="group flex cursor-pointer select-none items-center gap-2 font-space text-xs text-ink"
    >
      <span
        aria-hidden
        className={cx(
          'flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors',
          on ? 'border-ink bg-ink text-white' : 'border-hairline bg-paper group-hover:border-ink-faint',
        )}
      >
        {on && (
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}
