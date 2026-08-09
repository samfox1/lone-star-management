'use client'

import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

type AssetKind = 'music' | 'photos' | 'videos'

const ITEMS: { key: AssetKind; label: string; seg: string; icon: IconName }[] = [
  { key: 'music', label: 'Music', seg: 'music', icon: 'tracks' },
  // "Images", not "Photos" (Sam, 2026-08-09): the tab holds logos, artwork and covers,
  // not only photographs, and its route has always been /images. The KEY stays `photos`
  // — callers pass it as `current` — so this is a label change, not a route change.
  { key: 'photos', label: 'Images', seg: 'images', icon: 'photo' },
  { key: 'videos', label: 'Videos', seg: 'videos', icon: 'videos' },
]

// The 71px in the classes below = the dashboard header's rendered height
// (py-3.5 + the 42px nav row + border). Keep in sync with layout.tsx.

/**
 * The Assets pages' left side panel: a FIXED-WIDTH icon rail with each label stacked
 * UNDER its icon, always visible. Nothing changes width on hover, so the panel never
 * pushes or reflows the main grid (the old slide-the-label-out-on-hover drawer widened
 * the panel every frame — a heavy image/video grid re-laying-out was the hover lag).
 * The panel is a fixed spacer with the nav position:fixed inside it, spanning the
 * viewport height so the icon stack can center on the viewport middle (mt = 50vh −
 * header, then −50%); the nav's right border is THE vertical line.
 */
export function AssetsRail({ artistId, active }: { artistId: string; active: AssetKind }) {
  return (
    // The spacer holds the layout column; the nav (fixed) sits exactly inside it, both
    // a constant 76px — wide enough for the stacked label, so nothing ever resizes.
    <div className="hidden w-[76px] flex-none md:block">
      <nav
        aria-label="Asset types"
        className="fixed left-0 top-[71px] flex h-[calc(100vh-71px)] w-[76px] flex-col border-r border-hairline bg-paper"
      >
        <div className="mt-[calc(50vh-71px)] flex -translate-y-1/2 flex-col gap-1 px-2">
          {ITEMS.map((it) => (
            <Link
              key={it.key}
              href={`/artists/${artistId}/${it.seg}`}
              aria-current={it.key === active ? 'page' : undefined}
              className={cx(
                'flex flex-col items-center gap-1 rounded-lg py-2.5 transition-colors',
                it.key === active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon name={it.icon} size={22} />
              <span className="font-space text-[10px] tracking-[0.02em]">{it.label}</span>
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
