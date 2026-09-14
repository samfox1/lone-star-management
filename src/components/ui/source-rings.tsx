'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import type { SourceSummary } from '@/lib/analytics'
import { SourceGlyph } from '@/components/ui/source-glyphs'
import { SEARCH_SOURCES, isSearchHost } from '@/lib/analytics-sources'

/**
 * Where visitors came from: one ring per source, the platform's mark inside it,
 * the arc around it that source's share of everyone. The centre is a coin with
 * the mark on one face and the share on the other; hover (or focus) turns it
 * over — the number lives IN the ring, not under it (Sam, 2026-09-13: no detail
 * container, no count line below the name, and "literally flip").
 *
 * Up to eight rings show, four to a row, ranked. Past eight, the eighth slot is
 * a "See all" tile and seven rings show (Sam, 2026-09-14: "only show the see
 * all button when capping it at 8"); expanded, everything shows with a "Show
 * fewer" tile at the end.
 * Two folds before ranking (Sam, 2026-09-13): every search engine — Google,
 * Bing, and any search host the door left in the catch-all — is ONE "Web search"
 * ring with a magnifying glass; whatever else has no mark of its own is ONE
 * "Other" ring. Direct keeps its ring; it has a mark.
 *
 * Every ring is the blue accent. Colour never carries identity here — the mark
 * does — so a filter that drops a source cannot repaint the survivors.
 */
const R = 42
const C = 2 * Math.PI * R
/** Slots in the short row: two rows of four. The last one is the See all tile when anything is hidden. */
const SLOTS = 8
const OTHER = 'other'

const SEARCH = 'search'

/** One ring: a source with a mark, or one of the two folds. */
type Ring = { key: string; label: string; visitors: number; share: number }

/** Every source as rings: search engines folded into one, the markless into
 *  Other, biggest first. Shares are of everyone. */
export function ringsOf(sources: SourceSummary[]): Ring[] {
  const total = sources.reduce((n, s) => n + s.visitors, 0)
  const share = (n: number) => (total ? n / total : 0)
  const rings: Ring[] = []
  let search = 0
  let other = 0
  for (const s of sources) {
    if ((SEARCH_SOURCES as readonly string[]).includes(s.source)) { search += s.visitors; continue }
    if (s.source !== OTHER) { rings.push({ key: s.source, label: s.label, visitors: s.visitors, share: s.share }); continue }
    // The catch-all: a search engine the door did not know is still a search.
    for (const h of s.hosts) {
      if (isSearchHost(h.host)) search += h.visitors
      else other += h.visitors
    }
    // Hostless other rows (an unknown utm_source) have no host to test; they are other.
    other += s.visitors - s.hosts.reduce((n, h) => n + h.visitors, 0)
  }
  if (search > 0) rings.push({ key: SEARCH, label: 'Web search', visitors: search, share: share(search) })
  if (other > 0) rings.push({ key: OTHER, label: 'Other', visitors: other, share: share(other) })
  return rings.sort((a, b) => b.visitors - a.visitors)
}

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
  const rings = ringsOf(sources)
  const shown = rings.length <= SLOTS ? rings.length : SLOTS - 1
  const hidden = rings.length - shown
  const visible = expanded ? rings : rings.slice(0, shown)

  if (sources.length === 0) {
    return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  }

  return (
    <div className={className}>
      <ul className="grid grid-cols-4 gap-4" aria-label="Sources">
        {visible.map((s) => {
          const pct = `${Math.round(s.share * 100)}%`
          return (
            <li key={s.key}>
              <div
                tabIndex={0}
                role="img"
                aria-label={`${s.label}: ${s.visitors} ${s.visitors === 1 ? 'visitor' : 'visitors'}, ${pct}`}
                className="group flex w-full flex-col items-center gap-2.5 rounded-xl py-2 outline-none"
              >
                <div className="relative h-[104px] w-[104px]">
                  <svg viewBox="0 0 100 100" className="block h-full w-full" aria-hidden="true">
                    <circle cx={50} cy={50} r={R} fill="none" className="stroke-hairline" strokeWidth={7} />
                    <circle
                      data-arc
                      cx={50} cy={50} r={R} fill="none"
                      stroke="currentColor" className="text-accent" strokeWidth={7}
                      strokeDasharray={`${(s.share * C).toFixed(2)} ${C.toFixed(2)}`}
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  {/* The centre is a coin: the mark on one face, the share on the other.
                      Hover or focus turns it over (Sam, 2026-09-13: "literally flip"). */}
                  <div className="absolute inset-0 flex items-center justify-center perspective-normal">
                    <div
                      data-coin
                      className="relative h-16 w-16 transform-3d transition-transform duration-500 ease-[cubic-bezier(.4,0,.2,1)] group-hover:rotate-y-180 group-focus-visible:rotate-y-180 motion-reduce:transition-none"
                    >
                      <div data-mark className="absolute inset-0 flex items-center justify-center rounded-full bg-surface text-ink backface-hidden">
                        <SourceGlyph source={s.key} className="h-9 w-9" />
                      </div>
                      <div data-share className="absolute inset-0 flex items-center justify-center rounded-full bg-surface font-space text-[19px] font-bold tabular-nums text-ink backface-hidden rotate-y-180">
                        {pct}
                      </div>
                    </div>
                  </div>
                </div>
                <span className="font-space text-[11px] font-bold text-ink">{s.label}</span>
              </div>
            </li>
          )
        })}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
              className="group flex w-full flex-col items-center gap-2.5 rounded-xl py-2 outline-none"
            >
              <span className="relative flex h-[104px] w-[104px] items-center justify-center">
                <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <circle cx={50} cy={50} r={R} fill="none" className="stroke-hairline" strokeWidth={7} strokeDasharray="3 5" />
                </svg>
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface font-space text-[19px] font-bold tabular-nums text-ink transition-colors group-hover:bg-surface-hover">
                  {expanded ? '−' : `+${hidden}`}
                </span>
              </span>
              <span className="font-space text-[11px] font-bold text-ink">{expanded ? 'Show fewer' : 'See all'}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
