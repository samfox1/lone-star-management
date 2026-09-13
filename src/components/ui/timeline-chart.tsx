'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayDelta, niceCeil } from '@/lib/chart'
import { formatTrend, trendTextClass } from '@/lib/format'

/**
 * Views and visitors over the window, on ONE scale that starts at zero, drawn
 * inside a contained black band.
 *
 * Both scale decisions are load-bearing. Two y-scales would invent a relationship
 * that is not in the data; a scale that starts at the series minimum — which the
 * older `AreaChart` does, because a sparkline only has to show shape — would make
 * "visitors are about a third of views" unreadable. Here the two marks can be
 * compared by eye because they are drawn against the same zero.
 *
 * The band is the one dark surface on the page, and it stays contained to this
 * chart (Sam, 2026-09-13: "cool, but I don't want it to be the main part of the
 * screen"). Views are the blue accent with a soft fill, visitors the red accent
 * as a line; the two colours are already the page's, so the chart adds none.
 *
 * Hovering a day draws a vertical rule through it and a readout with that day's
 * views, visitors, and the change on the day before as a signed percent. The
 * percent is absent — not zero, not infinite — when yesterday was zero or does
 * not exist; `dayDelta` decides that, and is tested on its own.
 *
 * The table underneath is not a fallback, it is the accessible twin: every value
 * is reachable without hovering anything.
 */
export type TimelinePoint = { day: string; views: number; visitors: number }

const PAD_TOP = 8

export function TimelineChart({
  points,
  height = 260,
  visitorsSince,
  primary,
  showVisitors = primary === undefined,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  /** The first day visitors were counted. Before it the visitors line is not
   *  drawn at all — a zero there would be a lie, the number was never taken —
   *  and the span is shaded and labelled so the gap reads as a gap. */
  visitorsSince?: string
  /** Chart THIS series as the blue mark instead of views: one value per point,
   *  same order. The explorer uses it to put plays or ticket clicks on the same
   *  chart grammar. Defaults to views. */
  primary?: { label: string; values: number[] }
  /** Draw the red visitors line. On by default when charting views, off for
   *  anything else — plays against visitors is not a comparison anyone makes. */
  showVisitors?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)

  const w = 600
  const h = height
  const primaryLabel = primary?.label ?? 'Views'
  const primaryAt = (i: number) => primary ? (primary.values[i] ?? 0) : points[i].views
  const peak = Math.max(0, ...points.map((p, i) => Math.max(primaryAt(i), showVisitors ? p.visitors : 0)))
  const top = niceCeil(peak)
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => PAD_TOP + (1 - v / top) * (h - PAD_TOP)
  const primaryPath = points.map((_, i) => `${x(i).toFixed(1)},${y(primaryAt(i)).toFixed(1)}`).join(' ')
  // Visitors exist only from the cut-over. Days before it are not "0 visitors",
  // they are unmeasured, so the line simply starts where the measurement does.
  const firstVisitorIdx = visitorsSince ? points.findIndex((p) => p.day >= visitorsSince) : 0
  const hasVisitors = (i: number) => firstVisitorIdx >= 0 && i >= firstVisitorIdx
  const visitorsPath = points
    .map((p, i) => (hasVisitors(i) ? `${x(i).toFixed(1)},${y(p.visitors).toFixed(1)}` : null))
    .filter(Boolean)
    .join(' ')
  const unmeasuredUntil = firstVisitorIdx > 0 ? x(firstVisitorIdx) : firstVisitorIdx === -1 ? w : 0

  const peakIndex = points.reduce((best, _, i) => (primaryAt(i) > (best >= 0 ? primaryAt(best) : -1) ? i : best), 0)
  const shown = at != null ? points[at] : null
  const delta = shown ? dayDelta(at! > 0 ? primaryAt(at! - 1) : undefined, primaryAt(at!)) : null
  const trend = delta === null ? null : formatTrend(delta)
  const flip = at != null && points.length > 1 && at / (points.length - 1) > 0.62

  return (
    <div className={cx('rounded-2xl bg-ink p-5 text-paper', className)}>
      {/* A legend is always present with two series; identity is never the mark
          alone. A real list, because that is what it is — and it gives the marks a
          name a screen reader and a test can both ask for. */}
      <div className="flex items-center justify-between gap-4 font-space text-[10px] uppercase tracking-[0.12em]">
        <ul aria-label="Series" className="flex items-center gap-5 text-paper/60">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[3px] w-4 rounded-full bg-accent" />
            {primaryLabel}
          </li>
          {showVisitors && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-[3px] w-4 rounded-full bg-accent-red" />
              Visitors
            </li>
          )}
        </ul>
        {points.length > 0 && primaryAt(peakIndex) > 0 && (
          <span className="text-paper/60">
            Best day {dayLabel(points[peakIndex].day)} · {primaryAt(peakIndex)} {primaryLabel.toLowerCase()}
          </span>
        )}
      </div>

      <div className="mt-4 flex gap-3">
        {/* The axis, read back as words: the gridline values, top to bottom. */}
        <div
          aria-hidden
          className="relative w-8 shrink-0 font-space text-[10px] tabular-nums text-paper/50"
          style={{ height }}
        >
          {axisTicks(top).map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>
              {t}
            </span>
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
          <svg
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            style={{ width: '100%', height }}
            aria-hidden="true"
          >
            {/* Recessive grid: one hairline per tick, a firmer one at zero. */}
            {axisTicks(top).map((t) => (
              <line
                key={t} x1={0} y1={y(t)} x2={w} y2={y(t)}
                stroke="currentColor" className="text-paper" opacity={0.13}
                strokeWidth={1} vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={0} y1={h} x2={w} y2={h}
              stroke="currentColor" className="text-paper" opacity={0.32}
              strokeWidth={1} vectorEffect="non-scaling-stroke"
            />

            {showVisitors && unmeasuredUntil > 0 && (
              <rect
                data-unmeasured="visitors"
                x={0} y={PAD_TOP} width={unmeasuredUntil} height={h - PAD_TOP}
                fill="currentColor" className="text-paper" opacity={0.045}
              />
            )}
            <polygon
              data-series="views"
              points={`${primaryPath} ${w},${h} 0,${h}`}
              fill="currentColor" className="text-accent" opacity={0.2}
            />
            <polyline
              data-series="views"
              points={primaryPath}
              fill="none" stroke="currentColor" className="text-accent"
              strokeWidth={2.4} vectorEffect="non-scaling-stroke"
              strokeLinecap="round" strokeLinejoin="round"
            />
            {showVisitors && (
              <polyline
                data-series="visitors"
                points={visitorsPath}
                fill="none" stroke="currentColor" className="text-accent-red"
                strokeWidth={1.8} vectorEffect="non-scaling-stroke"
                strokeLinecap="round" strokeLinejoin="round"
              />
            )}

            {at != null && shown && (
              <g data-crosshair>
                <line
                  x1={x(at)} y1={PAD_TOP} x2={x(at)} y2={h}
                  stroke="currentColor" className="text-paper" opacity={0.45}
                  strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </svg>

          {showVisitors && unmeasuredUntil > 0 && (
            <span
              className="pointer-events-none absolute top-2 font-space text-[10px] uppercase tracking-[0.1em] text-paper/40"
              style={{ left: 8 }}
            >
              Visitors counted from {dayLabel(points[firstVisitorIdx === -1 ? points.length - 1 : firstVisitorIdx].day)}
            </span>
          )}

          {/* The dots sit outside the stretched SVG so they stay round. */}
          {at != null && shown && (
            <>
              <Dot left={x(at) / w} top={y(primaryAt(at)) / h} className="border-accent" />
              {showVisitors && hasVisitors(at) && (
                <Dot left={x(at) / w} top={y(shown.visitors) / h} className="border-accent-red" />
              )}
              <div
                role="status"
                className={cx(
                  'absolute top-2 w-56 rounded-xl border border-hairline bg-paper px-3.5 py-3 text-ink',
                  flip ? 'right-0' : 'left-0',
                )}
                style={flip
                  ? { right: `${(1 - x(at) / w) * 100}%`, marginRight: 12 }
                  : { left: `${(x(at) / w) * 100}%`, marginLeft: 12 }}
              >
                <div className="text-sm">{dayLabel(shown.day)}</div>
                <dl className="mt-2 space-y-1 border-t border-hairline pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  <div className="flex justify-between gap-3">
                    <dt>{primaryLabel}</dt>
                    <dd className="text-[11px] font-bold tabular-nums text-ink">{primaryAt(at)}</dd>
                  </div>
                  {showVisitors && (
                    <div className="flex justify-between gap-3">
                      <dt>Visitors</dt>
                      <dd className="whitespace-nowrap text-[11px] font-bold tabular-nums text-ink">
                        {hasVisitors(at) ? shown.visitors : 'not yet counted'}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-2 whitespace-nowrap border-t border-hairline pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {trend ? (
                    <>
                      <span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(trend.dir))}>{trend.label}</span>
                      {' '}vs {dayLabel(points[at! - 1].day)} · {primaryAt(at! - 1)}
                    </>
                  ) : at === 0 ? (
                    'First day of the window'
                  ) : (
                    <>No {primaryLabel.toLowerCase()} on {dayLabel(points[at! - 1].day)}</>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* The window's ends, and nothing between them: an axis, not a label per point. */}
      <div className="mt-2 flex justify-between pl-11 font-space text-[10px] uppercase tracking-[0.1em] text-paper/50">
        <span>{points.length ? dayLabel(points[0].day) : ''}</span>
        <span>{points.length ? dayLabel(points[points.length - 1].day) : ''}</span>
      </div>

      <table className="sr-only">
        <caption>{showVisitors ? `${primaryLabel} and visitors per day` : `${primaryLabel} per day`}</caption>
        <thead>
          <tr><th>Day</th><th>{primaryLabel}</th>{showVisitors && <th>Visitors</th>}</tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.day}><td>{p.day}</td><td>{primaryAt(i)}</td>{showVisitors && <td>{p.visitors}</td>}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dot({ left, top, className }: { left: number; top: number; className: string }) {
  return (
    <span
      aria-hidden
      className={cx('pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-ink', className)}
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
    />
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-12` → `Sep 12`. Parsed by hand: `new Date('2026-09-12')` is UTC
 *  midnight, which renders as the day BEFORE anywhere west of Greenwich. */
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`
}
