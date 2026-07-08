import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'

/**
 * The cover-grid + empty-state shared by the content sections (tracks, releases,
 * merch, videos). Only the tile width varies (by `size`), so callers pass their
 * cards as children and an empty message; the reflowing `auto-fill` columns and
 * the dashed empty state live here once. Tour is a row list, not a grid, so it
 * doesn't use this.
 */
const COLS = {
  sm: 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]', // tracks
  md: 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]', // releases, merch
  lg: 'grid-cols-[repeat(auto-fill,minmax(230px,1fr))]', // videos
  short: 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]', // Shorts (portrait)
} as const

export function CardGrid({
  size,
  count,
  empty,
  children,
}: {
  size: keyof typeof COLS
  count: number
  /** Rendered when count === 0 — pass an <EmptyState /> for the rich card. Omit when
   *  the caller guarantees a non-empty set (e.g. per-origin groups). */
  empty?: ReactNode
  children: ReactNode
}) {
  if (count === 0) return <>{empty ?? null}</>
  return <div className={cx('grid gap-x-5 gap-y-8', COLS[size])}>{children}</div>
}
