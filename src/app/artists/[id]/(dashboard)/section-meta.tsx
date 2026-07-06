import Link from 'next/link'
import type { ReactNode } from 'react'
import { KLabel } from '@/components/ui/ui'

/**
 * The count + affordance strip above a content grid (Merch / Videos / Tour). The
 * count uses KLabel so it reads identically to the Tracks header; the right slot
 * holds a ConnectLink to the Integrations hub or a sync indicator.
 */
export function SectionMeta({
  count,
  singular,
  plural,
  children,
}: {
  count: number
  singular: string
  plural: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <KLabel>
        {count} {count === 1 ? singular : plural}
      </KLabel>
      {children}
    </div>
  )
}

/** Muted underline-on-hover link into the Integrations hub. */
export function ConnectLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-space text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
    >
      {children}
    </Link>
  )
}
