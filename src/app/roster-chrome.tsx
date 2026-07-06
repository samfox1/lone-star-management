import type { ReactNode } from 'react'
import Link from 'next/link'
import { AppShell, Wordmark, type NavItem } from '@/components/ui/app-shell'
import { Avatar, initials } from '@/components/ui/ui'
import { Icon, type IconName } from '@/components/ui/icons'

/**
 * Shared chrome for the roster context: the centered top-nav (Roster + the
 * roster-wide section pages) and the tools cluster (settings gear → /account,
 * avatar → /account). Sign-out lives on /account. Mirrors the prototype's
 * `.topbar` so every roster-level page shares one shell.
 */
export type RosterSection = 'roster' | 'analytics' | 'releases' | 'tour' | 'videos' | 'merch' | 'book'

const NAV: { key: RosterSection; label: string; icon: IconName; href: string }[] = [
  { key: 'roster', label: 'Roster', icon: 'roster', href: '/roster' },
  { key: 'analytics', label: 'Analytics', icon: 'analytics', href: '/analytics' },
  { key: 'tour', label: 'Tour', icon: 'tour', href: '/tour' },
  { key: 'videos', label: 'Videos', icon: 'videos', href: '/videos' },
  { key: 'merch', label: 'Merch', icon: 'merch', href: '/merch' },
  { key: 'book', label: 'Book', icon: 'list', href: '/book' },
]

function rosterNav(active?: RosterSection): NavItem[] {
  return NAV.map((n) => ({ label: n.label, icon: n.icon, href: n.href, active: n.key === active }))
}

function RosterTools({ email }: { email: string | null }) {
  return (
    <>
      <Link href="/" title="Home / search" className="inline-flex text-ink-muted transition-colors hover:text-ink">
        <Icon name="search" size={18} />
      </Link>
      <Link href="/account" title="Settings" className="inline-flex text-ink-muted transition-colors hover:text-ink">
        <Icon name="settings" size={18} />
      </Link>
      <Link href="/account" title={email ?? 'Account'}>
        <Avatar initials={initials(email ?? '?')} size={30} />
      </Link>
    </>
  )
}

/**
 * Wraps a roster-level page in the shared shell: brand (links home), centered nav
 * with `active` lit, tools. `page` is the wordmark suffix ("Lone Star <page>").
 */
export function RosterShell({
  active,
  page,
  email,
  children,
}: {
  active?: RosterSection
  page: string
  email: string | null
  children: React.ReactNode
}) {
  return (
    <AppShell
      brand={
        <Link href="/roster" title="Back to roster">
          <Wordmark page={page} />
        </Link>
      }
      items={rosterNav(active)}
      tools={<RosterTools email={email} />}
    >
      {children}
    </AppShell>
  )
}

/** Roster section page header: 19px title on the left, optional actions on the right. */
export function SectionToolbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 px-7 pb-2 pt-6">
      <h1 className="text-[19px] font-bold tracking-[-0.01em]">{title}</h1>
      <div className="flex-1" />
      {children}
    </div>
  )
}

/** Centered empty state for a roster section with no items (mirrors `.secph`). */
export function EmptyState({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <Icon name={icon} size={44} className="text-ink-faint" />
      <h3 className="mt-4 text-[17px] font-bold">{title}</h3>
      <p className="mt-1.5 max-w-sm font-space text-xs leading-relaxed text-ink-muted">{sub}</p>
    </div>
  )
}
