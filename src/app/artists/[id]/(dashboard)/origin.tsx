import type { ReactNode } from 'react'
import { KLabel } from '@/components/ui/ui'

/**
 * A content page groups its assets by ORIGIN — where they came from and, crucially,
 * what embedding rules they carry (a YouTube clip vs a self-hosted upload vs a
 * Shopify-synced product). Videos group by `provider`, everything else by `source`.
 * Each group is a labelled section (mono header + hairline rule + count).
 */
export function OriginSection({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <KLabel>{label}</KLabel>
        <div className="h-px flex-1 bg-hairline" />
        <span className="font-space text-[10px] tabular-nums text-ink-faint">{count}</span>
      </div>
      {children}
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
