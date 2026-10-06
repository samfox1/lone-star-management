'use client'

import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { SWATCH, type SeriesColor } from './timeline-chart'

/**
 * The numbers beside a chart (Analytics and Search, the r12 mock): one block per line drawn,
 * each its name, a big number, one line under it (per day, or the average) and, under that,
 * how it changed (Sam, 2026-10-06: "keep it to just total and per day avg"; "show ▼ 31.9% vs
 * prior 7d … below the per day stat"). The blocks share the chart's height and never make the
 * row taller (laid absolutely from lg up; the caller gives the cell its height): the more
 * lines, the smaller each number, and from four the blocks tighten and use `tailShort`.
 *
 * A swatch beside the name only when the caller gives one and there is more than one line
 * (Search gives none: its lines are named over the chart).
 */
export type Fact = {
  key: string
  label: string
  swatch?: SeriesColor
  /** The big number: a count counts up to itself; text ("#1.4") shows as it is. */
  value: number | string
  sub?: { label: string; value: string }
  growth?: { dir: 'up' | 'down' | 'flat'; size: string; tail: string; tailShort?: string } | null
}

/** The number's size for how many lines share the column: one to three big, five small. */
const SIZE = [52, 52, 52, 40, 32, 26]

export function FactsColumn({ facts, label = 'Numbers', className }: { facts: Fact[]; label?: string; className?: string }) {
  const tight = facts.length >= 4
  return (
    <div role="region" aria-label={label} className={cx('relative min-h-0', className)}>
      <dl className="flex flex-col text-right lg:absolute lg:inset-0">
        {facts.map((f, i) => (
          <div
            key={f.key}
            data-fact={f.key}
            className={cx('flex flex-1 flex-col items-end justify-center border-hairline', i > 0 && 'border-t', tight ? 'py-1' : 'py-2.5')}
          >
            <dt className="flex items-center gap-1.5 font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {facts.length > 1 && f.swatch && <span aria-hidden className={cx('inline-block h-[3px] w-3.5 rounded-full', SWATCH[f.swatch])} />}
              {f.label}
            </dt>
            <dd className={cx('font-space font-bold leading-none tracking-[-0.02em] tabular-nums text-ink', tight ? 'mt-1' : 'mt-1.5')} style={{ fontSize: SIZE[facts.length] ?? 22 }}>
              {typeof f.value === 'number' ? <CountUp value={f.value} /> : f.value}
            </dd>
            {f.sub && (
              <dd className={cx('font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint', tight ? 'mt-0.5' : 'mt-1.5')}>
                {f.sub.label} <span className="text-[12px] font-bold tracking-normal text-ink">{f.sub.value}</span>
              </dd>
            )}
            {f.growth && (
              <dd data-growth className={cx('font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint', tight ? 'mt-0.5' : 'mt-1')}>
                {f.growth.dir !== 'flat' && <span className="text-ink">{f.growth.dir === 'up' ? '▲ ' : '▼ '}</span>}
                <span className="text-[12px] font-bold tracking-normal text-ink">{f.growth.size}</span>
                {' '}{tight && f.growth.tailShort ? f.growth.tailShort : f.growth.tail}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  )
}

const motionOn = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && typeof requestAnimationFrame === 'function'
  && window.matchMedia('(prefers-reduced-motion: no-preference)').matches

/** A total that counts up to its value when it first shows or changes; still under reduced motion. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (!motionOn()) return
    const t0 = performance.now()
    let id = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700), e = 1 - (1 - k) ** 3
      setShown(Math.round(value * e))
      if (k < 1) id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [value])
  return <>{(motionOn() ? shown : value).toLocaleString('en-US')}</>
}
