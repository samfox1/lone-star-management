'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkline } from '@/components/ui/charts'
import { KLabel } from '@/components/ui/ui'

/**
 * A 30-day activity sparkline for one item, shown inside its edit modal. Fetches
 * daily counts for the given entity ids (a release passes its own id + its tracks')
 * via the owner-read analytics_entity_daily RPC, on open. Renders the shared
 * Sparkline (flat baseline until traffic accrues) + the window total. Client fetch,
 * so it only runs when a manager actually opens the item.
 */
export function EntitySparkline({
  artistId,
  entityIds,
  label,
}: {
  artistId: string
  entityIds: string[]
  label: string
}) {
  const [series, setSeries] = useState<number[] | null>(null)
  const [total, setTotal] = useState(0)
  const key = entityIds.join(',')

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 30 * 86_400_000)
    createClient()
      .rpc('analytics_entity_daily', {
        p_artist_id: artistId,
        p_entity_ids: entityIds,
        p_since: since.toISOString(),
      })
      .then(
        ({ data }) => {
          if (!alive) return
          const byDay = new Map(
            ((data ?? []) as { day: string; count: number }[]).map((r) => [r.day, Number(r.count)]),
          )
          const days: number[] = []
          let sum = 0
          for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
            const c = byDay.get(d) ?? 0
            days.push(c)
            sum += c
          }
          setSeries(days)
          setTotal(sum)
        },
        () => {},
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId, key])

  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <KLabel>{label}</KLabel>
        <span className="font-space text-lg font-bold tabular-nums">{total.toLocaleString()}</span>
      </div>
      <Sparkline
        values={series ?? undefined}
        width={280}
        height={30}
        className="mt-2 w-full text-ink-faint"
      />
    </div>
  )
}
