'use client'

import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { CardModal } from '../card-modal'
import { deleteContentAction, updateContentAction } from '../actions'

export type TourDate = {
  id: string
  date: string | null
  venue: string | null
  city: string | null
  ticket_url: string | null
  source: string | null
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
 * A tour date as a prototype-style row (mono date block · venue/city · tickets);
 * clicking opens a modal to edit its fields or delete. Synced rows carry a source
 * badge. Keeps the list scannable while preserving the full editor.
 */
export function TourRow({ tour, artistId }: { tour: TourDate; artistId: string }) {
  const [open, setOpen] = useState(false)
  const { day, month } = dateBlock(tour.date)
  const badge = tour.source && tour.source !== 'manual' ? tour.source : null

  return (
    <>
      <div className="flex items-center gap-4 border-b border-hairline py-3 last:border-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex flex-1 items-center gap-4 text-left"
        >
          <div className="w-11 flex-none text-center">
            <div className="font-space text-[19px] font-bold leading-none tracking-[-0.02em]">{day}</div>
            <div className="mt-0.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{month}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold group-hover:text-accent">
              {tour.venue || 'Untitled venue'}
            </div>
            {tour.city && <div className="truncate font-space text-xs text-ink-muted">{tour.city}</div>}
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
            className={buttonClass('ghost', 'flex-none')}
          >
            Tickets
          </a>
        )}
      </div>

      <CardModal
        open={open}
        onClose={() => setOpen(false)}
        deleteAction={deleteContentAction.bind(null, 'tour_date', tour.id, artistId)}
        deleteLabel="Delete date"
      >
        <h3 className="text-lg font-bold tracking-[-0.01em]">Edit date</h3>
        {badge && (
          <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            from {badge}
          </div>
        )}
        <form
          action={updateContentAction.bind(null, 'tour_date', tour.id, artistId)}
          className="mt-4 space-y-2"
        >
          <div className="flex gap-2">
            <input name="date" type="date" defaultValue={tour.date ?? ''} required className={`${inputClass} w-40`} />
            <input name="city" defaultValue={tour.city ?? ''} placeholder="City" className={`${inputClass} flex-1`} />
          </div>
          <input name="venue" defaultValue={tour.venue ?? ''} placeholder="Venue" className={`${inputClass} w-full`} />
          <input name="ticket_url" type="url" defaultValue={tour.ticket_url ?? ''} placeholder="Tickets URL" className={`${inputClass} w-full`} />
          <button type="submit" className={buttonClass('ghost')}>
            Save
          </button>
        </form>
      </CardModal>
    </>
  )
}
