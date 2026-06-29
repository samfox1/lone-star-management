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

export function ArtistTabs({
  artistId,
  dirty,
}: {
  artistId: string
  dirty: Record<string, boolean>
}) {
  const pathname = usePathname()
  const base = `/artists/${artistId}`

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-hairline px-4">
      {TABS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base
        const active = t.seg ? pathname.startsWith(href) : pathname === base
        const isDirty = t.seg ? (dirty[t.seg] ?? false) : false
        return (
          <Link
            key={t.seg || 'overview'}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex flex-none items-center gap-2 border-b-2 px-3 py-3 font-space text-xs tracking-[0.01em] transition-colors',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {isDirty && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-status-pending"
                title="Unpublished changes"
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
