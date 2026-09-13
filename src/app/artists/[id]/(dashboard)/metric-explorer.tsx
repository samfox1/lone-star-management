'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { WINDOW_OPTIONS, metricFacts, type Metric, type MetricKey, type TimelineDay } from '@/lib/analytics'
import { formatTrend, trendTextClass } from '@/lib/format'
import { TimelineChart } from '@/components/ui/timeline-chart'
import { Segmented } from './segmented'

/**
 * One chart, one metric at a time, the facts about it beside it.
 *
 * Sam, 2026-09-13: rather than a tile per metric, a row above where you pick
 * the metric, a taller and narrower chart of just that one, and its totals to
 * the right — total over the window, the change on the window before, the best
 * day, the daily average. Every number here is derived from the same zero-filled
 * series the chart draws, so the two can never disagree.
 *
 * The metric switch and the window switch share one row and one control — the
 * dashboard's `Segmented` — so they read as the two halves of a single question:
 * WHICH number, over HOW LONG. The window lives in the URL (`?days=`) because the
 * server reads it; the control only navigates.
 *
 * Views is the default because it is the one series that runs unbroken across
 * the 2026-09-12 cut-over. Choosing Views keeps the visitors line on the chart;
 * choosing anything else charts that metric alone — plays against visitors is
 * not a comparison anyone makes.
 *
 * `extra` carries the one metric-specific fact the data can back: how many plays
 * named a song, how many ticket clicks named a date. Nothing per-source, nothing
 * per-city: those tallies do not exist and the card does not pretend they do.
 */
export type MetricExtra = { label: string; value: string }

export function MetricExplorer({
  metrics,
  timeline,
  prevTotals,
  visitorsSince,
  windowKey,
  days,
  extras = {},
  className,
}: {
  metrics: Metric[]
  timeline: TimelineDay[]
  prevTotals: Record<MetricKey, number>
  visitorsSince?: string
  /** The window in force: its `?days=` key and the days it resolved to. */
  windowKey: string
  days: number
  extras?: Partial<Record<MetricKey, MetricExtra[]>>
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const allTime = windowKey === 'all'
  const windowLabel = allTime ? 'all time' : `${days}d`
  const [key, setKey] = useState<MetricKey>('views')
  const metric = metrics.find((m) => m.key === key) ?? metrics[0]
  const facts = metricFacts(metric, timeline.map((d) => d.day), prevTotals[metric.key] ?? 0)
  const trend = facts.delta === null ? null : formatTrend(facts.delta)
  const fmt = (n: number) => n.toLocaleString('en-US')

  return (
    <div className={className}>
      {/* WHICH number, over HOW LONG: one row, one control language. Labels only —
          the numbers live in the panel, where they can be read against each other. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Metric"
          options={metrics.map((m) => ({ key: m.key, label: m.label }))}
          value={metric.key}
          onChange={setKey}
        />
        <Segmented
          label="Window"
          options={WINDOW_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
          value={windowKey}
          onChange={(k) => router.push(`${pathname}?days=${k}`)}
        />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-4">
        <TimelineChart
          points={timeline}
          height={420}
          visitorsSince={visitorsSince}
          primary={{ label: metric.label, values: metric.series }}
          showVisitors={metric.key === 'views'}
          className="lg:col-span-3"
        />

        {/* One column of facts. The total leads; the rest are ways of reading the
            same series. Nothing here is also said on the chart. */}
        <div role="region" aria-label={`${metric.label} facts`} className="flex flex-col gap-5 rounded-2xl bg-surface p-5">
          <div>
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {metric.label} · {windowLabel}
            </div>
            <div className="mt-2 font-space text-[44px] font-bold leading-none tracking-[-0.015em] tabular-nums text-ink">
              {fmt(facts.total)}
            </div>
            {!allTime && (
              <div className="mt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {trend ? (
                  <>
                    <span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(trend.dir))}>{trend.label}</span>
                    {' '}vs prior {windowLabel}
                  </>
                ) : (
                  <>No prior {windowLabel}</>
                )}
              </div>
            )}
          </div>

          <dl className="flex flex-col gap-4 border-t border-hairline pt-4">
            <Fact label="Best day" value={facts.bestDay ? `${dayLabel(facts.bestDay.day)} · ${fmt(facts.bestDay.value)}` : '—'} />
            <Fact label="Per day" value={facts.perDay >= 10 ? fmt(Math.round(facts.perDay)) : facts.perDay.toFixed(1)} />
            {(extras[metric.key] ?? []).map((e) => <Fact key={e.label} label={e.label} value={e.value} />)}
          </dl>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate font-space text-[15px] font-bold tabular-nums text-ink">{value}</dd>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}
