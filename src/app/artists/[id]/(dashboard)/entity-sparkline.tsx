'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkline } from '@/components/ui/charts'
import { KLabel } from '@/components/ui/ui'
import { dayList, sumByDay } from '@/lib/analytics'

/**
 * A 30-day activity sparkline for one item, shown inside its edit modal. Fetches
 * daily counts for the given entity ids (a release passes its own id + its tracks')
 * via the owner-read analytics_entity_daily RPC, on open. Renders the shared
 * Sparkline (flat baseline until traffic accrues) + the window total. Client fetch,
 * so it only runs when a manager actually opens the item.
 *
 * Day bucketing goes through `dayList`/`sumByDay` (lib/analytics) — the same helpers
 * `roster-data.ts` uses — instead of building its own `Date.now()`-per-iteration day
 * list and Map (CODE_AUDIT.md item I): three independent copies of this math is how an
 * edge day quietly drifts between them.
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
    const list = dayList(30)
    createClient()
      .rpc('analytics_entity_daily', {
        p_artist_id: artistId,
        p_entity_ids: entityIds,
        p_since: `${list[0]}T00:00:00Z`,
      })
      .then(
        ({ data }) => {
          if (!alive) return
          const rows = (data ?? []) as { day: string; count: number }[]
          const days = sumByDay(rows, list, (r) => r.day, (r) => Number(r.count))
          setSeries(days)
          setTotal(days.reduce((n, v) => n + v, 0))
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
