'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayLabel, monotoneSegments, niceCeil, rankFloor, rankTicks, smoothPath, type Pt } from '@/lib/chart'


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
 * `pins` mark moments above the lines (lib/analytics-pins.ts): a small round mark in a band
 * over the plot, a dotted guide down to its day on its line, and a card naming it on hover or
 * focus. A pin shows only while its line is drawn; marks that would touch step right.
 *
 * The Search page draws on it too: `scale="rank"` puts #1 at the TOP (a spot, where smaller is
 * better), `dots` marks every reading, `endMark` rides the end of the first line (the artist's
 * initial), a value of null is a day the line has nothing (an engine with no numbers yet), and
 * `partialFrom` draws every gap into a day still being counted dotted (Google's last ~2 days,
 * or today). A `faded` line sits back, a `thick` one forward (Search: seen thin, clicks thick).
 *
 * The drawing is in the plot's own pixels (measured), so circles stay round and
 * text never stretches; until it is measured (and in jsdom, which lays nothing out)
 * it assumes 600 wide.
 */
export type TimelinePoint = { day: string; views: number; visitors: number; bots?: number }
export type SeriesColor = 'accent' | 'accent-red' | 'ink' | 'grey' | 'chart-4' | 'chart-5'
/** A moment marked above the lines: its day, the line it sits on, its glyph (any svg: an Icon,
 *  a SourceGlyph) and its words. */
export type ChartPin = { day: string; series: string; icon: ReactNode; title: string; note?: string }
export type Series = {
  key: string
  label: string
  /** One per point; null where this line has nothing that day (not drawn, never a zero). */
  values: (number | null)[]
  color: SeriesColor
  /** First day this series was counted; earlier days are not drawn. */
  since?: string
  /** Sits back (half strength). */
  faded?: boolean
  /** Drawn heavier. */
  thick?: boolean
  /** Lines sharing a group are read together on hover, under the group's name, each by `short`
   *  (Metrics: "GOOGLE Seen 23 Clicks 6"), where colour shades alone can't tell them apart. */
  group?: string
  short?: string
}

const PAD_TOP = 8
/** With pins, the plot starts lower: the marks sit in the band above it. */
const PIN_BAND = 44
const PIN_Y = 18
const PIN_R = 13
/** Marks closer than this step right, so neighbours never overlap. */
const PIN_GAP = 30
/** Fewer counted points than this and an overlay also marks each measured day
 *  with a dot, so two points at the end of a long window read as two readings
 *  joined, not as a streak (Sam, 2026-09-13: "the dots should be connected"). */
const MIN_LINE_POINTS = 4
const FALLBACK_W = 600
const TEXT: Record<SeriesColor, string> = { accent: 'text-accent', 'accent-red': 'text-accent-red', ink: 'text-ink', grey: 'text-ink-faint', 'chart-4': 'text-chart-4', 'chart-5': 'text-chart-5' }
export const SWATCH: Record<SeriesColor, string> = { accent: 'bg-accent', 'accent-red': 'bg-accent-red', ink: 'bg-ink', grey: 'bg-ink-faint', 'chart-4': 'bg-chart-4', 'chart-5': 'bg-chart-5' }

export function TimelineChart({
  points,
  height = 260,
  series,
  partialFrom,
  scale = 'count',
  dots = false,
  endMark,
  format = (v: number) => v.toLocaleString('en-US'),
  legendEnd,
  legend = true,
  pins,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  /** Defaults to views alone. */
  series?: Series[]
  /** The first point still being counted (today; Google's last ~2 days): every gap into it and
   *  after it is drawn dotted. */
  partialFrom?: number
  /** 'rank': a spot axis, #1 at the top. */
  scale?: 'count' | 'rank'
  /** A dot on every reading. */
  dots?: boolean
  /** Rides the last point of the first line (the artist's initial on the Search spot line). */
  endMark?: ReactNode
  /** How a value reads in the hover readout. */
  format?: (v: number) => string
  /** Anything that belongs at the right end of the legend row. */
  legendEnd?: ReactNode
  /** false: the caller draws the legend itself (ChartLegend), e.g. on a row wider than the chart. */
  legend?: boolean
  /** Moments marked above the lines; each sits on its `series` and shows only while it is drawn. */
  pins?: ChartPin[]
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const gid = useId()
  const [at, setAt] = useState<number | null>(null)
  const [pinOn, setPinOn] = useState<number | null>(null)
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
  const counted = (s: Series, i: number) => { const f = firstIdx(s); return f >= 0 && i >= f && s.values[i] != null }
  const valueAt = (s: Series, i: number) => s.values[i] ?? 0
  const rank = scale === 'rank'
  const readings = all.flatMap((s) => points.flatMap((_, i) => (counted(s, i) ? [valueAt(s, i)] : [])))
  // The scale's far end: the top of a count axis, the floor (lowest spot) of a rank axis. It
  // glides when it changes.
  const finalExtent = rank ? rankFloor(readings) : niceCeil(Math.max(0, ...readings))
  const extent = useTweened(finalExtent)
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const padTop = pins?.length ? PIN_BAND : PAD_TOP
  const y = (v: number) => (rank ? padTop + ((v - 1) / (extent - 1)) * (h - padTop) : padTop + (1 - v / extent) * (h - padTop))
  const tickValues = rank ? rankTicks(finalExtent).filter((t) => t < finalExtent) : axisTicks(finalExtent)
  const tickLabel = (t: number) => (rank ? `#${t}` : String(t))
  const idxOf = (s: Series) => points.map((_, i) => i).filter((i) => counted(s, i))
  const ptsOf = (s: Series): Pt[] => idxOf(s).map((i) => [x(i), y(valueAt(s, i))])
  const tickEvery = points.length > 60 ? 7 : 1
  const ticks = points.map((_, i) => i).filter((i) => i % tickEvery === 0)
  const lastIdx = points.length - 1

  // The pins whose line is drawn and whose day is in view, left to right, each mark stepped
  // clear of the one before it.
  type Mark = { p: ChartPin; px: number; bx: number; py: number }
  const marks = (pins ?? [])
    .map((p) => ({ p, i: points.findIndex((pt) => pt.day === p.day), s: all.find((s) => s.key === p.series) }))
    .filter((m): m is { p: ChartPin; i: number; s: Series } => m.i >= 0 && m.s !== undefined)
    .sort((a, b) => a.i - b.i)
    .reduce<Mark[]>((placed, { p, i, s }) => {
      const px = x(i)
      const prev = placed.length ? placed[placed.length - 1].bx : -Infinity
      const bx = Math.min(Math.max(px, prev + PIN_GAP), w - PIN_R)
      return [...placed, { p, px, bx, py: counted(s, i) ? y(valueAt(s, i)) : h }]
    }, [])
  const card = pinOn != null ? marks[pinOn] : null

  const shown = at != null ? points[at] : null
  const here = at == null ? [] : all.filter((s) => counted(s, at))
  // Where the hover line stops: the highest drawn value on that day (the smallest y).
  const yTop = at == null ? h : Math.min(h, ...here.map((s) => y(valueAt(s, at))))
  // Lines with a group read together on hover, group by group in the order they come.
  const groups = all.some((s) => s.group)
    ? [...all.reduce((m, s) => m.set(s.group ?? s.label, [...(m.get(s.group ?? s.label) ?? []), s]), new Map<string, Series[]>())]
    : null
  const frac = at == null || points.length < 2 ? 0.5 : at / lastIdx
  const shift = frac < 0.12 ? '-16px' : frac > 0.88 ? 'calc(-100% + 16px)' : '-50%'

  return (
    <div className={cx('text-ink', className)}>
      {legend && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <ChartLegend series={all} />
          {legendEnd}
        </div>
      )}

      <div className="flex gap-3">
        <div aria-hidden className="relative w-8 shrink-0 font-space text-[10px] tabular-nums text-ink-faint" style={{ height }}>
          {tickValues.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>{tickLabel(t)}</span>
          ))}
          <span className="absolute right-0 -translate-y-1/2" style={{ top: h }}>{rank ? `#${finalExtent}` : 0}</span>
        </div>

        <div
          ref={box}
          className="relative min-w-0 flex-1"
          style={{ height }}
          onPointerLeave={() => setAt(null)}
          onPointerMove={(e) => {
            // Over a pin, the pin's card speaks; the day readout steps aside.
            if ((e.target as Element).closest?.('[data-pin]')) { setAt(null); return }
            const r = box.current?.getBoundingClientRect()
            if (!r || r.width === 0 || points.length === 0) return
            const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            setAt(Math.round(f * lastIdx))
          }}
        >
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, overflow: 'visible' }} aria-hidden="true">
            {tickValues.map((t) => (
              <line key={t} x1={0} y1={y(t)} x2={w} y2={y(t)} className="stroke-hairline" strokeWidth={1} />
            ))}
            <line x1={0} y1={h} x2={w} y2={h} className="stroke-ink-faint" opacity={0.6} strokeWidth={1} />

            {all.map((s, n) => {
              const pts = ptsOf(s)
              if (!pts.length) return null
              const segs = monotoneSegments(pts)
              const at_ = (k: number) => `M${pts[k][0].toFixed(1)},${pts[k][1].toFixed(1)}`
              // The gaps into a day still being counted, and every gap after, dotted.
              const k = partialFrom === undefined ? -1 : idxOf(s).findIndex((i) => i >= partialFrom)
              const cut = k === -1 ? segs.length : Math.max(0, k - 1)
              const solid = [at_(0), ...segs.slice(0, cut)].join(' ')
              const tail = cut < segs.length ? `${at_(cut)} ${segs.slice(cut).join(' ')}` : null
              const withDots = dots || (n > 0 && pts.length < MIN_LINE_POINTS)
              const fillId = `${gid}-fill`
              return (
                <g
                  key={s.key}
                  data-series={s.key}
                  data-mark={withDots ? 'line+dots' : 'line'}
                  data-points={pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
                  className={TEXT[s.color]}
                  opacity={s.faded ? 0.5 : undefined}
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
                    fill="none" stroke="currentColor" strokeWidth={s.thick ? 2.6 : 2}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {tail && (
                    <path data-today d={tail} className="chart-fade" fill="none" stroke="currentColor" strokeWidth={s.thick ? 2.6 : 2} strokeLinecap="round" strokeDasharray="0.5 5" />
                  )}
                  {withDots && pts.map(([cx_, cy]) => <circle key={cx_} cx={cx_} cy={cy} r={3} fill="currentColor" />)}
                </g>
              )
            })}

            {/* Where each line ends: a dot on its last counted day. */}
            <g data-ends>
              {all.map((s, n) => {
                const pts = ptsOf(s)
                if (pts.length < MIN_LINE_POINTS || (n === 0 && endMark)) return null
                const [ex, ey] = pts[pts.length - 1]
                return <circle key={s.key} className={cx(TEXT[s.color], 'chart-fade')} cx={ex} cy={ey} r={3.5} fill="currentColor" stroke="var(--color-paper)" strokeWidth={1.5} />
              })}
            </g>

            {marks.map(({ p, px, bx, py }) => (
              <g key={`${p.day}-${p.title}`} data-pin-guide className="chart-fade text-ink">
                <line x1={bx} y1={PIN_Y + PIN_R} x2={px} y2={py - 6} stroke="currentColor" strokeOpacity={0.18} strokeDasharray="2 3" />
                <circle cx={px} cy={py} r={4} fill="var(--color-paper)" stroke="currentColor" strokeWidth={1.5} />
              </g>
            ))}

            {at != null && (
              <g data-crosshair>
                <line x1={x(at)} y1={yTop} x2={x(at)} y2={h} className="stroke-ink-faint" strokeWidth={1} />
                {here.map((s) => (
                  <circle key={s.key} className={TEXT[s.color]} cx={x(at)} cy={y(valueAt(s, at))} r={4.5} fill="var(--color-paper)" stroke="currentColor" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>

          {endMark && (() => {
            const pts = all.length ? ptsOf(all[0]) : []
            if (!pts.length) return null
            const [ex, ey] = pts[pts.length - 1]
            return (
              <div data-end-mark aria-hidden className="chart-fade pointer-events-none absolute z-[4] -translate-x-1/2 -translate-y-1/2" style={{ left: (ex / w) * 100 + '%', top: ey }}>
                {endMark}
              </div>
            )
          })()}

          {marks.map(({ p, bx }, n) => (
            <button
              key={`${p.day}-${p.title}`}
              type="button"
              data-pin={p.day}
              aria-label={p.title}
              className="pin-pop absolute z-[5] flex items-center justify-center rounded-full bg-paper text-ink ring-[1.4px] ring-ink transition-transform duration-300 hover:scale-[1.14] focus-visible:scale-[1.14] focus-visible:outline-none"
              style={{ left: (bx / w) * 100 + '%', top: PIN_Y - PIN_R, width: PIN_R * 2, height: PIN_R * 2, marginLeft: -PIN_R }}
              onPointerEnter={() => setPinOn(n)}
              onPointerLeave={() => setPinOn(null)}
              onFocus={() => setPinOn(n)}
              onBlur={() => setPinOn(null)}
            >
              <span aria-hidden className="flex [&_svg]:h-3.5 [&_svg]:w-3.5">{p.icon}</span>
            </button>
          ))}
          {card && (
            <div
              role="tooltip"
              data-pin-card
              className="pointer-events-none absolute z-20 w-[250px] rounded-xl bg-paper px-3.5 py-3 shadow-[0_8px_24px_rgba(17,17,17,0.12)]"
              style={{ left: `clamp(125px, ${(card.bx / w) * 100}%, calc(100% - 125px))`, top: PIN_Y - PIN_R - 8, transform: 'translate(-50%, -100%)' }}
            >
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-ink">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-paper ring-[1.5px] ring-inset ring-ink [&_svg]:h-3 [&_svg]:w-3">{card.p.icon}</span>
                {card.p.title}
              </div>
              <div className="ml-[34px] mt-1.5 font-space text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                {dayLabel(card.p.day)}{card.p.note && <> · <span className="normal-case tracking-normal text-ink">{card.p.note}</span></>}
              </div>
            </div>
          )}

          {at != null && shown && (
            <div
              role="status"
              data-readout
              className={cx(
                'pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-paper px-2.5 py-1.5 font-space text-[11px] text-ink shadow-[0_6px_18px_rgba(17,17,17,0.12)]',
                groups ? 'flex flex-col gap-1' : 'flex items-center gap-2.5',
              )}
              style={{ left: (x(at) / w) * 100 + '%', top: yTop - 12, transform: `translate(${shift}, -100%)` }}
            >
              <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{dayLabel(shown.day)}</span>
              {groups
                ? groups.map(([g, members]) => (
                    <span key={g} data-readout-group={g} className="flex items-baseline gap-2.5">
                      <span className="w-14 text-[10px] font-bold uppercase tracking-[0.08em] text-ink">{g}</span>
                      {members.map((s) => (
                        <span key={s.key} className="tabular-nums">
                          {s.short ? <span className="mr-1 text-ink-faint">{s.short}</span> : <span className="sr-only">{s.label} </span>}
                          <span className="font-bold">{counted(s, at) ? format(valueAt(s, at)) : '—'}</span>
                        </span>
                      ))}
                    </span>
                  ))
                : all.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1.5 font-bold tabular-nums">
                      <span aria-hidden className={cx('h-[7px] w-[7px] rounded-[2px]', SWATCH[s.color])} />
                      <span className="sr-only">{s.label} </span>
                      {counted(s, at) ? format(valueAt(s, at)) : '—'}
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

/** The names of the lines drawn, each beside its colour: identity is never the colour alone. */
export function ChartLegend({ series }: { series: Pick<Series, 'key' | 'label' | 'color'>[] }) {
  return (
    <ul aria-label="Series" className="flex flex-wrap items-center gap-5 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className={cx('inline-block h-[3px] w-4 rounded-full', SWATCH[s.color])} />
          {s.label}
        </li>
      ))}
    </ul>
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
