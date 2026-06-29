import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from './icons'

export type NavItem = {
  label: string
  icon: IconName
  href: string
  active?: boolean
}

/**
 * The redesigned manager shell: a top bar (brand / centered icon-nav whose
 * labels expand on hover / right-side tools) over the page content, plus a
 * fixed bottom tab bar on phones. Presentational — the caller supplies `brand`,
 * `items` (with `active` precomputed from the route) and `tools`. Scopes the
 * design-system font + colours to the manager surface via its root, so the
 * global body and the fan-facing templates are untouched.
 */
export function AppShell({
  brand,
  items,
  tools,
  children,
}: {
  brand: ReactNode
  items: NavItem[]
  tools?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="font-ui text-ink flex flex-1 flex-col bg-paper">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2">{brand}</div>

        {/* desktop nav — icons that reveal their label on hover */}
        <nav className="hidden justify-center gap-0.5 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cx(
                'group inline-flex items-center rounded-lg px-2.5 py-2.5 transition-colors',
                item.active
                  ? 'text-accent'
                  : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
              )}
            >
              <Icon name={item.icon} />
              <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs tracking-[0.02em] opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[120px] group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-3.5 text-ink-muted">{tools}</div>
      </header>

      <main className={cx('min-w-0 flex-1', items.length > 0 && 'pb-16 md:pb-0')}>
        {children}
      </main>

      {/* mobile bottom tab bar (only when there's a nav to show) */}
      {items.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-hairline bg-paper px-1 pb-3 pt-2 md:hidden">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cx(
                'flex flex-1 items-center justify-center py-2',
                item.active ? 'text-accent' : 'text-ink-muted',
              )}
            >
              <Icon name={item.icon} size={22} />
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}

/** Wordmark for roster/section context: ★ + "Lone Star <page>". */
export function Wordmark({ page }: { page: string }) {
  return (
    <span className="flex items-center gap-2 text-[15px] font-normal tracking-[-0.01em]">
      <span className="text-accent">★</span> Lone Star <b className="font-bold">{page}</b>
    </span>
  )
}
