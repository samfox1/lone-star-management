'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { METRICS, OVERLAYS, WINDOW_OPTIONS, metricFacts, previousWindow, type Metric, type MetricKey, type TimelineDay } from '@/lib/analytics'
import { formatTrend, growthSize } from '@/lib/format'
import { ChartLegend, TimelineChart, type ChartPin, type Series, type SeriesColor } from '@/components/ui/timeline-chart'
import { FactsColumn, type Fact } from '@/components/ui/facts-column'
import { analyticsPins, type PinKind } from '@/lib/analytics-pins'
import type { IconName } from '@/components/ui/icons'
import { AllDays } from '@/components/ui/analytics-sheets'
import { Segmented } from './segmented'

/**
 * The views chart, with every other counted line as a toggle onto the same chart,
 * and the numbers for what is drawn beside it.
 *
 * Sam, 2026-09-13: "this chart should just be for views, and then the user can
 * toggle on unique visitors and bots onto the same chart with a different
 * colored line. It's all one chart." Since the r12 mock (2026-10-06) song plays
 * and link clicks are toggles too (`OVERLAYS`, from the registry), off by default;
 * visitors and bots on.
 *
 * One row above the chart: the toggles as square checks on the left and the window
 * switch (the dashboard's `Segmented`) on the right. WHAT is drawn, over HOW LONG.
 * The window lives in the URL because the server reads it.
 *
 * The numbers column beside the chart lists EVERY drawn line, each with its total,
 * its per-day average and, under that, its change on the prior window (Sam: "show
 * all of them but keep it to just total and per day avg"; "show ▼ 31.9% vs prior
 * 7d … below the per day stat"). No best day. The column shares the chart's height
 * and never makes the row taller (Sam: "I dont want selecting more views to push the
 * right column below the chart"): the more lines, the smaller each number.
 *
 * Visitors and bots exist only from the 2026-09-12 cut-over (`since: 'context'` in
 * the registry), so their numbers are taken over the counted days, and their change
 * is withheld until the prior window was wholly counted — two counted days against a
 * prior window of none would print a gain that is not there. A change with nothing
 * to compare against is not printed at all (Sam: "if the data hasnt been collected
 * long enough to see this, then remove it").
 */
const COLOR: Record<string, SeriesColor> = { views: 'accent', visitors: 'accent-red', bots: 'ink', plays: 'chart-4', link_clicks: 'chart-5' }
const META = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, (typeof METRICS)[number]>
/** Each kind of pin's glyph. */
const PIN_ICON: Record<PinKind, IconName> = { counting: 'user', busiest: 'bolt', bots: 'robot' }

export function MetricExplorer({
  metrics,
  timeline,
  prevTotals,
  countedSince,
  windowKey,
  days,
  partialLast = false,
  className,
}: {
  metrics: Metric[]
  timeline: TimelineDay[]
  prevTotals: Record<MetricKey, number>
  /** The first day the cut-over metrics (visitors, bots) were counted. */
  countedSince?: string
  windowKey: string
  days: number
  /** The window's last day is today, still being counted. */
  partialLast?: boolean
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  // Visitors and bots on by default (Sam, 2026-09-13); the rest off.
  const [on, setOn] = useState<Set<MetricKey>>(() => new Set<MetricKey>(['visitors', 'bots']))
  const allTime = windowKey === 'all'
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m])) as Record<MetricKey, Metric>
  const days_ = timeline.map((d) => d.day)
  const sinceOf = (k: MetricKey) => (META[k].since === 'context' ? countedSince : undefined)

  const drawn = [byKey.views, ...OVERLAYS.filter((k) => on.has(k)).map((k) => byKey[k])].filter(Boolean)
  const series: Series[] = drawn.map((m) => ({
    key: m.key, label: META[m.key].label, values: m.series, color: COLOR[m.key] ?? 'ink', since: sinceOf(m.key),
  }))

  // The prior window is comparable for a cut-over metric only if it was counted throughout.
  const prior = days_.length ? previousWindow({ since: days_[0], until: days_[days_.length - 1], days }) : null
  const priorCounted = !countedSince || (prior !== null && prior.since >= countedSince)

  /** Numbers over the days a metric was counted: the whole window, or from the cut-over. */
  const factsFor = (m: Metric) => {
    const since = sinceOf(m.key)
    const idx = days_.map((_, i) => i).filter((i) => !since || days_[i] >= since)
    const comparable = !allTime && (since === undefined || priorCounted)
    const f = metricFacts({ ...m, series: idx.map((i) => m.series[i]) }, idx.map((i) => days_[i]), comparable ? (prevTotals[m.key] ?? 0) : 0)
    return { ...f, delta: comparable ? f.delta : null }
  }
  // Every day, every line the chart can draw, drawn or not: the table is the whole record.
  const allDays = (
    <AllDays
      days={days_}
      lines={[byKey.views, ...OVERLAYS.map((k) => byKey[k])].filter(Boolean).map((m) => ({ key: m.key, label: META[m.key].short, values: m.series, since: sinceOf(m.key) }))}
    />
  )
  // The moments worth marking, from the window's own numbers (lib/analytics-pins.ts); the chart
  // shows each only while its line is drawn.
  const pins: ChartPin[] = analyticsPins({ days: days_, views: byKey.views?.series ?? [], bots: byKey.bots?.series ?? [], countedSince })
    .map((p) => ({ day: p.day, series: p.series, icon: PIN_ICON[p.kind], title: p.title, note: p.note }))
  const toggle = (k: MetricKey) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Add-ons only — views is always drawn and needs no switch. Each is a
            small square check beside its name, not a button drawn around the
            text (Sam, 2026-09-13). ONE control per overlay, square and name
            together: a label forwarding to a separate button fired twice. */}
        <div role="group" aria-label="Series" className="flex flex-wrap items-center gap-5">
          {OVERLAYS.map((k) => (
            <button
              key={k}
              type="button"
              role="checkbox"
              aria-checked={on.has(k)}
              aria-label={META[k].label}
              onClick={() => toggle(k)}
              className="group flex cursor-pointer select-none items-center gap-2 font-space text-xs text-ink"
            >
              <span
                aria-hidden
                className={cx(
                  'flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors',
                  on.has(k) ? 'border-ink bg-ink text-white' : 'border-hairline bg-paper group-hover:border-ink-faint',
                )}
              >
                {on.has(k) && (
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    <path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span>{META[k].label}</span>
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

      {/* The legend gets its own row across the chart AND the numbers, so ALL DAYS sits at the
          page's right edge like ALL SOURCES and ALL COUNTRIES below (Sam, 2026-10-06). */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ChartLegend series={series} />
        {allDays}
      </div>

      {/* The column is as wide as its widest number and no wider; the chart takes
          the rest (Sam, 2026-09-13: "make the right container smaller"). From lg up
          the column is laid absolutely in its cell, so however many lines are on it
          adds no height of its own. Keyed by the window, so a new window draws on. */}
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
        <TimelineChart key={windowKey} points={timeline} height={400} series={series} partialFrom={partialLast ? timeline.length - 1 : undefined} legend={false} pins={pins} className="min-w-0" />

        <FactsColumn facts={drawn.map((m): Fact => {
          const f = factsFor(m)
          const t = f.delta === null ? null : formatTrend(f.delta)
          return {
            key: m.key, label: META[m.key].short, swatch: COLOR[m.key] ?? 'ink', value: f.total,
            sub: { label: 'Per day', value: perDay(f.perDay) },
            growth: t && { dir: t.dir, size: growthSize(f.delta!), tail: `vs prior ${days}d`, tailShort: `vs ${days}d` },
          }
        })} />
      </div>
    </div>
  )
}

const perDay = (n: number) => (n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))
