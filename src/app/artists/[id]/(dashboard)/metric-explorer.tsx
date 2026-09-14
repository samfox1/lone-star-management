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
/** The facts tabs are one word each; the toggles and legend keep the full names. */
const SHORT: Record<string, string> = { views: 'Views', visitors: 'Visitors', bots: 'Bots' }

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
  const [shownKey, setShownKey] = useState<MetricKey>('views')
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
  // The column shows ONE drawn series at a time, picked by its tab. A series
  // switched off while it was showing falls back to views.
  const shown = drawn.find((m) => m.key === shownKey) ?? views
  const sf = factsFor(shown)
  const st = sf.delta === null ? null : formatTrend(sf.delta)
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

      {/* The column is as wide as its widest number and no wider; the chart takes
          the rest (Sam, 2026-09-13: "make the right container smaller"). */}
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
        <TimelineChart points={timeline} height={400} series={series} className="min-w-0" />

        {/* The facts beside the chart, filling its height, ONE series at a time:
            when an overlay is drawn its name appears as a tab up here, and the
            column shows whichever is picked. Stacking every series overflowed the
            column (Sam, 2026-09-13). No box, no fill. */}
        <div role="region" aria-label="Facts" className="flex flex-col text-right">
          {drawn.length > 1 && (
            <div role="tablist" aria-label="Facts for" className="mb-3 flex flex-wrap justify-end gap-x-4 gap-y-1 border-b border-hairline">
              {drawn.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={m.key === shown.key}
                  onClick={() => setShownKey(m.key)}
                  className={cx(
                    '-mb-px border-b-2 pb-1.5 font-space text-[10px] font-bold uppercase tracking-[0.12em] transition-colors',
                    m.key === shown.key ? 'border-ink text-ink' : 'border-transparent text-ink-faint hover:text-ink',
                  )}
                >
                  {SHORT[m.key] ?? m.label}
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {allTime ? 'Total · all time' : 'Total'}
            </div>
            <div className="mt-2 font-space text-[52px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">{fmt(sf.total)}</div>
            {!allTime && (st || shown.key === 'views') && (
              <div className="mt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {st ? (
                  <><span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(st.dir))}>{st.label}</span> vs prior {windowLabel}</>
                ) : (
                  <>No prior {windowLabel}</>
                )}
              </div>
            )}
          </div>

          <dl className="mt-4 flex flex-1 flex-col divide-y divide-hairline border-t border-hairline">
            <Fact label="Best day" value={sf.bestDay ? dayLabel(sf.bestDay.day) : '—'} />
            <Fact label="Per day" value={perDay(sf.perDay)} />
            {(extras[shown.key] ?? []).map((e) => <Fact key={e.label} label={e.label} value={e.value} />)}
          </dl>
        </div>
      </div>
    </div>
  )
}

/** One fact as a row that grows to share the column's height with its siblings. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col items-end justify-center py-3">
      <dt className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate font-space text-[22px] font-bold leading-none tabular-nums text-ink">{value}</dd>
    </div>
  )
}

const perDay = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}
