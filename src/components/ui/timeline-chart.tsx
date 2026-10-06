'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayLabel, monotoneSegments, niceCeil, smoothPath, type Pt } from '@/lib/chart'

/**
 * Up to five series over the window, on ONE scale that starts at zero.
 *
 * One scale is load-bearing: two y-scales would invent a relationship that is
 * not in the data. Zero is too: a scale that starts at the series minimum turns
 * a flat week into a mountain range. The first series is the one the chart is
 * "about" — it gets the soft fill; the rest are lines.
 *
 * The lines are smooth but never overshoot (lib/chart.ts `monotoneSegments`): a
 * quiet day after a busy one never dips below the floor and a peak is drawn at its
 * own height. A line draws itself on when it first appears, and when a toggle
 * changes the tallest line the scale glides to its new top instead of jumping (the
 * r12 mock, Sam 2026-10-06: "graceful motion"). Nothing moves under
 * prefers-reduced-motion.
 *
 * The legend always names every series drawn, so identity is never the colour
 * alone. A series that was first counted mid-window (`since`) starts there rather
 * than pretending the days before were zero. `partialLast` draws the last gap
 * dotted: today is still being counted.
 *
 * Hover a day and a thin line rises from the floor to the TOPMOST line there and
 * stops (Sam: "the vertical line should stop at the slope"), each line gets a ring,
 * and a small readout above it names the day and every value (Sam: the old readout
 * was "too big").
 *
 * The drawing is in the plot's own pixels (measured), so circles stay round and
 * text never stretches; until it is measured (and in jsdom, which lays nothing out)
 * it assumes 600 wide.
 */
export type TimelinePoint = { day: string; views: number; visitors: number; bots?: number }
export type SeriesColor = 'accent' | 'accent-red' | 'ink' | 'chart-4' | 'chart-5'
export type Series = {
  key: string
  label: string
  values: number[]
  color: SeriesColor
  /** First day this series was counted; earlier days are not drawn. */
  since?: string
}

const PAD_TOP = 8
/** Fewer counted points than this and an overlay also marks each measured day
 *  with a dot, so two points at the end of a long window read as two readings
 *  joined, not as a streak (Sam, 2026-09-13: "the dots should be connected"). */
const MIN_LINE_POINTS = 4
const FALLBACK_W = 600
const TEXT: Record<SeriesColor, string> = { accent: 'text-accent', 'accent-red': 'text-accent-red', ink: 'text-ink', 'chart-4': 'text-chart-4', 'chart-5': 'text-chart-5' }
export const SWATCH: Record<SeriesColor, string> = { accent: 'bg-accent', 'accent-red': 'bg-accent-red', ink: 'bg-ink', 'chart-4': 'bg-chart-4', 'chart-5': 'bg-chart-5' }

export function TimelineChart({
  points,
  height = 260,
  series,
  partialLast = false,
  legendEnd,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  /** Defaults to views alone. */
  series?: Series[]
  /** The last day is today, still being counted: its gap is drawn dotted. */
  partialLast?: boolean
  /** Anything that belongs at the right end of the legend row (the "Every day" button). */
  legendEnd?: ReactNode
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const gid = useId()
  const [at, setAt] = useState<number | null>(null)
  const [w, setW] = useState(FALLBACK_W)
  // Measured before the first paint, then kept in step with the page.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const width = el.getBoundingClientRect().width
    if (width > 0) setW(width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = entries[0].contentRect.width
      if (next > 0) setW(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const all: Series[] = series?.length
    ? series
    : [{ key: 'views', label: 'Views', values: points.map((p) => p.views), color: 'accent' }]
  const h = height
  const firstIdx = (s: Series) => (s.since ? points.findIndex((p) => p.day >= s.since!) : 0)
  const counted = (s: Series, i: number) => { const f = firstIdx(s); return f >= 0 && i >= f }
  const valueAt = (s: Series, i: number) => s.values[i] ?? 0
  const peak = Math.max(0, ...all.flatMap((s) => points.map((_, i) => (counted(s, i) ? valueAt(s, i) : 0))))
  const finalTop = niceCeil(peak)
  const top = useTweened(finalTop)
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => PAD_TOP + (1 - v / top) * (h - PAD_TOP)
  const ptsOf = (s: Series): Pt[] => points.map((_, i) => i).filter((i) => counted(s, i)).map((i) => [x(i), y(valueAt(s, i))])
  const tickEvery = points.length > 60 ? 7 : 1
  const ticks = points.map((_, i) => i).filter((i) => i % tickEvery === 0)
  const lastIdx = points.length - 1
  const dotted = partialLast && points.length >= 2

  const shown = at != null ? points[at] : null
  const here = at == null ? [] : all.filter((s) => counted(s, at))
  // Where the hover line stops: the highest drawn value on that day (the smallest y).
  const yTop = at == null ? h : Math.min(h, ...here.map((s) => y(valueAt(s, at))))
  const frac = at == null || points.length < 2 ? 0.5 : at / lastIdx
  const shift = frac < 0.12 ? '-16px' : frac > 0.88 ? 'calc(-100% + 16px)' : '-50%'

  return (
    <div className={cx('text-ink', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ul aria-label="Series" className="flex flex-wrap items-center gap-5 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          {all.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cx('inline-block h-[3px] w-4 rounded-full', SWATCH[s.color])} />
              {s.label}
            </li>
          ))}
        </ul>
        {legendEnd}
      </div>

      <div className="mt-4 flex gap-3">
        <div aria-hidden className="relative w-8 shrink-0 font-space text-[10px] tabular-nums text-ink-faint" style={{ height }}>
          {axisTicks(finalTop).map((t) => (
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
            const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            setAt(Math.round(f * lastIdx))
          }}
        >
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, overflow: 'visible' }} aria-hidden="true">
            {axisTicks(finalTop).map((t) => (
              <line key={t} x1={0} y1={y(t)} x2={w} y2={y(t)} className="stroke-hairline" strokeWidth={1} />
            ))}
            <line x1={0} y1={h} x2={w} y2={h} className="stroke-ink-faint" opacity={0.6} strokeWidth={1} />

            {all.map((s, n) => {
              const pts = ptsOf(s)
              if (!pts.length) return null
              const segs = monotoneSegments(pts)
              const start = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
              // Today's gap, dotted, when this line reaches today.
              const partial = dotted && counted(s, lastIdx) && segs.length > 0
              const solid = [start, ...(partial ? segs.slice(0, -1) : segs)].join(' ')
              const tail = partial ? `M${pts[pts.length - 2][0].toFixed(1)},${pts[pts.length - 2][1].toFixed(1)} ${segs[segs.length - 1]}` : null
              const withDots = n > 0 && pts.length < MIN_LINE_POINTS
              const fillId = `${gid}-fill`
              return (
                <g
                  key={s.key}
                  data-series={s.key}
                  data-mark={withDots ? 'line+dots' : 'line'}
                  data-points={pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
                  className={TEXT[s.color]}
                >
                  {n === 0 && (
                    <>
                      <defs>
                        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="currentColor" stopOpacity={0.16} />
                          <stop offset="1" stopColor="currentColor" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      {pts.length > 1 && (
                        <path data-area className="chart-fade" d={`${smoothPath(pts)} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`} fill={`url(#${fillId})`} />
                      )}
                    </>
                  )}
                  <path
                    data-line
                    className="chart-draw"
                    pathLength={1}
                    d={solid}
                    fill="none" stroke="currentColor" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {tail && (
                    <path data-today d={tail} className="chart-fade" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="0.5 5" />
                  )}
                  {withDots && pts.map(([cx_, cy]) => <circle key={cx_} cx={cx_} cy={cy} r={3} fill="currentColor" />)}
                </g>
              )
            })}

            {/* Where each line ends: a dot on its last counted day. */}
            <g data-ends>
              {all.map((s) => {
                const pts = ptsOf(s)
                if (pts.length < MIN_LINE_POINTS) return null
                const [ex, ey] = pts[pts.length - 1]
                return <circle key={s.key} className={cx(TEXT[s.color], 'chart-fade')} cx={ex} cy={ey} r={3.5} fill="currentColor" stroke="var(--color-paper)" strokeWidth={1.5} />
              })}
            </g>

            {at != null && (
              <g data-crosshair>
                <line x1={x(at)} y1={yTop} x2={x(at)} y2={h} className="stroke-ink-faint" strokeWidth={1} />
                {here.map((s) => (
                  <circle key={s.key} className={TEXT[s.color]} cx={x(at)} cy={y(valueAt(s, at))} r={4.5} fill="var(--color-paper)" stroke="currentColor" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>

          {at != null && shown && (
            <div
              role="status"
              data-readout
              className="pointer-events-none absolute z-10 flex items-center gap-2.5 whitespace-nowrap rounded-lg bg-paper px-2.5 py-1.5 font-space text-[11px] text-ink shadow-[0_6px_18px_rgba(17,17,17,0.12)]"
              style={{ left: (x(at) / w) * 100 + '%', top: yTop - 12, transform: `translate(${shift}, -100%)` }}
            >
              <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{dayLabel(shown.day)}</span>
              {all.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 font-bold tabular-nums">
                  <span aria-hidden className={cx('h-[7px] w-[7px] rounded-[2px]', SWATCH[s.color])} />
                  <span className="sr-only">{s.label} </span>
                  {counted(s, at) ? valueAt(s, at).toLocaleString('en-US') : '—'}
                </span>
              ))}
            </div>
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
              <line key={i} x1={x(i)} y1={0} x2={x(i)} y2={6} strokeWidth={1} />
            ))}
          </g>
        </svg>
      </div>

      <div className="mt-1.5 flex justify-between pl-11 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span>{points.length ? dayLabel(points[0].day) : ''}</span>
        <span>{points.length ? dayLabel(points[lastIdx].day) : ''}</span>
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

/** Motion is on: a browser that animates and a reader who has not asked it not to. */
function motionOn(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && typeof requestAnimationFrame === 'function'
    && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
}

/**
 * A number that glides to each new value over `ms` (ease-out) instead of jumping:
 * the chart's scale top, so the lines and gridlines move together when a toggle
 * changes the tallest line. Without motion it is simply the value.
 */
function useTweened(target: number, ms = 600): number {
  const [shown, setShown] = useState(target)
  const now = useRef(target)
  useEffect(() => {
    const from = now.current
    if (from === target || !motionOn()) { now.current = target; return }
    const t0 = performance.now()
    let id = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3
      now.current = from + (target - from) * e
      setShown(now.current)
      if (k < 1) id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [target, ms])
  return motionOn() ? shown : target
}
