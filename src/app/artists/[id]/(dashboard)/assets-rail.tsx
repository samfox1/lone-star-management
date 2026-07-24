'use client'

import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

type AssetKind = 'music' | 'photos' | 'videos'

const ITEMS: { key: AssetKind; label: string; seg: string; icon: IconName }[] = [
  { key: 'music', label: 'Music', seg: 'music', icon: 'tracks' },
  { key: 'photos', label: 'Photos', seg: 'images', icon: 'photo' },
  { key: 'videos', label: 'Videos', seg: 'videos', icon: 'videos' },
]

// The 71px in the classes below = the dashboard header's rendered height
// (py-3.5 + the 42px nav row + border). Keep in sync with layout.tsx.

/**
 * The Assets pages' left side panel — a touch narrower than the top nav bar is
 * tall. Icons sit at the panel's left edge with top-nav interaction language
 * (label slides out on hover). The panel is an OVERLAY: on hover the fixed nav
 * expands OVER the content's left gutter, and the in-flow spacer stays a constant
 * width so the main grid never re-lays-out. (It used to animate the spacer's width,
 * which shrank the flex sibling every frame — a heavy image/video grid reflowing on
 * each hover was the lag.) The fixed nav's right border is THE vertical line; it
 * moves on hover while the content beneath it does not. The line starts BELOW the
 * header; the icon stack centers on the full viewport (mt = 50vh − header, −50%).
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  // The wrapper is the `group` AND the in-flow spacer, at a CONSTANT width: hovering
  // any icon (a pointer-events-auto descendant of the fixed nav) triggers the group,
  // expanding the fixed nav over the content — the spacer never resizes, so nothing
  // in the main window reflows.
  return (
    // pointer-events-none on the wrapper: its :hover can only arrive through the
    // pointer-events-auto icon links, so the panel expands ONLY on icon hover —
    // not when the mouse crosses the empty panel column.
    <div className="group pointer-events-none relative hidden w-12 flex-none md:block">
      <nav
        aria-label="Asset types"
        className="pointer-events-none fixed left-0 top-[71px] z-10 flex h-[calc(100vh-71px)] w-[76px] flex-col border-r border-hairline bg-paper transition-[width] duration-200 group-hover:w-[120px]"
      >
        <div className="mt-[calc(50vh-71px)] flex -translate-y-1/2 flex-col gap-0.5 pl-[17px]">
          {ITEMS.map((it) => (
            <Link
              key={it.key}
              href={`/artists/${artistId}/${it.seg}`}
              aria-label={it.label}
              aria-current={it.key === active ? 'page' : undefined}
              className={cx(
                // group/item: only THIS link's hover reveals its label; the outer
                // group still widens the drawer for any icon hover.
                'group/item pointer-events-auto inline-flex items-center rounded-lg px-2.5 py-2.5 transition-colors',
                it.key === active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon name={it.icon} size={22} />
              <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs tracking-[0.02em] opacity-0 transition-all duration-200 group-hover/item:ml-2 group-hover/item:max-w-[110px] group-hover/item:opacity-100">
                {it.label}
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}

/** Wrap an asset page's content with the rail (mobile: rail hidden, content full-width). */
export function AssetsShell({ artistId, active, children }: { artistId: string; active: AssetKind; children: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      <AssetsRail artistId={artistId} active={active} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
