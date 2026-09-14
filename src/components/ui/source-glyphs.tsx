import type { ReactNode } from 'react'
import { SOURCES, type SourceKey } from '@/lib/analytics-sources'

/**
 * One monochrome mark per traffic source, drawn on a 24×24 grid.
 *
 * Monochrome on purpose: the page has two accents and these are not among them.
 * The mark says WHICH platform; the ring around it says how much. Brand colours
 * would make Instagram's ring pink and the chart would stop being one chart.
 *
 * Every key in `SOURCES` has an entry, and a test derives that from the registry
 * rather than listing keys — a source added to the bucket list without a mark
 * would otherwise render as an empty circle and nothing would say so.
 */
const GLYPHS: Record<SourceKey, ReactNode> = {
  instagram: (
    <><g fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2.7" y="2.7" width="18.6" height="18.6" rx="5.6"/><circle cx="12" cy="12" r="4.7"/></g><circle cx="17.4" cy="6.6" r="1.35" fill="currentColor"/></>
  ),
  tiktok: (
    <><path d="M13.4 2.6 h3.2 a5.2 5.2 0 0 0 4.8 4.6 v3.2 a8.3 8.3 0 0 1 -4.8 -1.7 v6.5 a6.5 6.5 0 1 1 -6.5 -6.5 q0.7 0 1.4 0.16 v3.3 a3.2 3.2 0 1 0 1.9 2.94 z" fill="currentColor"/></>
  ),
  youtube: (
    <><rect x="1.9" y="4.7" width="20.2" height="14.6" rx="4.6" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M 9.9 8.4 L 16.3 12 L 9.9 15.6 Z" fill="currentColor"/></>
  ),
  facebook: (
    <><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="1.9"/><path d="M13.15 19.5 v-6.5 h2.15 l0.35 -2.55 h-2.5 v-1.6 c0 -0.74 0.2 -1.24 1.28 -1.24 h1.32 V5.6 a17 17 0 0 0 -1.96 -0.1 c-1.95 0 -3.28 1.19 -3.28 3.37 v1.88 H8.4 v2.55 h2.11 v6.5 z" fill="currentColor"/></>
  ),
  x: (
    <><path d="M3.1 2.9 h5.55 l4.3 5.85 5.05 -5.85 h2.35 l-6.35 7.35 6.8 9.2 h-5.55 l-4.55 -6.2 -5.35 6.2 H3 l6.65 -7.7 z" fill="currentColor"/></>
  ),
  spotify: (
    <><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><g fill="none" stroke="currentColor" strokeLinecap="round"><path d="M6.7 9.1 q5.5 -1.7 10.6 1.2" strokeWidth="1.8"/><path d="M7.5 12.4 q4.6 -1.4 8.8 0.95" strokeWidth="1.6"/><path d="M8.3 15.5 q3.6 -1.05 7 0.75" strokeWidth="1.4"/></g></>
  ),
  apple_music: (
    <><g fill="currentColor"><ellipse cx="7.3" cy="17.3" rx="3.05" ry="2.5"/><ellipse cx="17.15" cy="15.25" rx="3.05" ry="2.5"/></g><path d="M10.35 17.3 V7.9 l9.85 -2.1 v9.45" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round"/><path d="M10.35 10.9 L20.2 8.8" fill="none" stroke="currentColor" strokeWidth="1.7"/></>
  ),
  soundcloud: (
    <><g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none"><path d="M3.1 13.2 v3.6"/><path d="M5.8 11.2 v5.6"/><path d="M8.5 9.6 v7.2"/><path d="M11.2 8.4 v8.4"/></g><path d="M13.5 16.8 V7.9 a4.7 4.7 0 0 1 6.6 4.3 h0.3 a2.3 2.3 0 0 1 0 4.6 z" fill="currentColor"/></>
  ),
  bandcamp: (
    <><path d="M2.6 16.9 L9.7 7.1 H21.4 L14.3 16.9 Z" fill="currentColor"/></>
  ),
  google: (
    // The G: a ring open at the upper right, its end cut flat on the midline, and
    // the bar hanging from that line to the ring's outer edge.
    <><path d="M18.13 6.86 A8 8 0 1 0 20 12" fill="none" stroke="currentColor" strokeWidth="3.6"/><rect x="12" y="12" width="9.8" height="3.6" fill="currentColor"/></>
  ),
  bing: (
    <><path d="M6.3 2.6 L10.5 4.15 v11.4 l4.05 -1.7 -2.1 -1 -1.95 -4.4 6.6 2.95 c1.75 0.8 2.55 1.6 2.55 3 0 1.6 -0.95 2.7 -3.15 3.8 L10.5 21.4 6.3 19 z" fill="currentColor"/></>
  ),
  ai: (
    <><path d="M12 2.1 C13.05 8 16 10.95 21.9 12 16 13.05 13.05 16 12 21.9 10.95 16 8 13.05 2.1 12 8 10.95 10.95 8 12 2.1 Z" fill="currentColor"/></>
  ),
  linktree: (
    <><path d="M12 3 v18 M5.5 8.5 l6.5 4.2 6.5 -4.2 M6 15 l6 -3.3 6 3.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></>
  ),
  bandsintown: (
    <><path d="M7 4.5 v15 M7 4.5 h6.2 a3.4 3.4 0 0 1 0 6.8 H7 M7 11.3 h7.2 a4.1 4.1 0 0 1 0 8.2 H7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></>
  ),
  songkick: (
    <><path d="M16.5 7.2 a4.5 3.2 0 0 0 -4.5 -2.2 c-2.6 0 -4.3 1.3 -4.3 3.1 0 4 8.8 2 8.8 6.6 0 2 -1.9 3.4 -4.7 3.4 a5.1 3.4 0 0 1 -5 -2.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></>
  ),
  email: (
    <><rect x="2.7" y="5.3" width="18.6" height="13.4" rx="2.7" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M3.8 7.1 L12 12.9 L20.2 7.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></>
  ),
  direct: (
    <><path d="M5.2 2.9 L5.2 19.4 L9.7 15.1 L12.5 21.1 L15.2 19.8 L12.4 14 L18.5 13.5 Z" fill="currentColor"/></>
  ),
  other: (
    <><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></>
  ),
}

/** Marks for rings that are not buckets: the folded "Search" ring. Kept out of
 *  GLYPH_KEYS, which must mirror SOURCE_KEYS exactly. */
const EXTRA_GLYPHS: Record<string, ReactNode> = {
  search: (
    <><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M15.5 15.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></>
  ),
}

export function SourceGlyph({ source, className, size = 24 }: { source: string; className?: string; size?: number }) {
  const key = (SOURCES.find((s) => s.key === source)?.key ?? 'other') as SourceKey
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      {EXTRA_GLYPHS[source] ?? GLYPHS[key]}
    </svg>
  )
}

/** Exposed for the registry test only. */
export const GLYPH_KEYS = Object.keys(GLYPHS) as SourceKey[]
