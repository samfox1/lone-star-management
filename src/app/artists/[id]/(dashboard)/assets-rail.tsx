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
 * The Assets pages' left rail: music / photos / videos. Same interaction
 * language as the top nav — icon with a label that slides out on hover — but
 * vertical. The icon stack is FIXED-centered in the full viewport (nav bar
 * included), and a full-height hairline runs along the rail's left edge.
 * `position: fixed` with no left/top keeps the element's static x-position, so
 * both the line and the stack stay in the rail's column while the page scrolls.
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  return (
    <div className="relative hidden w-16 flex-none md:block">
      <span aria-hidden className="fixed top-0 h-screen w-px bg-hairline" />
      <nav aria-label="Asset types" className="fixed top-1/2 flex -translate-y-1/2 flex-col gap-0.5 pl-3">
        {ITEMS.map((it) => (
          <Link
            key={it.key}
            href={`/artists/${artistId}/${it.seg}`}
            title={it.label}
            aria-label={it.label}
            aria-current={it.key === active ? 'page' : undefined}
            className={cx(
              'group inline-flex items-center rounded-lg bg-paper px-2.5 py-2.5 transition-colors',
              it.key === active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
            )}
          >
            <Icon name={it.icon} size={22} />
            <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs tracking-[0.02em] opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[120px] group-hover:opacity-100">
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
    <div className="flex gap-4">
      <AssetsRail artistId={artistId} active={active} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
