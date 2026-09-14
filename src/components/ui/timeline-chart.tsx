'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayDelta, niceCeil } from '@/lib/chart'
import { formatTrend, trendTextClass } from '@/lib/format'

/**
 * Up to three series over the window, on ONE scale that starts at zero.
 *
 * One scale is load-bearing: two y-scales would invent a relationship that is
 * not in the data. Zero is too: a scale that starts at the series minimum turns
 * a flat week into a mountain range. The first series is the one the chart is
 * "about" — it gets the soft fill and the hover delta; the rest are lines.
 *
 * Colours are the page's own and nothing else: the blue accent, the red accent,
 * and ink. The legend always names every series drawn, so identity is never the
 * colour alone. A series that was first counted mid-window (`since`) starts
 * there rather than pretending the days before were zero, and the legend says
 * from when.
 *
 * Sam, 2026-09-13: "this chart should just be for views, and then the user can
 * toggle on unique visitors and bots onto the same chart with a different
 * colored line. It's all one chart."
 */
export type TimelinePoint = { day: string; views: number; visitors: number; bots?: number }
export type Series = {
  key: string
  label: string
  values: number[]
  color: 'accent' | 'accent-red' | 'ink'
  /** First day this series was counted; earlier days are not drawn. */
  since?: string
}

const PAD_TOP = 8
/** Fewer counted points than this and an overlay also marks each measured day
 *  with a dot, so two points at the end of a long window read as two readings
 *  joined, not as a streak (Sam, 2026-09-13: "the dots should be connected"). */
const MIN_LINE_POINTS = 4
const STROKE: Record<Series['color'], string> = { accent: 'text-accent', 'accent-red': 'text-accent-red', ink: 'text-ink' }
const SWATCH: Record<Series['color'], string> = { accent: 'bg-accent', 'accent-red': 'bg-accent-red', ink: 'bg-ink' }

export function TimelineChart({
  points,
  height = 260,
  series,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  /** Defaults to views alone. */
  series?: Series[]
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)

  const all: Series[] = series?.length
    ? series
    : [{ key: 'views', label: 'Views', values: points.map((p) => p.views), color: 'accent' }]
  const w = 600
  const h = height
  const firstIdx = (s: Series) => (s.since ? points.findIndex((p) => p.day >= s.since!) : 0)
  const counted = (s: Series, i: number) => { const f = firstIdx(s); return f >= 0 && i >= f }
  const valueAt = (s: Series, i: number) => s.values[i] ?? 0
  const peak = Math.max(0, ...all.flatMap((s) => points.map((_, i) => (counted(s, i) ? valueAt(s, i) : 0))))
  const top = niceCeil(peak)
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => PAD_TOP + (1 - v / top) * (h - PAD_TOP)
  const pathOf = (s: Series) =>
    points.map((_, i) => i).filter((i) => counted(s, i)).map((i) => `${x(i).toFixed(1)},${y(valueAt(s, i)).toFixed(1)}`)
  const tickEvery = points.length > 60 ? 7 : 1
  const ticks = points.map((_, i) => i).filter((i) => i % tickEvery === 0)

  const lead = all[0]
  const shown = at != null ? points[at] : null
  const delta = at != null && at > 0 && counted(lead, at - 1) ? dayDelta(valueAt(lead, at - 1), valueAt(lead, at)) : null
  const trend = delta === null ? null : formatTrend(delta)
  const flip = at != null && points.length > 1 && at / (points.length - 1) > 0.62

  return (
    <div className={cx('text-ink', className)}>
      <ul aria-label="Series" className="flex flex-wrap items-center gap-5 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {all.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cx('inline-block h-[3px] w-4 rounded-full', SWATCH[s.color])} />
            {s.label}
          </li>
        ))}
      </ul>

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
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, overflow: 'visible' }} aria-hidden="true">
            {axisTicks(top).map((t) => (
              <line key={t} x1={0} y1={y(t)} x2={w} y2={y(t)} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} y1={h} x2={w} y2={h} className="stroke-ink-faint" opacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />

            {all.map((s, n) => {
              const pts = pathOf(s)
              if (!pts.length) return null
              const first = pts[0].split(',')[0], last = pts[pts.length - 1].split(',')[0]
              const withDots = n > 0 && pts.length < MIN_LINE_POINTS
              return (
                <g key={s.key} data-series={s.key} data-mark={withDots ? 'line+dots' : 'line'} className={STROKE[s.color]}>
                  {n === 0 && <polygon points={`${pts.join(' ')} ${last},${h} ${first},${h}`} fill="currentColor" opacity={0.2} />}
                  <polyline
                    points={pts.join(' ')}
                    fill="none" stroke="currentColor"
                    strokeWidth={n === 0 ? 2.4 : 1.8} vectorEffect="non-scaling-stroke"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {withDots && pts.map((p) => {
                    const [cx, cy] = p.split(',')
                    // An ellipse scaled against the stretched viewBox, so it stays round.
                    return <ellipse key={p} cx={cx} cy={cy} rx={5.5 * (w / 1000)} ry={5.5 * (h / 420)} fill="currentColor" />
                  })}
                </g>
              )
            })}

            {at != null && (
              <g data-crosshair>
                <line x1={x(at)} y1={PAD_TOP} x2={x(at)} y2={h} className="stroke-ink-faint" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>

          {at != null && shown && (
            <>
              {all.filter((s) => counted(s, at)).map((s) => (
                <span
                  key={s.key}
                  aria-hidden
                  className={cx('pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-paper',
                    s.color === 'accent' ? 'border-accent' : s.color === 'accent-red' ? 'border-accent-red' : 'border-ink')}
                  style={{ left: `${(x(at) / w) * 100}%`, top: `${(y(valueAt(s, at)) / h) * 100}%` }}
                />
              ))}
              <div
                role="status"
                data-readout
                className={cx('absolute w-56 rounded-xl bg-paper px-3.5 py-3 text-ink shadow-[0_8px_24px_rgba(17,17,17,0.12)]', flip ? 'right-0' : 'left-0')}
                style={{
                  // Beside the dot, at its height — clamped to stay inside the plot. A card
                  // flush with the top rule read as a title (Sam, 2026-09-13).
                  top: `${Math.min(58, Math.max(4, (y(valueAt(lead, at)) / h) * 100 - 6))}%`,
                  ...(flip ? { right: `${(1 - x(at) / w) * 100}%`, marginRight: 12 } : { left: `${(x(at) / w) * 100}%`, marginLeft: 12 }),
                }}
              >
                <div className="text-sm">{dayLabel(shown.day)}</div>
                <dl className="mt-2 space-y-1 border-t border-hairline pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {all.map((s) => (
                    <div key={s.key} className="flex justify-between gap-3">
                      <dt>{s.label}</dt>
                      <dd className="whitespace-nowrap text-[11px] font-bold tabular-nums text-ink">
                        {counted(s, at) ? valueAt(s, at) : 'not counted'}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2 whitespace-nowrap border-t border-hairline pt-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                  {trend ? (
                    <>
                      <span className={cx('text-[11px] font-bold tabular-nums', trendTextClass(trend.dir))}>{trend.label}</span>
                      {' '}vs {dayLabel(points[at - 1].day)} · {valueAt(lead, at - 1)}
                    </>
                  ) : at === 0 ? 'First day' : <>None on {dayLabel(points[at - 1].day)}</>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* The day ticks hang BELOW the baseline in their own strip, so they never
          sit under the fill (Sam, 2026-09-13). Same x mapping as the plot. */}
      <div className="flex gap-3">
        <div aria-hidden className="w-8 shrink-0" />
        <svg viewBox={`0 0 ${w} 6`} preserveAspectRatio="none" className="h-[6px] min-w-0 flex-1" aria-hidden="true">
          <g data-day-ticks className="stroke-ink-muted">
            {ticks.map((i) => (
              <line key={i} x1={x(i)} y1={0} x2={x(i)} y2={6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        </svg>
      </div>

      <div className="mt-1.5 flex justify-between pl-11 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span>{points.length ? dayLabel(points[0].day) : ''}</span>
        <span>{points.length ? dayLabel(points[points.length - 1].day) : ''}</span>
      </div>

      <table className="sr-only">
        <caption>{all.map((s) => s.label).join(', ')} per day</caption>
        <thead><tr><th>Day</th>{all.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              {all.map((s) => <td key={s.key}>{counted(s, i) ? valueAt(s, i) : 'not counted'}</td>)}
            </tr>
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
