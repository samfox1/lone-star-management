'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

type Tab = { label: string; seg: string; icon: IconName }

// 1:1 with the existing dashboard routes. A filled dot marks a segment with
// unpublished edits (`dirty` keyed by segment — see dirtyBySeg in sections.ts).
const TABS: Tab[] = [
  { label: 'Overview', seg: '', icon: 'analytics' },
  { label: 'Tracks', seg: 'tracks', icon: 'tracks' },
  { label: 'Releases', seg: 'releases', icon: 'releases' },
  { label: 'Tour', seg: 'tour', icon: 'tour' },
  { label: 'Videos', seg: 'videos', icon: 'videos' },
  { label: 'Merch', seg: 'merch', icon: 'merch' },
  { label: 'Links', seg: 'links', icon: 'links' },
  { label: 'Site', seg: 'site', icon: 'site' },
  { label: 'Press kit', seg: 'epk', icon: 'epk' },
  { label: 'Settings', seg: 'settings', icon: 'settings' },
]

/**
 * Artist section nav. `layout="bar"` is the centered top-nav (icons that reveal
 * their label on hover, like the roster nav) for desktop; `layout="strip"` is a
 * horizontally-scrollable labelled strip for phones. Active is derived from the
 * path; a pending dot is shown per dirty segment.
 */
export function ArtistNav({
  artistId,
  dirty,
  layout,
}: {
  artistId: string
  dirty: Record<string, boolean>
  layout: 'bar' | 'strip'
}) {
  const pathname = usePathname()
  const base = `/artists/${artistId}`

  const resolve = (t: Tab) => {
    const href = t.seg ? `${base}/${t.seg}` : base
    return {
      href,
      active: t.seg ? pathname.startsWith(href) : pathname === base,
      isDirty: t.seg ? (dirty[t.seg] ?? false) : false,
    }
  }

  if (layout === 'bar') {
    return (
      <nav className="hidden justify-center gap-0.5 md:flex">
        {TABS.map((t) => {
          const { href, active, isDirty } = resolve(t)
          return (
            <Link
              key={t.seg || 'overview'}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'group relative inline-flex items-center rounded-lg px-2.5 py-2.5 transition-colors',
                active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={18} />
              <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs tracking-[0.02em] opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[120px] group-hover:opacity-100">
                {t.label}
              </span>
              {isDirty && (
                <span
                  className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-status-pending"
                  title="Unpublished changes"
                />
              )}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-hairline px-4 md:hidden">
      {TABS.map((t) => {
        const { href, active, isDirty } = resolve(t)
        return (
          <Link
            key={t.seg || 'overview'}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex flex-none items-center gap-2 border-b-2 px-3 py-3 font-space text-xs tracking-[0.01em] transition-colors',
              active ? 'border-accent text-accent' : 'border-transparent text-ink-muted',
            )}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-status-pending" />}
          </Link>
        )
      })}
    </nav>
  )
}
