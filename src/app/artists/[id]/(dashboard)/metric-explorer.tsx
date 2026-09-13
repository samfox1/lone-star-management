'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { OVERLAYS, WINDOW_OPTIONS, metricFacts, type Metric, type MetricKey, type TimelineDay } from '@/lib/analytics'
import { formatTrend, trendTextClass } from '@/lib/format'
import { TimelineChart, type Series } from '@/components/ui/timeline-chart'
import { Segmented } from './segmented'

/**
 * The views chart, with visitors and bots as toggles onto the same chart, and
 * the facts about what is drawn beside it.
 *
 * Sam, 2026-09-13: "this chart should just be for views, and then the user can
 * toggle on unique visitors and bots onto the same chart with a different
 * colored line. It's all one chart." So: views is always drawn, in blue with the
 * fill; visitors overlay in red; bots in ink. One scale, one legend.
 *
 * The toggles and the window switch share one row and one control language —
 * the dashboard's `Segmented` and a multi-select built from its classes — so
 * they read as the two halves of a single question: WHAT is drawn, over HOW
 * LONG. The window lives in the URL because the server reads it.
 *
 * Facts beside the chart: the views total, its change on the prior window,
 * best day, per day; then one block per toggled series. Visitors and bots exist
 * only from the 2026-09-12 cut-over, so their per-day figures divide by the
 * counted days, and nothing said in the legend is said again in the panel.
 */
export type MetricExtra = { label: string; value: string }

const COLOR: Record<string, Series['color']> = { views: 'accent', visitors: 'accent-red', bots: 'ink' }

export function MetricExplorer({
  metrics,
  timeline,
  prevTotals,
  countedSince,
  windowKey,
  days,
  extras = {},
  className,
}: {
  metrics: Metric[]
  timeline: TimelineDay[]
  prevTotals: Record<MetricKey, number>
  /** The first day the overlays (visitors, bots) were counted. */
  countedSince?: string
  windowKey: string
  days: number
  extras?: Partial<Record<MetricKey, MetricExtra[]>>
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [on, setOn] = useState<Set<MetricKey>>(() => new Set())
  const allTime = windowKey === 'all'
  const windowLabel = allTime ? 'all time' : `${days}d`
  const fmt = (n: number) => n.toLocaleString('en-US')
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m])) as Record<MetricKey, Metric>
  const days_ = timeline.map((d) => d.day)

  const views = byKey.views
  const drawn = [views, ...OVERLAYS.filter((k) => on.has(k)).map((k) => byKey[k])].filter(Boolean)
  const series: Series[] = drawn.map((m) => ({
    key: m.key, label: m.label, values: m.series, color: COLOR[m.key] ?? 'ink',
    since: m.key === 'views' ? undefined : countedSince,
  }))

  /** Facts over the days a metric was counted — the whole window for views, from the cut-over for the rest. */
  const factsFor = (m: Metric) => {
    const since = m.key === 'views' ? undefined : countedSince
    const idx = days_.map((_, i) => i).filter((i) => !since || days_[i] >= since)
    return metricFacts({ ...m, series: idx.map((i) => m.series[i]) }, idx.map((i) => days_[i]), prevTotals[m.key] ?? 0)
  }
  const vf = factsFor(views)
  const vt = vf.delta === null ? null : formatTrend(vf.delta)
  const toggle = (k: MetricKey) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Multi-select in the Segmented's own clothes: same container, same
            active fill, but each segment is its own on/off. */}
        <div role="group" aria-label="Series" className="inline-flex flex-none gap-0.5 rounded-lg border border-hairline p-0.5">
          <span className="rounded-md bg-ink px-2.5 py-1 font-space text-xs font-semibold text-white" aria-hidden>Views</span>
          {OVERLAYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={on.has(k)}
              onClick={() => toggle(k)}
              className={cx(
                'rounded-md px-2.5 py-1 font-space text-xs transition-colors',
                on.has(k) ? 'bg-ink font-semibold text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {byKey[k]?.label ?? k}
            </button>
          ))}
        </div>
        <Segmented
          label="Window"
          options={WINDOW_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
          value={windowKey}
          onChange={(k) => router.push(`${pathname}?days=${k}`)}
        />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-4">
        <TimelineChart points={timeline} height={420} series={series} className="lg:col-span-3" />

        <div role="region" aria-label="Facts" className="flex flex-col gap-5 rounded-2xl bg-surface p-5">
          <div>
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Views · {windowLabel}</div>
            <div className="mt-2 font-space text-[44px] font-bold leading-none tracking-[-0.015em] tabular-nums text-ink">{fmt(vf.total)}</div>
            {!allTime && (
              <div className="mt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {vt ? (
                  <><span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(vt.dir))}>{vt.label}</span> vs prior {windowLabel}</>
                ) : (
                  <>No prior {windowLabel}</>
                )}
              </div>
            )}
          </div>

          <dl className="flex flex-col gap-4 border-t border-hairline pt-4">
            <Fact label="Best day" value={vf.bestDay ? `${dayLabel(vf.bestDay.day)} · ${fmt(vf.bestDay.value)}` : '—'} />
            <Fact label="Per day" value={perDay(vf.perDay)} />
            {(extras.views ?? []).map((e) => <Fact key={e.label} label={e.label} value={e.value} />)}
          </dl>

          {drawn.slice(1).map((m) => {
            const f = factsFor(m)
            return (
              <dl key={m.key} data-facts={m.key} className="flex flex-col gap-4 border-t border-hairline pt-4">
                <Fact label={m.label} value={fmt(f.total)} />
                <Fact label="Per day" value={perDay(f.perDay)} />
                {(extras[m.key] ?? []).map((e) => <Fact key={e.label} label={e.label} value={e.value} />)}
              </dl>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const perDay = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))

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
