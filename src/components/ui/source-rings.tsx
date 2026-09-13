'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import type { SourceSummary } from '@/lib/analytics'
import { formatTrend, trendTextClass } from '@/lib/format'
import { SourceGlyph } from '@/components/ui/source-glyphs'

/**
 * Where visitors came from: one ring per source, the platform's mark inside it,
 * the arc around it that source's share of everyone.
 *
 * The first six show; the rest sit behind one control. Six is the number a
 * person can compare by eye; past that they are reading a list, and the list is
 * there for them. Selecting a ring opens the card underneath with what a source
 * can honestly say about itself — visitors, views, share, which hosts, and how
 * it did against the window before. Per-source plays or ticket clicks are NOT
 * here: no tally joins source to type yet, and a card that guessed would be
 * worse than one that says less.
 *
 * Every ring is the blue accent. Colour never carries identity here — the mark
 * does — so a filter that drops a source cannot repaint the survivors.
 */
const R = 42
const C = 2 * Math.PI * R
const SHOWN = 6

export function SourceRings({
  sources,
  empty = 'No visits yet.',
  className,
}: {
  sources: SourceSummary[]
  empty?: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const visible = expanded ? sources : sources.slice(0, SHOWN)
  const open = sources.find((s) => s.source === selected) ?? null

  if (sources.length === 0) {
    return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  }

  return (
    <div className={className}>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6" aria-label="Sources">
        {visible.map((s) => {
          const isOpen = s.source === selected
          return (
            <li key={s.source}>
              <button
                type="button"
                aria-pressed={isOpen}
                aria-label={`${s.label}: ${s.visitors} visitors, ${Math.round(s.share * 100)}%`}
                onClick={() => setSelected(isOpen ? null : s.source)}
                className="group flex w-full flex-col items-center gap-2.5 rounded-xl py-2 transition-colors hover:bg-surface-hover"
              >
                <svg viewBox="0 0 100 100" className="block h-[104px] w-[104px]" aria-hidden="true">
                  <circle cx={50} cy={50} r={R} fill="none" className="stroke-hairline" strokeWidth={7} />
                  <circle
                    data-arc
                    cx={50} cy={50} r={R} fill="none"
                    stroke="currentColor" className="text-accent" strokeWidth={7}
                    strokeDasharray={`${(s.share * C).toFixed(2)} ${C.toFixed(2)}`}
                    transform="rotate(-90 50 50)"
                  />
                  {isOpen && (
                    <circle cx={50} cy={50} r={48} fill="none" stroke="currentColor" className="text-ink" strokeWidth={1.2} />
                  )}
                  <g transform="translate(32 32) scale(1.5)" className="text-ink">
                    <SourceGlyph source={s.source} />
                  </g>
                </svg>
                <span className="font-space text-[11px] font-bold text-ink">{s.label}</span>
                <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                  {s.visitors.toLocaleString('en-US')} · {Math.round(s.share * 100)}%
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {sources.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 rounded-full px-3 py-1 font-space text-[11px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:bg-surface-hover"
        >
          {expanded ? 'Show top 6' : `Show all (${sources.length})`}
        </button>
      )}

      {open && (
        <section
          aria-label={`${open.label} detail`}
          className="mt-4 rounded-2xl bg-accent-soft p-5"
        >
          <div className="flex items-center gap-3">
            <SourceGlyph source={open.source} className="text-ink" />
            <div className="min-w-0 flex-1">
              <div className="font-space text-[15px] font-bold text-ink">{open.label}</div>
              <div className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {Math.round(open.share * 100)}% of visitors in this window
              </div>
            </div>
            <Trend value={open.trend} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Visitors" value={open.visitors} />
            <Stat label="Views" value={open.views} />
            <Stat label="Views per visitor" value={open.visitors ? (open.views / open.visitors).toFixed(2) : '—'} />
          </dl>

          {open.hosts.length > 0 && (
            <div className="mt-4">
              <div className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                Referring hosts
              </div>
              <ol className="mt-2 space-y-1">
                {open.hosts.slice(0, 5).map((h) => (
                  <li key={h.host} className="flex items-baseline justify-between gap-3 text-sm text-ink">
                    <span className="truncate font-space text-xs">{h.host}</span>
                    <span className="font-space text-[11px] font-bold tabular-nums">{h.visitors}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className="mt-1 font-space text-[18px] font-bold tabular-nums text-ink">
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </dd>
    </div>
  )
}

/** The change on the previous window, or an honest "nothing to compare". */
function Trend({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        No previous window
      </span>
    )
  }
  const t = formatTrend(value)
  return (
    <span className="flex items-baseline gap-2 rounded-full bg-paper px-3 py-1.5">
      <span className={cx('font-space text-[11px] font-bold tabular-nums', trendTextClass(t.dir))}>{t.label}</span>
      <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">vs previous</span>
    </span>
  )
}
