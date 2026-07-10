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
 * The Assets pages' left rail: music / photos / videos, icons stacked and
 * vertically centered in the viewport (the vertical cousin of the top nav's
 * centered icons). Rendered by each asset page next to its content.
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  return (
    <nav
      aria-label="Asset types"
      className="sticky top-0 hidden h-[calc(100vh-6rem)] flex-none flex-col items-center justify-center gap-1 pr-1 md:flex"
    >
      {ITEMS.map((it) => (
        <Link
          key={it.key}
          href={`/artists/${artistId}/${it.seg}`}
          title={it.label}
          aria-label={it.label}
          aria-current={it.key === active ? 'page' : undefined}
          className={cx(
            'inline-flex items-center rounded-lg p-2.5 transition-colors',
            it.key === active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
          )}
        >
          <Icon name={it.icon} size={18} />
        </Link>
      ))}
    </nav>
  )
}

/** Wrap an asset page's content with the rail (mobile: rail hidden, content full-width). */
export function AssetsShell({ artistId, active, children }: { artistId: string; active: AssetKind; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <AssetsRail artistId={artistId} active={active} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
