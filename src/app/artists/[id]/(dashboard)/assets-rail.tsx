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
 * (label slides out on hover); the panel's right border is THE vertical line,
 * so a hover-expanded label widens the panel and pushes the line right. The
 * line starts BELOW the header; the icon stack still centers on the full
 * viewport (mt = 50vh − header, then translate −50% — margins keep it in-flow
 * so its width drives the border, unlike absolute positioning).
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  return (
    <div className="relative hidden w-16 flex-none md:block">
      <nav
        aria-label="Asset types"
        className="pointer-events-none fixed top-[71px] z-10 flex h-[calc(100vh-71px)] min-w-16 flex-col items-start border-r border-hairline"
      >
        <div className="mt-[calc(50vh-71px)] flex -translate-y-1/2 flex-col gap-0.5 pl-1">
          {ITEMS.map((it) => (
            <Link
              key={it.key}
              href={`/artists/${artistId}/${it.seg}`}
              title={it.label}
              aria-label={it.label}
              aria-current={it.key === active ? 'page' : undefined}
              className={cx(
                'group pointer-events-auto inline-flex items-center rounded-lg bg-paper px-2.5 py-2.5 transition-colors',
                it.key === active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon name={it.icon} size={22} />
              <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs tracking-[0.02em] opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[140px] group-hover:opacity-100">
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
