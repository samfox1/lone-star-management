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

/**
 * The Assets pages' left side panel. Icons sit at the panel's LEFT edge with
 * top-nav interaction language (label slides out on hover); the panel's right
 * border is THE vertical line, so a hover-expanded label widens the panel and
 * pushes the line right. The stack is fixed-centered in the full viewport (nav
 * bar included): `position: fixed` with no left keeps the static x-position,
 * and the container is pointer-events-none so only the links themselves catch
 * the mouse while the full-height border rides along.
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  return (
    <div className="relative hidden w-40 flex-none md:block">
      <nav
        aria-label="Asset types"
        className="pointer-events-none fixed top-0 z-10 flex h-screen min-w-40 flex-col items-start justify-center gap-0.5 border-r border-hairline"
      >
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
