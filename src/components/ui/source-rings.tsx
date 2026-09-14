'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import type { SourceSummary } from '@/lib/analytics'
import { SourceGlyph } from '@/components/ui/source-glyphs'

/**
 * Where visitors came from: one ring per source, the platform's mark inside it,
 * the arc around it that source's share of everyone. Hover (or focus) a ring
 * and its centre flips from the mark to the share — the number lives IN the
 * ring, not under it (Sam, 2026-09-13: no detail container, no count line
 * below the name).
 *
 * The first six show; the rest sit behind one control. Six is the number a
 * person can compare by eye; past that they are reading a list, and the list is
 * there for them.
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
  const visible = expanded ? sources : sources.slice(0, SHOWN)

  if (sources.length === 0) {
    return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  }

  return (
    <div className={className}>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6" aria-label="Sources">
        {visible.map((s) => {
          const pct = `${Math.round(s.share * 100)}%`
          return (
            <li key={s.source}>
              <div
                tabIndex={0}
                role="img"
                aria-label={`${s.label}: ${s.visitors} visitors, ${pct}`}
                className="group flex w-full flex-col items-center gap-2.5 rounded-xl py-2 outline-none"
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
                  {/* The two faces of the centre: the mark, and the share it flips to. */}
                  <g data-mark transform="translate(32 32) scale(1.5)" className="text-ink transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
                    <SourceGlyph source={s.source} />
                  </g>
                  <text
                    data-share
                    x={50} y={50} textAnchor="middle" dominantBaseline="central"
                    fill="currentColor" fontSize={22} fontWeight={700}
                    className="font-space text-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    {pct}
                  </text>
                </svg>
                <span className="font-space text-[11px] font-bold text-ink">{s.label}</span>
              </div>
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
    </div>
  )
}
