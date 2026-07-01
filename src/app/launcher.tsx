'use client'

import { useState } from 'react'
import Link from 'next/link'
import { logout } from '@/app/auth-actions'
import { compactNumber, formatTrend, trendTextClass } from '@/lib/format'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'
import { Avatar, KLabel, initials } from '@/components/ui/ui'

type LaunchArtist = { id: string; name: string; slug: string; views: number; trend: number | null }

const CHIPS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Roster', icon: 'roster', href: '/roster' },
  { label: 'Analytics', icon: 'analytics', href: '/analytics' },
  { label: 'Releases', icon: 'releases', href: '/releases' },
  { label: 'Tour', icon: 'tour', href: '/tour' },
  { label: 'Videos', icon: 'videos', href: '/videos' },
]

/**
 * The manager's landing launcher (the first screen after sign-in): command
 * search over the roster, jump-to-section chips, and recent-artist cards. The
 * full roster grid lives at /roster; the app's top-bar search returns here.
 */
export function Launcher({ artists, email }: { artists: LaunchArtist[]; email: string | null }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const filtered = artists.filter(
    (a) => !needle || a.name.toLowerCase().includes(needle) || a.slug.toLowerCase().includes(needle),
  )

  return (
    <div className="font-ui text-ink flex min-h-screen flex-col items-center bg-paper px-6 py-16">
      <div className="w-full max-w-[760px]">
        <div className="text-center text-[40px] leading-none text-accent">★</div>
        <h1 className="mt-5 text-center text-[44px] font-bold tracking-[-0.02em]">
          Lone Star Management
        </h1>
        <p className="mt-3 text-center font-space text-sm text-ink-muted">
          Your roster, releases, and analytics — all in one place.
        </p>

        <div className="mt-9 flex items-center gap-3 rounded-2xl border border-hairline px-5 py-4 focus-within:border-ink-faint">
          <Icon name="search" size={20} className="text-ink-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search artists or jump to a section…"
            className="flex-1 bg-transparent font-space text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded-md border border-hairline px-1.5 py-0.5 font-space text-[11px] text-ink-faint">
            ⌘K
          </kbd>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {CHIPS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline px-4 py-2.5 font-space text-[13px] text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
            >
              <Icon name={c.icon} size={16} /> {c.label}
            </Link>
          ))}
        </div>

        <div className="mt-11">
          <KLabel>Your artists</KLabel>
          {filtered.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-hairline px-4 py-8 text-center font-space text-sm text-ink-muted">
              {needle ? 'No artists match.' : 'No artists yet — request one from the roster.'}
            </p>
          ) : (
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {filtered.map((a) => {
                const tr = formatTrend(a.trend)
                return (
                <Link
                  key={a.id}
                  href={`/artists/${a.id}`}
                  className="flex items-center gap-3.5 rounded-xl border border-hairline px-5 py-4 transition-colors hover:bg-surface-hover"
                >
                  <Avatar initials={initials(a.name)} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{a.name}</div>
                    <div className="font-space text-xs text-ink-muted">/{a.slug}</div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="font-space text-[17px] font-bold tabular-nums tracking-[-0.01em]">
                        {compactNumber(a.views)}
                      </span>
                      <span className={cx('font-space text-xs', trendTextClass(tr.dir))}>
                        {tr.label}
                      </span>
                    </div>
                  </div>
                </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-12 font-space text-xs text-ink-faint">
        Signed in as {email ?? 'you'} —{' '}
        <form action={logout} className="inline">
          <button type="submit" className="text-ink-muted underline transition-colors hover:text-ink">
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
