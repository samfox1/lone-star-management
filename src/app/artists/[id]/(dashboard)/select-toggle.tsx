'use client'

import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

/**
 * THE on-site check, everywhere (Sam, 2026-09-13: "I want the checks to be consistent
 * across the site… mostly black maybe with a little blue"). One shape, one palette, no
 * per-page override — the tour page used to paint its live check blue, and the first
 * page that drew it black beside it made the two read as different controls.
 *
 * Round, and the check itself carries the state — there is no separate "On site" badge:
 *   • live         (checked + published)     → solid INK check           — on the site
 *   • pending add  (checked, not yet live)   → solid BLUE (accent) check — publish to put it on
 *   • pending drop (live, unchecked)         → RED (accent-red) outline  — publish to take it off
 *   • off          (draft, unchecked)        → grey hairline outline     — not on the site
 * So a filled check = wanted on site, and its colour says whether that is already live
 * (black) or an unpublished change (blue). Pages whose presence flips instantly (links)
 * pass `onSite={selected}` and only ever show black or empty. Clicking toggles; the click
 * never bubbles to the card behind it.
 */
export function SelectToggle({
  selected,
  onSite,
  onToggle,
  label,
  className,
}: {
  selected: boolean
  /** Whether the item is currently live on the public site. */
  onSite: boolean
  onToggle: () => void
  /** Item name, for the accessible label / tooltip. */
  label: string
  className?: string
}) {
  const state = selected
    ? onSite
      ? 'live'
      : 'pending-add'
    : onSite
      ? 'pending-drop'
      : 'off'

  const title = {
    live: `${label} — on site`,
    'pending-add': `${label} — checked, publish to put on site`,
    'pending-drop': `${label} — on site, publish to remove`,
    off: `${label} — off site`,
  }[state]

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={title}
      title={title}
      data-state={state}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cx(
        'inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border shadow-sm transition-colors',
        state === 'live' && 'border-ink bg-ink text-white',
        state === 'pending-add' && 'border-accent bg-accent text-white',
        state === 'pending-drop' && 'border-accent-red bg-paper text-accent-red',
        state === 'off' && 'border-hairline bg-paper text-transparent hover:border-ink-faint',
        className,
      )}
    >
      {selected && <Icon name="check" size={13} strokeWidth={2.4} />}
    </button>
  )
}
