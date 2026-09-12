'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'

/**
 * Views and visitors over the window, on ONE scale that starts at zero.
 *
 * Both of those decisions are load-bearing. Two y-scales would invent a
 * relationship that is not in the data, and a scale that starts at the series
 * minimum — which the older `AreaChart` does, because a sparkline only has to show
 * shape — would make "visitors are about a third of views" unreadable. Here the
 * two marks can be compared by eye because they are drawn against the same zero.
 *
 * The dashboard is monochrome, so the two series are told apart by FORM, not
 * colour: views are a filled track, visitors a line over them. Visitors is the
 * darker mark because it is the number that survives a bot flood — one address is
 * one visitor however many times it loads the page.
 *
 * The table underneath is not a fallback, it is the accessible twin: every value
 * is reachable without hovering anything.
 */
export type TimelinePoint = { day: string; views: number; visitors: number }

const PAD_TOP = 8

export function TimelineChart({
  points,
  height = 150,
  className,
}: {
  points: TimelinePoint[]
  height?: number
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)

  const w = 600
  const h = height
  const max = Math.max(1, ...points.map((p) => Math.max(p.views, p.visitors)))
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (v: number) => PAD_TOP + (1 - v / max) * (h - PAD_TOP)
  const path = (key: 'views' | 'visitors') =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

  const shown = at != null ? points[at] : null

  return (
    <div className={className}>
      {/* A legend is always present with two series; identity is never the mark alone.
          A real list, because that is what it is — and it gives the marks a name a
          screen reader and a test can both ask for. */}
      <div className="flex items-center gap-5 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        <ul aria-label="Series" className="flex items-center gap-5">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-3 rounded-[1px] bg-track" />
            Views
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-[2px] w-3 rounded-full bg-ink" />
            Visitors
          </li>
        </ul>
        {/* One readout, not a number on every point. */}
        <span className={cx('ml-auto tabular-nums', shown ? 'text-ink' : 'text-transparent')}>
          {shown ? `${dayLabel(shown.day)} · ${shown.views} views · ${shown.visitors} visitors` : '—'}
        </span>
      </div>

      <div
        ref={box}
        className="relative mt-2"
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
          {/* Recessive: a solid hairline at the top of the scale and one at zero. */}
          <line x1={0} y1={PAD_TOP} x2={w} y2={PAD_TOP} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={h} x2={w} y2={h} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />

          <polygon points={`${path('views')} ${w},${h} 0,${h}`} style={{ fill: 'var(--color-track)' }} />
          <polyline
            points={path('visitors')}
            fill="none"
            className="stroke-ink"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {at != null && (
            <line
              x1={x(at)} y1={PAD_TOP} x2={x(at)} y2={h}
              className="stroke-ink-faint" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>

      {/* The window's ends, and nothing between them: an axis, not a label per point. */}
      <div className="mt-1.5 flex justify-between font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span>{points.length ? dayLabel(points[0].day) : ''}</span>
        <span>{points.length ? dayLabel(points[points.length - 1].day) : ''}</span>
      </div>

      <table className="sr-only">
        <caption>Views and visitors per day</caption>
        <thead>
          <tr><th>Day</th><th>Views</th><th>Visitors</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}><td>{p.day}</td><td>{p.views}</td><td>{p.visitors}</td></tr>
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
