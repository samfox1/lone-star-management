import { useState, useRef } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type EditorTour } from '../inspector-types'
import { OnSiteToggle } from '../inspector-shared'

/* ── Tour tools: pick which dates are on the site (no reorder — dates sort by date) ─ */

/** "12 SEP 26" — compact and unambiguous, from a YYYY-MM-DD column. */
function tourDateLabel(date: string | null): string {
  if (!date) return 'No date'
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return 'No date'
  return `${d} ${MONTHS_SHORT[m - 1] ?? ''} ${String(y).slice(-2)}`
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** How a show is named once it is OUT of the list — in the editor header, where the date
 *  column and the venue line are no longer beside each other to say it. */
export function showLabel(t: EditorTour): string {
  return [tourDateLabel(t.date), t.venue || 'Untitled venue'].join(' · ')
}

/**
 * The tour-date library, each with a LIVE on-site toggle (ADR 0009): this is where a
 * manager picks which dates the site shows, and the toggle takes effect without a
 * publish. Dates are ENTERED on the Tour page — venue, city, country, supporting acts
 * — so there are no fields here; the editor's job is placement, not data entry.
 *
 * No drag handles, unlike every other list: tour dates have no `sort_order` and the
 * public door orders them by `date`, so a manual order would be a lie.
 *
 * A date must be PUBLISHED once before its toggle reaches the site — the door serves
 * the published snapshot and gates it on this flag, so an unpublished date isn't there
 * to gate, and toggling it is a no-op on the live site until it's published from the
 * Tour page. The empty-state copy points there; the toggle itself carries no
 * per-row published-state indicator (the editor loads working rows, which don't know
 * publish status), so this is a known gap, not a guardrail.
 */
export function TourTools({
  tours,
  artistId,
  onRemove,
  onReorder,
  onToggleOnSite,
  onEditTour,
}: {
  tours: EditorTour[]
  artistId: string
  onRemove: (t: EditorTour) => void
  /** Reorder by ID. Only undated shows participate — see `draggable` below. */
  onReorder: (fromId: string, toId: string) => void
  onToggleOnSite: (t: EditorTour) => void
  /** Open this show full-panel — where its supporting acts are linked. The links used
   *  to live in the LINKS panel as a flat list across every date (Sam, 2026-08-09). */
  onEditTour: (t: EditorTour, label: string) => void
}) {
  const dragFrom = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function drop(toId: string) {
    const fromId = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (fromId && fromId !== toId) onReorder(fromId, toId)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {tours.length === 0 && (
        <p className="py-2 font-space text-[11px] leading-relaxed text-ink-faint">
          No dates yet. Add them on the Tour page, publish, then pick them here.
        </p>
      )}

      {tours.map((t) => {
        // A DATED show sorts itself by date on the site forever, so dragging it would be
        // a lie — the order wouldn't survive. Only undated shows, which the site can't
        // sequence on its own, get a handle (20260723120000).
        const canDrag = !t.date
        return (
        <div
          key={t.id}
          draggable={canDrag}
          onDragStart={() => canDrag && (dragFrom.current = t.id)}
          onDragEnter={() => canDrag && setDragOver(t.id)}
          onDragOver={(e) => canDrag && e.preventDefault()}
          onDrop={() => canDrag && drop(t.id)}
          onDragEnd={() => {
            dragFrom.current = null
            setDragOver(null)
          }}
          className={cx(
            'flex items-start gap-2.5 rounded-lg border border-hairline p-2.5',
            dragOver === t.id && 'ring-2 ring-accent',
          )}
        >
          {canDrag ? (
            <span className="mt-0.5 flex-none cursor-grab text-ink-faint" aria-hidden>
              <Icon name="grip" size={14} />
            </span>
          ) : null}
          <span className="mt-0.5 w-[4.5rem] flex-none font-space text-[11px] font-bold uppercase tracking-[0.04em] text-ink">
            {tourDateLabel(t.date)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[13px] font-medium">{t.venue || 'Untitled venue'}</span>
            {[t.city, t.state ?? t.country].filter(Boolean).length > 0 && (
              <span className="truncate font-space text-[11px] text-ink-muted">
                {[t.city, t.state ?? t.country].filter(Boolean).join(', ')}
              </span>
            )}
            {t.support.length > 0 && (
              <span className="truncate font-space text-[11px] text-ink-faint">+ {t.support.join(', ')}</span>
            )}
            <OnSiteToggle on={t.onSite} onToggle={() => onToggleOnSite(t)} />
          </div>
          <button
            type="button"
            aria-label={`Edit ${t.venue || 'date'}`}
            title="Supporting acts and their links"
            onClick={() => onEditTour(t, showLabel(t))}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-surface hover:text-ink"
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${t.venue || 'date'}`}
            onClick={() => onRemove(t)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
        )
      })}

      <Link
        href={`/artists/${artistId}/tour`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add date</span>
      </Link>
    </div>
  )
}
