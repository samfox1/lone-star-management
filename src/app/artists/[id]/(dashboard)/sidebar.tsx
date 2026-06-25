'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = { label: string; seg: string }

const NAV: NavItem[] = [
  { label: 'Overview', seg: '' },
  { label: 'Tracks', seg: 'tracks' },
  { label: 'Videos', seg: 'videos' },
  { label: 'Tour', seg: 'tour' },
  { label: 'Merch', seg: 'merch' },
  { label: 'Releases', seg: 'releases' },
  { label: 'Links', seg: 'links' },
  { label: 'Site', seg: 'site' },
  { label: 'Settings', seg: 'settings' },
]

/** Left nav for one artist. A filled dot marks a route segment with unpublished
 *  edits (`dirty` is keyed by segment — see dirtyBySeg; Settings is config). */
export function Sidebar({
  artistId,
  artistName,
  dirty,
}: {
  artistId: string
  artistName: string
  dirty: Record<string, boolean>
}) {
  const pathname = usePathname()
  const base = `/artists/${artistId}`

  return (
    <nav className="flex w-52 flex-col border-r border-zinc-200 bg-white px-3 py-4 dark:border-zinc-800 dark:bg-zinc-950">
      <Link
        href="/"
        className="px-3 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Your artists
      </Link>
      <div className="mt-3 truncate px-3 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {artistName}
      </div>

      <ul className="mt-4 space-y-0.5">
        {NAV.map((item) => {
          const href = item.seg ? `${base}/${item.seg}` : base
          const active = item.seg ? pathname.startsWith(href) : pathname === base
          const isDirty = item.seg ? (dirty[item.seg] ?? false) : false
          return (
            <li key={item.seg || 'overview'}>
              <Link
                href={href}
                className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/50'
                }`}
              >
                {item.label}
                {isDirty && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    title="Unpublished changes"
                  />
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
