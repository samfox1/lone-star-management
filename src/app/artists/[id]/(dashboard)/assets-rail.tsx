'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

// Full viewport height from the top, under the sticky header — tools-rail.tsx explains
// the rubber-band bug this fixes (Sam, 2026-09-10). No header-height number to keep in
// sync any more.
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
        className="fixed left-0 top-0 z-10 flex h-screen w-[76px] flex-col border-r border-hairline bg-paper"
      >
        <div className="mt-[50vh] flex -translate-y-1/2 flex-col gap-1 px-2">
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

/**
 * Which assets tab a pathname is on, or null. PURE, so it is unit-testable and so the
 * shell and anything else that needs to know ("is this an assets route?") read one rule.
 * The URL segment is the truth; `photos` is the key the rail has always used for /images.
 */
export function assetKindFor(pathname: string, artistId: string): AssetKind | null {
  const seg = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop() ?? ''
  if (!pathname.startsWith(`/artists/${artistId}/`)) return null
  return ITEMS.find((it) => it.seg === seg)?.key ?? null
}

/**
 * The rail, rendered from the DASHBOARD LAYOUT rather than by each assets page
 * (2026-09-10). Same shape as ToolsShell: on an assets route it wraps the page with the
 * rail; elsewhere it is the page alone.
 *
 * WHY IT MOVED. Sam: "it takes way too long to bounce between the pages on the assets
 * page." Measured, a warm tab switch commits in ~300ms — but for those 300ms NOTHING
 * changes on screen, because each page rendered its own rail and its own body in one
 * server pass with no loading state. A `loading.tsx` per page fixes that, but only if the
 * rail is OUTSIDE the page: a loading state replaces the page, and a rail inside the page
 * would blink out on every switch. In the layout it stays put, and the skeleton fills the
 * space beside it the instant the tab is clicked.
 */
export function AssetsShell({ artistId, children }: { artistId: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const active = assetKindFor(pathname, artistId)
  if (!active) return <>{children}</>
  return (
    <div className="flex gap-6">
      <AssetsRail artistId={artistId} active={active} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
