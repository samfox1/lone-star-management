'use client'

import Link from 'next/link'
import { Icon, type IconName } from '@/components/ui/icons'

/**
 * A small icon link for the toolbar trailing cluster (e.g. → Integrations). Pass a
 * short `label` and it slides open on hover (matching the Music/Videos Refresh);
 * omit it for a plain icon-only link. `title` stays the full-text tooltip.
 */
export function ToolbarIconLink({
  href,
  title,
  icon,
  label,
}: {
  href: string
  title: string
  icon: IconName
  label?: string
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
    >
      {label && (
        // Collapsed until hover, then slides open to the left.
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[120px] group-hover:pl-1 group-hover:pr-1.5">
          {label}
        </span>
      )}
      <Icon name={icon} size={15} />
    </Link>
  )
}
