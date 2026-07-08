'use client'

import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

/**
 * The on-site select control, shared by every publish-gated card/row (releases,
 * videos, merch, tour). The checkbox itself carries the state — there is no
 * separate "On site" badge, and it uses the site accents (no amber):
 *   • live         (checked + published) → solid INK check
 *   • pending add  (checked, not yet live) → solid BLUE (accent) check
 *   • pending drop (live, unchecked) → RED (accent-red) outline, empty
 *   • off          (draft, unchecked) → grey hairline outline, empty
 * So a filled check = wanted on site, and its COLOUR says whether that's already
 * live (ink) or an unpublished change (blue = adding, red = removing). Clicking
 * toggles; the click never bubbles to the card behind it.
 */
export function SelectToggle({
  selected,
  visible,
  onToggle,
  label,
  className,
}: {
  selected: boolean
  /** Whether the item is currently live on the public site. */
  visible: boolean
  onToggle: () => void
  /** Item name, for the accessible label / tooltip. */
  label: string
  className?: string
}) {
  const state = selected
    ? visible
      ? 'live'
      : 'pending-add'
    : visible
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
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cx(
        'inline-flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border shadow-sm transition-colors',
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
