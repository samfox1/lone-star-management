'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayDelta, niceCeil } from '@/lib/chart'
import { formatTrend, trendTextClass } from '@/lib/format'

/**
 * One series over the window, on a scale that starts at zero.
 *
 * Zero is load-bearing: a scale that starts at the series minimum — which the
 * older `AreaChart` does, because a sparkline only has to show shape — turns a
 * flat week into a mountain range. Drawn on paper with the same hairline grid
 * every list on the page rules with; the blue accent with a soft fill is the only
 * colour, so the chart adds none to the page.
 *
 * It used to overlay visitors on views. Visitors exist only from the 2026-09-12
 * cut-over, so the overlay drew as a near-vertical red streak in the last two
 * days of a 30-day window (Sam, 2026-09-13: "what is that awkward red line").
 * Visitors now have their own tab, and `since` lets a series start where it was
 * first counted instead of pretending the days before were zero.
 *
 * Hovering a day draws a rule through it and a readout with the value and the
 * change on the day before as a signed percent — withheld, not zeroed, when
 * yesterday was zero or does not exist (`dayDelta`).
 *
 * The table underneath is the accessible twin: every value is reachable
 * without hovering anything.
 */
export type TimelinePoint = { day: string; views: number; visitors: number }

const PAD_TOP = 8

export function TimelineChart({
  points,
  height = 260,
  primary,
  since,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  /** The series to draw: one value per point, same order. Defaults to views. */
  primary?: { label: string; values: number[] }
  /** The first day this series was counted. Earlier days are not drawn — a zero
   *  there would be a lie, the number was never taken — and a label says so. */
  since?: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)

  const w = 600
  const h = height
  const label = primary?.label ?? 'Views'
  const valueAt = (i: number) => (primary ? (primary.values[i] ?? 0) : points[i].views)
  const firstIdx = since ? points.findIndex((p) => p.day >= since) : 0
  const counted = (i: number) => firstIdx >= 0 && i >= firstIdx
  const peak = Math.max(0, ...points.map((_, i) => (counted(i) ? valueAt(i) : 0)))
  const top = niceCeil(peak)
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => PAD_TOP + (1 - v / top) * (h - PAD_TOP)
  const drawn = points.map((_, i) => i).filter(counted)
  const path = drawn.map((i) => `${x(i).toFixed(1)},${y(valueAt(i)).toFixed(1)}`).join(' ')
  const area = drawn.length
    ? `${path} ${x(drawn[drawn.length - 1]).toFixed(1)},${h} ${x(drawn[0]).toFixed(1)},${h}`
    : ''
  const startsLate = firstIdx > 0 || firstIdx === -1
  // One tick per day, thinning to every 7th once a window is long enough that
  // daily ticks would blur into a bar (Sam, 2026-09-13: "small marks for the days").
  const tickEvery = points.length > 60 ? 7 : 1
  const ticks = points.map((_, i) => i).filter((i) => i % tickEvery === 0)

  const shown = at != null ? points[at] : null
  const delta = at != null && at > 0 && counted(at - 1) ? dayDelta(valueAt(at - 1), valueAt(at)) : null
  const trend = delta === null ? null : formatTrend(delta)
  const flip = at != null && points.length > 1 && at / (points.length - 1) > 0.62

  return (
    <div className={cx('text-ink', className)}>
      <div className="flex items-center justify-between gap-4 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        <ul aria-label="Series" className="flex items-center gap-5">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[3px] w-4 rounded-full bg-accent" />
            {label}
          </li>
        </ul>
        {startsLate && since && <span data-since>Counted from {dayLabel(since)}</span>}
      </div>

      <div className="mt-4 flex gap-3">
        <div aria-hidden className="relative w-8 shrink-0 font-space text-[10px] tabular-nums text-ink-faint" style={{ height }}>
          {axisTicks(top).map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>{t}</span>
          ))}
          <span className="absolute right-0 -translate-y-1/2" style={{ top: h }}>0</span>
        </div>

        <div
          ref={box}
          className="relative min-w-0 flex-1"
          style={{ height }}
          onPointerLeave={() => setAt(null)}
          onPointerMove={(e) => {
            const r = box.current?.getBoundingClientRect()
            if (!r || r.width === 0 || points.length === 0) return
            const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            setAt(Math.round(frac * (points.length - 1)))
          }}
        >
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden="true">
            {axisTicks(top).map((t) => (
              <line key={t} x1={0} y1={y(t)} x2={w} y2={y(t)} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} y1={h} x2={w} y2={h} className="stroke-ink-faint" opacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />

            {area && <polygon data-series="primary" points={area} fill="currentColor" className="text-accent" opacity={0.2} />}
            <polyline
              data-series="primary"
              points={path}
              fill="none" stroke="currentColor" className="text-accent"
              strokeWidth={2.4} vectorEffect="non-scaling-stroke"
              strokeLinecap="round" strokeLinejoin="round"
            />

            {/* Drawn after the marks so the fill never hides them. */}
            <g data-day-ticks className="stroke-ink-muted">
              {ticks.map((i) => (
                <line key={i} x1={x(i)} y1={h - 5} x2={x(i)} y2={h} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </g>

            {at != null && counted(at) && (
              <g data-crosshair>
                <line x1={x(at)} y1={PAD_TOP} x2={x(at)} y2={h} className="stroke-ink-faint" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>

          {at != null && shown && counted(at) && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-paper"
                style={{ left: `${(x(at) / w) * 100}%`, top: `${(y(valueAt(at)) / h) * 100}%` }}
              />
              <div
                role="status"
                className={cx('absolute top-2 w-56 rounded-xl bg-paper px-3.5 py-3 text-ink shadow-[0_8px_24px_rgba(17,17,17,0.12)]', flip ? 'right-0' : 'left-0')}
                style={flip ? { right: `${(1 - x(at) / w) * 100}%`, marginRight: 12 } : { left: `${(x(at) / w) * 100}%`, marginLeft: 12 }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{dayLabel(shown.day)}</span>
                  <span className="font-space text-[13px] font-bold tabular-nums">{valueAt(at)}</span>
                </div>
                <div className="mt-2 whitespace-nowrap border-t border-hairline pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {trend ? (
                    <>
                      <span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(trend.dir))}>{trend.label}</span>
                      {' '}vs {dayLabel(points[at - 1].day)} · {valueAt(at - 1)}
                    </>
                  ) : at === firstIdx || at === 0 ? (
                    'First day counted'
                  ) : (
                    <>None on {dayLabel(points[at - 1].day)}</>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex justify-between pl-11 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span>{points.length ? dayLabel(points[0].day) : ''}</span>
        <span>{points.length ? dayLabel(points[points.length - 1].day) : ''}</span>
      </div>

      <table className="sr-only">
        <caption>{label} per day</caption>
        <thead><tr><th>Day</th><th>{label}</th></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.day}><td>{p.day}</td><td>{counted(i) ? valueAt(i) : 'not counted'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-12` → `Sep 12`. Parsed by hand: `new Date('2026-09-12')` is UTC
 *  midnight, which renders as the day BEFORE anywhere west of Greenwich. */
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}
