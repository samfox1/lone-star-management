'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

type Tab = {
  label: string
  /** href segment appended to the artist base ('' = the Analytics index). */
  seg: string
  icon: IconName
  /** First route segments that mark this tab active (its own + folded-in pages). */
  match: string[]
  /** dirtyBySeg keys this tab owns — any dirty ⇒ the tab shows a pending dot. */
  dirtySegs: string[]
}

// Consolidated artist nav: 5 tabs. Assets folds Music (tracks + releases),
// Photos, and Videos behind one folder — its pages carry a left rail for the
// three kinds. Manager tools folds Site, Links, Press kit, Subscribers,
// Integrations, Settings and the publish/edit actions. A filled dot marks a
// tab with unpublished edits in any segment it owns (see dirtyBySeg).
const TABS: Tab[] = [
  { label: 'Analytics', seg: '', icon: 'analytics', match: [''], dirtySegs: [] },
  {
    label: 'Assets',
    seg: 'music',
    icon: 'folder',
    match: ['music', 'tracks', 'releases', 'videos', 'images'],
    dirtySegs: ['music', 'videos'],
  },
  { label: 'Tour', seg: 'tour', icon: 'tour', match: ['tour'], dirtySegs: ['tour'] },
  { label: 'Merch', seg: 'merch', icon: 'merch', match: ['merch'], dirtySegs: ['merch'] },
  {
    label: 'Manager tools',
    seg: 'tools',
    icon: 'tools',
    match: ['tools', 'site', 'links', 'epk', 'subscribers', 'settings', 'edit'],
    dirtySegs: ['site', 'links'],
  },
]

/**
 * Artist section nav. `layout="bar"` is the centered top-nav (icons that reveal
 * their label on hover, like the roster nav) for desktop; `layout="strip"` is a
 * horizontally-scrollable labelled strip for phones. Active is derived from the
 * first path segment; a pending dot is shown per dirty tab.
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
  // Current top-level segment under the artist base ('' on the Analytics index).
  const current = pathname.startsWith(base) ? pathname.slice(base.length).split('/')[1] ?? '' : ''

  const resolve = (t: Tab) => ({
    href: t.seg ? `${base}/${t.seg}` : base,
    active: t.match.includes(current),
    isDirty: t.dirtySegs.some((s) => dirty[s]),
  })

  if (layout === 'bar') {
    return (
      <nav className="hidden justify-center gap-0.5 md:flex">
        {TABS.map((t) => {
          const { href, active, isDirty } = resolve(t)
          return (
            <Link
              key={t.seg || 'analytics'}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'group relative inline-flex items-center rounded-lg px-2.5 py-2.5 transition-colors',
                active ? 'text-accent' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={22} />
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
            key={t.seg || 'analytics'}
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
