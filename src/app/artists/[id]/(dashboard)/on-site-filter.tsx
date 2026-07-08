'use client'

import { cx } from '@/lib/cx'

export type SiteFilter = 'all' | 'on' | 'off'

const OPTS: { key: SiteFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'On site' },
  { key: 'off', label: 'Off site' },
]

/**
 * The primary lens on a content page: show everything, only what's live on the public
 * site (`visible`), or only off-site drafts. A prominent segmented control (ink active)
 * next to the count. Filtering is by the LIVE truth (`visible`), so a pending
 * selection doesn't move a card between tabs until it's published.
 */
export function OnSiteFilter({ value, onChange }: { value: SiteFilter; onChange: (v: SiteFilter) => void }) {
  return (
    <div
      role="group"
      aria-label="Filter by site visibility"
      className="inline-flex flex-none gap-0.5 rounded-lg border border-hairline p-0.5"
    >
      {OPTS.map((o) => (
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

/** Keep only the items matching the site filter (`visible` is the live truth).
 *  `Boolean(...)` normalizes a stray null so an item never vanishes from both tabs. */
export function filterBySite<T extends { visible: boolean }>(items: T[], f: SiteFilter): T[] {
  if (f === 'all') return items
  return items.filter((i) => Boolean(i.visible) === (f === 'on'))
}

/** The empty-state title for a filtered content page. The off/on copy is identical
 *  everywhere; only the "all" (nothing-added-yet) title differs, so callers pass it. */
export function siteEmptyTitle(f: SiteFilter, allTitle: string): string {
  if (f === 'off') return 'Nothing off-site'
  if (f === 'on') return 'Nothing on the site yet'
  return allTitle
}
