'use client'

import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { CardModal } from '../card-modal'
import { SelectToggle } from '../select-toggle'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { EntitySparkline } from '../entity-sparkline'
import { deleteContentAction, updateContentAction } from '../actions'
import { SaveForm } from '../save-form'
import { TagInput } from '../tag-input'
import { BoolToggle } from '../bool-toggle'
import { US_STATES } from '@/lib/us-states'

export type TourDate = {
  id: string
  date: string | null
  venue: string | null
  city: string | null
  /** Two-letter US state code (TX). null for out-of-country dates. */
  state: string | null
  country: string | null
  /** Manager marked this as an old show — it renders in Past regardless of date. */
  is_past: boolean
  ticket_url: string | null
  /** The other acts on the bill. Never null — the column is NOT NULL DEFAULT '{}'. */
  support: string[]
  source: string | null
  /** Whether the date is currently live on the public site. */
  on_site: boolean
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
 * checkbox is a LIVE on-site toggle owned by the parent browser (ADR 0009); clicking
 * the row opens the edit modal.
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
  const { day, month } = dateBlock(tour.date)
  const badge = tour.source && tour.source !== 'manual' ? tour.source : null
  // "Austin, TX" — state preferred (US shows), country as the fallback for a date
  // booked outside the US. Same join the public site uses, so the row previews it.
  const place = [tour.city, tour.state ?? tour.country].filter(Boolean).join(', ')

  return (
    <>
      <div className="flex items-center gap-5 border-b border-hairline py-5 last:border-0">
        {/* selected === onSite under a live toggle, so this only ever reads live or
            off — SelectToggle's pending-add/pending-drop states can't arise here. */}
        <SelectToggle
          selected={onSite}
          onSite={onSite}
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
            {tour.is_past ? (
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
        {tour.ticket_url && (
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
      </div>

      <CardModal
        open={open}
        onClose={() => setOpen(false)}
        deleteAction={deleteContentAction.bind(null, 'tour_date', tour.id, artistId)}
        deleteLabel="Delete date"
        deleteNoun="Date"
      >
        <h3 className="text-lg font-bold tracking-[-0.01em]">Edit date</h3>
        {badge && (
          <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">from {badge}</div>
        )}
        <div className="mt-4">
          <EntitySparkline artistId={artistId} entityIds={[tour.id]} label="Ticket clicks · 30d" />
        </div>
        <SaveForm action={updateContentAction.bind(null, 'tour_date', tour.id, artistId)} className="mt-4 space-y-2">
          <div className="flex gap-2">
            <input name="date" type="date" defaultValue={tour.date ?? ''} className={`${inputClass} w-40`} />
            <input name="city" defaultValue={tour.city ?? ''} placeholder="City" className={`${inputClass} flex-1`} />
          </div>
          <div className="flex gap-2">
            <input name="venue" defaultValue={tour.venue ?? ''} placeholder="Venue" className={`${inputClass} min-w-0 flex-1`} />
            <select
              name="state"
              defaultValue={tour.state ?? ''}
              aria-label="State"
              className={`${inputClass} w-28 ${tour.state ? 'text-ink' : 'text-ink-faint'}`}
            >
              <option value="">State</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code} className="text-ink">
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <input name="country" defaultValue={tour.country ?? ''} placeholder="Country (outside the US)" className={`${inputClass} w-full`} />
          <input name="ticket_url" type="url" defaultValue={tour.ticket_url ?? ''} placeholder="Tickets URL" className={`${inputClass} w-full`} />
          <BoolToggle name="is_past" label="This was an old show" defaultChecked={tour.is_past} />
          {/* Uncontrolled like its siblings' defaultValue, and remounted by CardModal
              on every open — so an abandoned edit doesn't linger. */}
          <TagInput name="support" defaultValue={tour.support} placeholder="Also performing…" />
          <button type="submit" className={buttonClass('ghost')}>
            Save
          </button>
        </SaveForm>
      </CardModal>
    </>
  )
}
