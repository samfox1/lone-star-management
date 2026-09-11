'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { CardModal } from '../card-modal'
import { SelectToggle } from '../select-toggle'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { deleteContentAction, updateContentAction } from '../actions'
import { toast } from '../toast'
import { SupportActs } from './support-acts'
import { supportActsOf } from '@/lib/content'
import { DateSquare, KvCells, KvField, KvRow, MetaDot, ModalHeader } from '../modal-kit'
import { US_STATES } from '@/lib/us-states'

const STATE_OPTIONS = US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))

export type TourDate = {
  id: string
  date: string | null
  venue: string | null
  city: string | null
  /** Two-letter US state code (TX). null for out-of-country dates. */
  state: string | null
  country: string | null
  /** The stored flag, kept for rows written before 2026-09-11 (undated old shows). It
   *  is no longer editable anywhere: a date in the past IS an old show. See `past`. */
  is_past: boolean
  /** DERIVED by the page (lib/tour isPastShow): by date, or the flag. What the row shows. */
  past: boolean
  ticket_url: string | null
  /** The other acts on the bill. Never null — the column is NOT NULL DEFAULT '{}'. */
  support: string[]
  /** Where each act links out, by name (20260717140000). Edited with the names. */
  support_urls: Record<string, string>
  source: string | null
  /** Whether the date is currently live on the public site. */
  on_site: boolean
  /** What the PUBLISHED copy says (draft presence, 2026-09-11). */
  published_on_site?: boolean
  /** 30-day ticket-clicks (from analytics_by_entity). */
  stat?: number
}

/** Split a YYYY-MM-DD date into a day number + short month, for the date block. */
function dateBlock(date: string | null): { day: string; month: string } {
  if (!date) return { day: '--', month: '' }
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return { day: '--', month: '' }
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return { day: String(d), month: MONTHS[m - 1] ?? '' }
}

/**
 * A tour date as a prototype-style list row (toggle · mono date block · venue/city ·
 * tickets). Tour has no cover art, so it's a dense list rather than a grid. The
 * checkbox is a draft on-site toggle owned by the parent browser (ADR 0010); clicking
 * the row opens the edit modal, and the row's own ⋯ menu offers Edit / Remove (Sam,
 * 2026-09-11) so neither needs a trip through the modal footer.
 */
export function TourRow({
  tour,
  artistId,
  onSite,
  onToggleOnSite,
}: {
  tour: TourDate
  artistId: string
  /** Live on-site state (optimistic — may lead `tour.on_site` for a beat). */
  onSite: boolean
  onToggleOnSite: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { day, month } = dateBlock(tour.date)
  const badge = tour.source && tour.source !== 'manual' ? tour.source : null
  // "Austin, TX" — state preferred (US shows), country as the fallback for a date
  // booked outside the US. Same join the public site uses, so the row previews it.
  const place = [tour.city, tour.state ?? tour.country].filter(Boolean).join(', ')

  // Same close rules as the song card's menu: a click anywhere else, or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // The same prompt CardModal's footer Delete uses — a removal is the one thing on this
  // row with no undo, so it is never one click.
  async function remove() {
    setMenuOpen(false)
    if (!window.confirm("Delete this date? This can't be undone.")) return
    const res = await deleteContentAction('tour_date', tour.id, artistId)
    if (res?.error) toast(res.error, 'error')
    else toast('Date removed')
  }

  /** One row → one field. Absent keys are skipped server-side (extractUpdate), so a
   *  FormData with a single entry writes exactly that column and nothing else. */
  const saveField = (field: string) => async (value: string) => {
    const fd = new FormData()
    fd.set(field, value)
    return updateContentAction('tour_date', tour.id, artistId, fd)
  }
  const fail = (message: string) => toast(message, 'error')

  return (
    <>
      <div className="flex items-center gap-5 border-b border-hairline py-5 last:border-0">
        {/* `selected` is the draft (optimistic), `onSite` what is PUBLISHED — a toggle is a
            draft until Publish (PRESENCE_PLAN, revised 2026-09-11), so the pending states
            "checked, publish to put on site" / "on site, publish to remove" are real here. */}
        <SelectToggle
          selected={onSite}
          onSite={tour.published_on_site ?? onSite}
          onToggle={onToggleOnSite}
          label={tour.venue || 'date'}
          liveClassName="border-accent bg-accent text-white"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex flex-1 items-center gap-4 text-left"
        >
          <div className="w-11 flex-none text-center">
            {/* A flagged old show reads "PAST" where the day would be — often it has
                no date at all, and either way it's an old show, not an upcoming one. */}
            {tour.past ? (
              <div className="font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-faint">Past</div>
            ) : (
              <>
                <div className="font-space text-[19px] font-bold leading-none tracking-[-0.02em]">{day}</div>
                <div className="mt-0.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{month}</div>
              </>
            )}
          </div>
          {/* Venue · city · featured artists as three columns on the (now wide) row —
              stacked on mobile, side-by-side from sm up. The empty columns keep their
              width, so venues/cities/lineups line up straight down the list. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
            <div className="min-w-0 sm:flex-1">
              <div className="truncate text-sm font-semibold group-hover:text-accent">
                {tour.venue || 'Untitled venue'}
              </div>
              <CardStat value={tour.stat ?? 0} label={metricLabel('tour_date')} />
            </div>
            <div className="min-w-0 truncate font-space text-xs text-ink-muted sm:flex-1">{place}</div>
            {/* Reads the same as the public site's tour list ("+ Arlo, Bo Reed"). */}
            <div className="min-w-0 truncate font-space text-xs text-ink-faint sm:flex-1">
              {tour.support.length > 0 ? `+ ${tour.support.join(', ')}` : ''}
            </div>
          </div>
          {badge && (
            <span className="font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">{badge}</span>
          )}
        </button>
        {/* No ticket button on a past show — nothing to buy (Sam, 2026-09-11). */}
        {tour.ticket_url && !tour.past && (
          <a
            href={tour.ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Tickets"
            aria-label="Tickets"
            className="inline-flex flex-none items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
          >
            <Icon name="ticket" size={16} />
          </a>
        )}
        <div ref={menuRef} className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`${tour.venue || 'date'} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="more" size={18} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-9 z-10 w-36 overflow-hidden rounded-xl border border-hairline bg-paper py-1 shadow-2xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setOpen(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <Icon name="edit" size={15} /> Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={remove}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-red hover:bg-danger-soft"
              >
                <Icon name="trash" size={15} /> Remove
              </button>
            </div>
          )}
        </div>
      </div>

      <CardModal
        open={open}
        onClose={() => setOpen(false)}
        label={tour.venue || 'Untitled venue'}
        analyticsHref={`/artists/${artistId}`}
        deleteAction={deleteContentAction.bind(null, 'tour_date', tour.id, artistId)}
        deleteLabel="Delete"
        deleteNoun="Date"
      >
        {/* The modal grammar (modal-kit): the venue IS the title, the date block stands
            where cover art would, the place is the meta. Every row saves its own field;
            there is no Save, no "old show" toggle (a past date is an old show), and no
            click numbers (the Analytics button in the corner goes to that page). */}
        <ModalHeader
          square={<DateSquare date={tour.date} past={tour.past} />}
          title={tour.venue || 'Untitled venue'}
          meta={
            <>
              {place ? <span>{place}</span> : null}
              {place && badge ? <MetaDot /> : null}
              {badge ? <span>from {badge}</span> : null}
            </>
          }
        />
        <div className="mt-5">
          <KvField label="Date" value={tour.date ?? ''} type="date" mono onSave={saveField('date')} onError={fail} />
          <KvField label="Venue" value={tour.venue ?? ''} onSave={saveField('venue')} onError={fail} />
          <KvCells
            label="Where"
            cells={[
              { label: 'City', value: tour.city ?? '', onSave: saveField('city'), onError: fail },
              { label: 'State', value: tour.state ?? '', options: STATE_OPTIONS, onSave: saveField('state'), onError: fail },
              { label: 'Country', value: tour.country ?? '', onSave: saveField('country'), onError: fail },
            ]}
          />
          <KvField label="Tickets" value={tour.ticket_url ?? ''} type="url" mono onSave={saveField('ticket_url')} onError={fail} />
          <KvRow label="Lineup">
            <SupportActs artistId={artistId} tourDateId={tour.id} acts={supportActsOf(tour)} />
          </KvRow>
        </div>
      </CardModal>
    </>
  )
}
