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
        {/* Add-ons only — views is always drawn and needs no switch. Two separate
            buttons, each its own on/off in the Segmented's clothes, not one shared
            container: they are not a choice between two things. */}
        <div role="group" aria-label="Series" className="flex flex-wrap items-center gap-2">
          {OVERLAYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={on.has(k)}
              onClick={() => toggle(k)}
              className={cx(
                'rounded-lg border px-3 py-1.5 font-space text-xs transition-colors',
                on.has(k) ? 'border-ink bg-ink font-semibold text-white' : 'border-hairline text-ink-muted hover:text-ink',
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

      <TimelineChart points={timeline} height={380} series={series} className="mt-4" />

      {/* The facts as one strip under the chart, not a column beside it: a column
          sat two-thirds empty whenever only views was drawn (Sam, 2026-09-13:
          "use the space better"). The views total leads; each toggled series adds
          its own cells to the same row. No container — the hairline does the work. */}
      <div role="region" aria-label="Facts" className="mt-5 flex flex-wrap items-stretch gap-y-4 border-t border-hairline pt-4">
        <div className="flex min-w-[180px] flex-col justify-center pr-8">
          <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Views · {windowLabel}</div>
          <div className="mt-1 font-space text-[34px] font-bold leading-none tracking-[-0.015em] tabular-nums text-ink">{fmt(vf.total)}</div>
          {!allTime && (
            <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {vt ? (
                <><span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(vt.dir))}>{vt.label}</span> vs prior {windowLabel}</>
              ) : (
                <>No prior {windowLabel}</>
              )}
            </div>
          )}
        </div>

        <Cell label="Best day" value={vf.bestDay ? `${dayLabel(vf.bestDay.day)} · ${fmt(vf.bestDay.value)}` : '—'} />
        <Cell label="Per day" value={perDay(vf.perDay)} />
        {(extras.views ?? []).map((e) => <Cell key={e.label} label={e.label} value={e.value} />)}

        {drawn.slice(1).map((m) => {
          const f = factsFor(m)
          return (
            <div key={m.key} data-facts={m.key} className="flex flex-wrap">
              <Cell label={m.label} value={fmt(f.total)} accent />
              <Cell label="Per day" value={perDay(f.perDay)} />
              {(extras[m.key] ?? []).map((e) => <Cell key={e.label} label={e.label} value={e.value} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One fact in the strip, ruled from its neighbour by a hairline on the left. */
function Cell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cx('flex min-w-[120px] flex-col justify-center border-l border-hairline px-6', accent && 'border-l-ink')}>
      <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</div>
      <div className="mt-1 whitespace-nowrap font-space text-[17px] font-bold tabular-nums text-ink">{value}</div>
    </div>
  )
}

const perDay = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}
