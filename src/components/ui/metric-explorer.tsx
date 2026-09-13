'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { metricFacts, type Metric, type MetricKey, type TimelineDay } from '@/lib/analytics'
import { formatTrend, trendTextClass } from '@/lib/format'
import { TimelineChart } from '@/components/ui/timeline-chart'

/**
 * One chart, one metric at a time, the facts about it beside it.
 *
 * Sam, 2026-09-13: rather than a tile per metric, a row above where you pick
 * the metric, a taller and narrower chart of just that one, and its totals to
 * the right — total over the window, the change on the window before, the best
 * day, the daily average. Every number here is derived from the same zero-filled
 * series the chart draws, so the two can never disagree.
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
  windowLabel,
  extras = {},
  className,
}: {
  metrics: Metric[]
  timeline: TimelineDay[]
  prevTotals: Record<MetricKey, number>
  visitorsSince?: string
  /** "30 days", for the stat labels. */
  windowLabel: string
  extras?: Partial<Record<MetricKey, MetricExtra[]>>
  className?: string
}) {
  const [key, setKey] = useState<MetricKey>('views')
  const metric = metrics.find((m) => m.key === key) ?? metrics[0]
  const facts = metricFacts(metric, timeline.map((d) => d.day), prevTotals[metric.key] ?? 0)
  const trend = facts.delta === null ? null : formatTrend(facts.delta)
  const fmt = (n: number) => n.toLocaleString('en-US')

  return (
    <div className={className}>
      {/* The row where the metric is chosen. Label and total: the number is what
          you are choosing between, so it belongs on the control. */}
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Metric">
        {metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === metric.key}
            onClick={() => setKey(m.key)}
            className={cx(
              'flex items-baseline gap-2 rounded-full px-3 py-1 font-space text-[11px] uppercase tracking-[0.1em] transition-colors',
              m.key === metric.key ? 'bg-ink text-paper' : 'text-ink-faint hover:bg-surface-hover',
            )}
          >
            {m.label}
            <span className={cx('tabular-nums', m.key === metric.key ? 'text-paper/70' : 'text-ink-faint')}>{fmt(m.total)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <TimelineChart
          points={timeline}
          height={340}
          visitorsSince={visitorsSince}
          primary={{ label: metric.label, values: metric.series }}
          showVisitors={metric.key === 'views'}
          className="lg:col-span-2"
        />

        {/* The facts. The total is the headline; everything under it is a way of
            reading the same series. */}
        <div role="tabpanel" aria-label={`${metric.label} facts`} className="flex flex-col gap-5 rounded-2xl bg-surface p-5">
          <div>
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {metric.label} · {windowLabel}
            </div>
            <div className="mt-2 font-space text-[44px] font-bold leading-none tracking-[-0.015em] tabular-nums text-ink">
              {fmt(facts.total)}
            </div>
            <div className="mt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {trend ? (
                <>
                  <span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(trend.dir))}>{trend.label}</span>
                  {' '}vs the {windowLabel} before · {fmt(prevTotals[metric.key] ?? 0)}
                </>
              ) : (
                <>Nothing in the {windowLabel} before to compare against</>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-hairline pt-4">
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
