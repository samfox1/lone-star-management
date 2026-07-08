'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { KLabel } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

/**
 * A content page groups its assets by ORIGIN — where they came from and, crucially,
 * what embedding rules they carry (a YouTube clip vs a self-hosted upload vs a
 * Shopify-synced product). Videos group by `provider`, music by release type,
 * everything else by `source`.
 *
 * Each group is a COLLAPSIBLE section (mono header + hairline rule + count + chevron):
 * a manager with hundreds of YouTube videos can fold that group to reach the next type
 * without scrolling past all of it. The count stays visible while collapsed.
 */
export function OriginSection({
  label,
  count,
  defaultOpen = true,
  children,
}: {
  label: string
  count: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3"
      >
        <Icon
          name="chevronRight"
          size={13}
          className={cx('flex-none text-ink-faint transition-transform group-hover:text-ink-muted', open && 'rotate-90')}
        />
        <KLabel>{label}</KLabel>
        <span className="h-px flex-1 bg-hairline" />
        <span className="font-space text-[10px] tabular-nums text-ink-faint">{count}</span>
      </button>
      {open && children}
    </section>
  )
}

export type OriginGroup<T> = { key: string; label: string; items: T[] }

/**
 * Bucket items by origin key, ordered by `order` (known origins first, in that order;
 * any unknown origin appended). Empty groups are dropped. `labelOf` names each bucket.
 */
export function groupByOrigin<T>(
  items: T[],
  originOf: (item: T) => string,
  order: readonly string[],
  labelOf: (key: string) => string,
): OriginGroup<T>[] {
  const byKey = new Map<string, T[]>()
  for (const item of items) {
    const k = originOf(item)
    const list = byKey.get(k) ?? []
    list.push(item)
    byKey.set(k, list)
  }
  const keys = [
    ...order.filter((k) => byKey.has(k)),
    ...[...byKey.keys()].filter((k) => !order.includes(k)),
  ]
  return keys.map((key) => ({ key, label: labelOf(key), items: byKey.get(key)! }))
}
