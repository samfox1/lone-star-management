'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { axisTicks, dayLabel, niceCeil } from '@/lib/chart'
import { SourceGlyph } from '@/components/ui/source-glyphs'
import { ENGINE_NAME, type Chart, type ChartSeries } from '@/lib/manager-tools/seo/search-model'
import { CAPS_LABEL } from '../../../_ui/styles'

/**
 * THE DAILY LINE of the Search tab: the dashboard Analytics page's chart (components/ui/
 * timeline-chart.tsx), its look exactly (one scale from zero, the hairline grid, the mono axis,
 * the readout on hover), plus what search numbers need and that chart doesn't do:
 *
 *   • days an engine is STILL COUNTING (Google's last ~2) are drawn dashed and lighter, with
 *     hollow dots, and the readout says so;
 *   • an engine is drawn only over its own days (search-model.ts `alignDays`): no line where it
 *     has none, never a made-up zero;
 *   • beside both engines, each is its own colour (Google blue, Bing ink), Clicks thick and Seen
 *     thin (search-model.ts `chartOf` decides; this only draws).
 *
 * The plot stretches to its box (`preserveAspectRatio="none"`, strokes that don't scale), so the
 * dots and rings are HTML on top of it, placed in percent, and stay round.
 */

const W = 600
const PAD_TOP = 8
/** Up to this many days, every day gets a dot (a few days read as readings, not a streak). */
const DOTS_UP_TO = 14
const STROKE: Record<ChartSeries['tone'], string> = { accent: 'text-accent', ink: 'text-ink' }
const SWATCH: Record<ChartSeries['tone'], string> = { accent: 'bg-accent', ink: 'bg-ink' }

type Run = { from: number; to: number; dashed: boolean }

/** A series' drawable runs: consecutive days that both have a value, split where the style
 *  changes. The step INTO a day still being counted is dashed. */
function runsOf(s: ChartSeries): Run[] {
  const runs: Run[] = []
  for (let i = 0; i + 1 < s.values.length; i++) {
    if (s.values[i] === null || s.values[i + 1] === null) continue
    const dashed = !s.final[i + 1]
    const last = runs[runs.length - 1]
    if (last && last.to === i && last.dashed === dashed) last.to = i + 1
    else runs.push({ from: i, to: i + 1, dashed })
  }
  return runs
}

export function SearchChart({ chart, both, since, height = 150 }: { chart: Chart; both: boolean; since: string | null; height?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)
  const { days, series } = chart
  const n = days.length
  const h = height
  const peak = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)))
  const top = niceCeil(peak)
  const x = (i: number) => (n < 2 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => PAD_TOP + (1 - v / top) * (h - PAD_TOP)
  const pts = (s: ChartSeries, from: number, to: number) => {
    const out: string[] = []
    for (let i = from; i <= to; i++) out.push(`${x(i).toFixed(1)},${y(s.values[i] ?? 0).toFixed(1)}`)
    return out.join(' ')
  }
  const engines = [...new Set(series.map((s) => s.engine))]
  const labelEvery = n > 8 ? Math.ceil(n / 5) : 1
  const labelled = days.map((_, i) => i).filter((i) => i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery / 2))
  const shown = at === null ? null : days[at]
  const flip = at !== null && n > 1 && at / (n - 1) > 0.6

  return (
    <div className="text-ink">
      <div className={cx(CAPS_LABEL, 'flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-ink-faint')}>
        <ul aria-label="Lines" className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {both
            ? engines.map((engine) => (
                <li key={engine} className="flex items-center gap-2">
                  <SourceGlyph source={engine} size={11} />
                  <span className="sr-only">{ENGINE_NAME[engine]}</span>
                  <Swatch tone={engine === 'google' ? 'accent' : 'ink'} thick />
                  Clicks
                  <Swatch tone={engine === 'google' ? 'accent' : 'ink'} faded />
                  Seen
                </li>
              ))
            : [
                <li key="c" className="flex items-center gap-1.5">
                  <Swatch tone="accent" thick />
                  Clicks
                </li>,
                <li key="s" className="flex items-center gap-1.5">
                  <Swatch tone="ink" />
                  Seen
                </li>,
              ]}
          {chart.stillCounting ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-ink-faint" />
              Still counting
            </li>
          ) : null}
        </ul>
        {since ? <span data-since="">{since}</span> : null}
      </div>

      <div className="mt-3.5 flex gap-3">
        <div aria-hidden className="relative w-6 shrink-0 font-space text-[10px] tabular-nums text-ink-faint" style={{ height: h }}>
          {axisTicks(peak).map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>
              {t}
            </span>
          ))}
          <span className="absolute right-0 -translate-y-1/2" style={{ top: h }}>
            0
          </span>
        </div>

        <div
          ref={box}
          className="relative min-w-0 flex-1 touch-pan-y"
          style={{ height: h }}
          onPointerLeave={() => setAt(null)}
          onPointerMove={(e) => {
            const r = box.current?.getBoundingClientRect()
            if (!r || r.width === 0 || n === 0) return
            setAt(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)))
          }}
        >
          <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, overflow: 'visible' }} aria-hidden="true">
            {axisTicks(peak)
              .filter((t) => t < top)
              .map((t) => (
                <line key={t} x1={0} y1={y(t)} x2={W} y2={y(t)} className="stroke-hairline" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            <line x1={0} y1={h} x2={W} y2={h} className="stroke-ink-faint" opacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {series.map((s) => (
              <g key={s.key} data-series={s.key} className={STROKE[s.tone]} opacity={s.faded ? 0.45 : 1}>
                {s.fill
                  ? runsOf(s).map((r) => (
                      <polygon
                        key={`f${r.from}`}
                        points={`${pts(s, r.from, r.to)} ${x(r.to).toFixed(1)},${h} ${x(r.from).toFixed(1)},${h}`}
                        fill="currentColor"
                        opacity={r.dashed ? 0.08 : 0.2}
                      />
                    ))
                  : null}
                {runsOf(s).map((r) => (
                  <polyline
                    key={r.from}
                    data-dashed={r.dashed ? '' : undefined}
                    points={pts(s, r.from, r.to)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={s.thick ? 2.4 : 1.6}
                    strokeDasharray={r.dashed ? '4 4' : undefined}
                    opacity={r.dashed ? 0.55 : 1}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            ))}
            {at !== null ? <line x1={x(at)} y1={PAD_TOP} x2={x(at)} y2={h} className="stroke-ink-faint" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
          </svg>

          {series.map((s) =>
            s.values.map((v, i) => {
              if (v === null) return null
              const alone = (i === 0 || s.values[i - 1] === null) && (i === n - 1 || s.values[i + 1] === null)
              if (n > DOTS_UP_TO && !alone) return null
              return (
                <span
                  key={`${s.key}-${i}`}
                  aria-hidden
                  className={cx(
                    'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
                    STROKE[s.tone],
                    s.final[i] ? 'h-2 w-2 bg-current' : 'h-[7px] w-[7px] border-[1.6px] border-current bg-paper',
                    s.faded ? 'opacity-45' : !s.final[i] && 'opacity-70',
                  )}
                  style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(v) / h) * 100}%` }}
                />
              )
            }),
          )}

          {at !== null && shown ? (
            <>
              {series
                .filter((s) => s.values[at] !== null)
                .map((s) => (
                  <span
                    key={s.key}
                    aria-hidden
                    className={cx('pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current bg-paper', STROKE[s.tone])}
                    style={{ left: `${(x(at) / W) * 100}%`, top: `${(y(s.values[at] ?? 0) / h) * 100}%` }}
                  />
                ))}
              <div
                role="status"
                data-readout
                className={cx('pointer-events-none absolute z-[5] w-44 rounded-xl bg-paper px-3 py-2.5 text-ink shadow-[0_8px_24px_rgba(17,17,17,0.12)]', flip ? 'right-0' : 'left-0')}
                style={{
                  top: Math.min(h - 96, Math.max(-20, y(Math.max(0, ...series.map((s) => s.values[at] ?? 0))) - 40)),
                  ...(flip ? { right: `${(1 - x(at) / W) * 100}%`, marginRight: 12 } : { left: `${(x(at) / W) * 100}%`, marginLeft: 12 }),
                }}
              >
                <div className="font-space text-[15px] font-bold">{dayLabel(shown)}</div>
                <dl className={cx(CAPS_LABEL, 'mt-1.5 space-y-0.5 text-ink-faint')}>
                  {[...series].reverse().map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-1.5">
                        {both ? <SourceGlyph source={s.engine} size={10} /> : null}
                        {s.label}
                      </dt>
                      <dd className="font-space text-[11px] font-bold tabular-nums text-ink">{s.values[at] ?? '—'}</dd>
                    </div>
                  ))}
                </dl>
                {series.some((s) => s.values[at] !== null && !s.final[at]) ? <div className={cx(CAPS_LABEL, 'mt-1.5 text-ink-faint')}>Still counting</div> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div aria-hidden className={cx(CAPS_LABEL, 'relative ml-9 mt-2 h-[18px] text-ink-faint')}>
        {labelled.map((i) => (
          <span
            key={i}
            className={cx('absolute top-0 whitespace-nowrap', n < 2 ? '-translate-x-1/2' : i === 0 ? '' : i === n - 1 ? '-translate-x-full' : '-translate-x-1/2')}
            style={{ left: `${n < 2 ? 50 : (i / (n - 1)) * 100}%` }}
          >
            {dayLabel(days[i])}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Clicks and times seen in search, by day</caption>
        <thead>
          <tr>
            <th>Day</th>
            {series.map((s) => (
              <th key={s.key}>{both ? `${ENGINE_NAME[s.engine]} ${s.label}` : s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <td>{d}</td>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] === null ? 'none' : `${s.values[i]}${s.final[i] ? '' : ' (still counting)'}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Swatch({ tone, thick = false, faded = false }: { tone: ChartSeries['tone']; thick?: boolean; faded?: boolean }) {
  return <span aria-hidden className={cx('inline-block w-4 rounded-full', SWATCH[tone], thick ? 'h-[3px]' : 'h-[1.5px]', faded && 'opacity-45')} />
}
