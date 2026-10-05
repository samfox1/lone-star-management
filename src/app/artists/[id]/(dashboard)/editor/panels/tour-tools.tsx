import { cx } from '@/lib/cx'
import { useDragReorder } from '../use-drag-reorder'
import { Icon } from '@/components/ui/icons'
import { type EditorTour } from '../inspector-types'
import { clickedAControl, onSiteOnly, openRowOnClick } from '../inspector-shared'
import { AddLink, useScrollIntoFocus } from '../inspector-grid'
import { EditList, type EditListResult } from '../../(manager-tools)/_ui/edit-list'
import { RowIcon } from '../../(manager-tools)/_ui/row-icon'
import { type SelectTarget } from '@samfox1/site-bridge/protocol'

/* ── Tour tools: the dates on the site, click a venue to edit it, drag to reorder ─ */

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
 * followed Music and Merch on 2026-09-28). The Tour page is the library: every date, on the
 * site or not, and the + goes there.
 *
 * CLICK TO EDIT (Sam, 2026-10-05, prototypes/lists_before_after_20261002.html §4): no cards,
 * no ON SITE pills, no standing trash, so a venue's name no longer cuts off. A click on a
 * venue opens it as a line with ✓, the trash (it takes the date OFF the site, and the row
 * then leaves the panel; deleting a date stays on the Tour page) and ⋯ (the whole show,
 * full-panel: its date, place, tickets and supporting acts). The venue saves through the same
 * tour-date door the Tour page uses: a draft, and Publish commits it (PRESENCE_PLAN).
 *
 * A drag renumbers the WHOLE list (`onReorder` works on every date), which is what keeps a
 * hidden date's place. A click on a row also outlines that date on the site.
 */
export function TourTools({
  tours,
  artistId,
  onReorder,
  onToggleOnSite,
  onSaveVenue,
  onEditTour,
  focusedKey,
  onFocus,
}: {
  tours: EditorTour[]
  artistId: string
  /** Reorder by ID — every row drags (manual mode). */
  onReorder: (fromId: string, toId: string) => void
  onToggleOnSite: (t: EditorTour) => void
  /** Save a date's venue. `{ error }` keeps the line open with what was typed. */
  onSaveVenue: (t: EditorTour, venue: string) => Promise<EditListResult>
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

  return (
    <div className="px-5 py-2">
      {/* No empty-state copy (Sam, 2026-08-12): an empty Tour panel just shows the +. */}
      {onSiteOnly(tours).map((t) => {
        const focused = focusedKey === `item:tour_date:${t.id}`
        const place = [t.city, t.state ?? t.country].filter(Boolean).join(', ')
        // EVERY show drags (Sam, 2026-08-17): the first drag numbers every row, and
        // connected sites treat a numbered dated row as manual mode, so the dragged
        // order survives.
        return (
          <TourRow
            key={t.id}
            focused={focused}
            {...dragProps(t.id)}
            // A click anywhere on the row opens its venue (Sam, 2026-10-05: the row is the
            // target) and SELECTS the date — outlines it on the site — like every other item
            // panel. Its glyphs (✓, trash, ⋯) and its open line do their own thing.
            onClick={(e) => {
              const onVenue = e.target instanceof Element && !!e.target.closest('button:not([aria-label])')
              if (clickedAControl(e) && !onVenue) return
              onFocus?.({ kind: 'item', assetType: 'tour_date', id: t.id })
              openRowOnClick(e)
            }}
            className={cx(
              'group relative flex cursor-pointer items-start gap-2.5 border-b border-hairline py-3',
              (focused || isOver(t.id)) && 'ring-2 ring-accent ring-inset',
            )}
          >
            <span
              className="absolute -left-4 top-[15px] cursor-grab text-ink-faint opacity-0 transition-opacity group-hover:opacity-60"
              aria-hidden
            >
              <Icon name="grip" size={14} />
            </span>
            <span className="mt-[5px] w-[4.5rem] flex-none font-space text-[11px] font-bold uppercase tracking-[0.04em] text-ink">
              {tourDateLabel(t.date)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <EditList
                items={[t]}
                itemKey={(x) => x.id}
                text={(x) => x.venue ?? ''}
                title={(x) => x.venue || undefined}
                label="Venue"
                placeholder="Untitled venue"
                maxLength={200}
                textClass="font-space text-[13px] font-medium leading-6 text-ink"
                className="min-w-0"
                onSave={(_, venue) => onSaveVenue(t, venue)}
                onRemove={() => onToggleOnSite(t)}
                removeLabel={(x) => `Take ${x.venue || 'this date'} off the site`}
                extra={(x) => (
                  <RowIcon icon="more" label="All details" variant="bare" glyphSize={14} onClick={() => onEditTour(x, showLabel(x))} />
                )}
              />
              {place && <span className="truncate font-space text-[11px] text-ink-muted">{place}</span>}
              {t.support.length > 0 && (
                <span className="truncate font-space text-[11px] text-ink-faint">+ {t.support.join(', ')}</span>
              )}
            </span>
          </TourRow>
        )
      })}

      {/* A bare + (Sam, 2026-10-02: never "Add date" in words), still to the Tour page: dates
          are entered there. */}
      <div className="pt-3">
        <AddLink href={`/artists/${artistId}/tour`} label="Add date" />
      </div>
    </div>
  )
}
