import type { ReactNode } from 'react'
import { KLabel } from '@/components/ui/ui'

/**
 * The count + affordance strip above a content grid (Merch / Videos / Tour). The
 * count uses KLabel so it reads identically to the Tracks header; the right slot
 * holds a sync indicator or an affordance.
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
