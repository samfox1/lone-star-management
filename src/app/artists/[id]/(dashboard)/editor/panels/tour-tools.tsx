import { cx } from '@/lib/cx'
import { useDragReorder } from '../use-drag-reorder'
import { Icon } from '@/components/ui/icons'
import { EDIT_GLYPH, ICON_BOLD, ICON_HOVER } from '@/components/ui/icon-hover'
import { type EditorTour } from '../inspector-types'
import { OnSiteToggle, onSiteOnly } from '../inspector-shared'
import { AddLink, useScrollIntoFocus } from '../inspector-grid'
import { useConfirm } from '../../confirm-dialog'
import { EDIT_TARGET, REVEAL_ON_HOVER } from '../../(manager-tools)/_ui/styles'
import { type SelectTarget } from '@samfox1/site-bridge/protocol'

/* ── Tour tools: pick which dates are on the site, drag to reorder them ─ */

/** One row's shell: aria-current + scroll-into-view when a routed select lands on it —
 *  the same affordance the video cards and link rows carry. */
function TourRow({
  focused,
  children,
  ...rest
}: { focused: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }) {
  const ref = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div ref={ref} aria-current={focused ? 'true' : undefined} {...rest}>
      {children}
    </div>
  )
}

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
function showLabel(t: EditorTour): string {
  return [tourDateLabel(t.date), t.venue || 'Untitled venue'].join(' · ')
}

/**
 * The dates ON THE SITE, and only those (Sam, 2026-09-09: "only what is on the site"; Tour
 * followed Music and Merch on 2026-09-28). The Tour page is the library: every date, on
 * the site or not, and "Add date" goes there. So the toggle here only takes a date OFF,
 * and the row then leaves the panel. A drag still renumbers the WHOLE list (`onReorder`
 * works on every date), which is what keeps a hidden date's place. Dates are ENTERED on
 * the Tour page (venue, city, country, supporting acts), so there are no fields here.
 *
 * A date must be PUBLISHED once before its toggle reaches the site — the door serves
 * the published snapshot and gates it on this flag, so an unpublished date isn't there
 * to gate, and toggling it is a no-op on the live site until it's published from the
 * Tour page. The toggle carries no per-row published-state indicator (the editor
 * loads working rows, which don't know publish status) — a known gap, not a guardrail.
 */
export function TourTools({
  tours,
  artistId,
  onRemove,
  onReorder,
  onToggleOnSite,
  onEditTour,
  focusedKey,
  onFocus,
}: {
  tours: EditorTour[]
  artistId: string
  onRemove: (t: EditorTour) => void
  /** Reorder by ID — every row drags (manual mode). */
  onReorder: (fromId: string, toId: string) => void
  onToggleOnSite: (t: EditorTour) => void
  /** Open this show full-panel — where its supporting acts are linked. The links used
   *  to live in the LINKS panel as a flat list across every date (Sam, 2026-08-09). */
  onEditTour: (t: EditorTour, label: string) => void
  /** Two-way selection, the same contract every other item panel carries. Tour was the
   *  last one without it (Sam, 2026-08-10): a routed select opened the panel and rang
   *  nothing, and no click here reached the preview. */
  focusedKey?: string | null
  onFocus?: (target: SelectTarget) => void
}) {
  const { dragProps, isOver } = useDragReorder(onReorder)
  // The trash ASKS (Sam, 2026-09-28: "'are you sure' is good when its a delete"). Nothing
  // brings a deleted show back: Revert never re-inserts a library row, because a show's
  // coordinates and source are not in the publish log.
  const { ask, dialog } = useConfirm()
  async function remove(t: EditorTour) {
    if (await ask(`Delete ${t.venue || 'this date'}? This can't be undone.`)) onRemove(t)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {dialog}
      {/* No empty-state copy (Sam, 2026-08-12): an empty Tour panel just shows nothing —
          dates are entered on the Tour page, and a "No dates yet." line is noise. */}
      {onSiteOnly(tours).map((t) => {
        // EVERY show drags (Sam, 2026-08-17): the first drag numbers every row, and
        // connected sites treat a numbered dated row as manual mode, so the dragged
        // order survives. (An undated-only gate lived here before that.)
        return (
        <TourRow
          key={t.id}
          focused={focusedKey === `item:tour_date:${t.id}`}
          {...dragProps(t.id)}
          className={cx(
            EDIT_TARGET,
            'flex items-start gap-2.5 rounded-lg border p-2.5',
            focusedKey === `item:tour_date:${t.id}` ? 'border-accent ring-2 ring-accent' : 'border-hairline',
            isOver(t.id) && 'ring-2 ring-accent',
          )}
        >
          <span className="mt-0.5 flex-none cursor-grab text-ink-faint" aria-hidden>
            <Icon name="grip" size={14} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* The row's face SELECTS — outlines this date on the site — matching every
                other item panel. The toggle/Edit/Remove are SIBLINGS with their own
                clicks (a button may not contain a button), so selecting never fires them. */}
            <button
              type="button"
              aria-label={`Select ${t.venue || 'date'}`}
              onClick={() => onFocus?.({ kind: 'item', assetType: 'tour_date', id: t.id })}
              className="flex min-w-0 items-start gap-2.5 text-left"
            >
              <span className="mt-0.5 w-[4.5rem] flex-none font-space text-[11px] font-bold uppercase tracking-[0.04em] text-ink">
                {tourDateLabel(t.date)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[13px] font-medium">{t.venue || 'Untitled venue'}</span>
                {[t.city, t.state ?? t.country].filter(Boolean).length > 0 && (
                  <span className="truncate font-space text-[11px] text-ink-muted">
                    {[t.city, t.state ?? t.country].filter(Boolean).join(', ')}
                  </span>
                )}
                {t.support.length > 0 && (
                  <span className="truncate font-space text-[11px] text-ink-faint">+ {t.support.join(', ')}</span>
                )}
              </span>
            </button>
            <div className="pl-[5.1rem]">
              <OnSiteToggle on={t.onSite} onToggle={() => onToggleOnSite(t)} />
            </div>
          </div>
          <button
            type="button"
            aria-label={`Edit ${t.venue || 'date'}`}
            title="Supporting acts and their links"
            onClick={() => onEditTour(t, showLabel(t))}
            // Shown while the row is hovered (the row is its EDIT_TARGET, _ui/styles.ts).
            className={cx('mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-faint transition-opacity', ICON_HOVER, REVEAL_ON_HOVER)}
          >
            <Icon name="edit" size={EDIT_GLYPH} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${t.venue || 'date'}`}
            onClick={() => void remove(t)}
            className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-faint hover:text-accent-red ${ICON_BOLD}`}
          >
            <Icon name="trash" size={15} />
          </button>
        </TourRow>
        )
      })}

      <AddLink href={`/artists/${artistId}/tour`} label="Add date" />
    </div>
  )
}
