'use client'

import { CreateModal } from '../create-modal'
import { addContentAction } from '../actions'
import { US_STATES } from '@/lib/us-states'

const STATE_OPTIONS = US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function TourPreview({ date, venue, city }: { date?: string; venue?: string; city?: string }) {
  const [, m, d] = (date ?? '').split('-').map(Number)
  const day = d ? String(d) : '--'
  const month = m ? (MONTHS[m - 1] ?? '') : ''
  return (
    <div className="w-28">
      <div className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-hairline bg-surface">
        <div className="font-space text-[32px] font-bold leading-none tracking-[-0.03em]">{day || '—'}</div>
        <div className="mt-1 font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">{month || 'DATE'}</div>
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{venue || 'New date'}</div>
      {city && <div className="truncate font-space text-xs text-ink-muted">{city}</div>}
    </div>
  )
}

/** The Tour "Add" button: manual only (per-date auto = the Bandsintown/Ticketmaster sync). */
export function TourAddButton({ artistId }: { artistId: string }) {
  return (
    <CreateModal
      kind="Tour date"
      title="Add date"
      fields={[
        { name: 'date', placeholder: 'Date', type: 'date', row: 1, width: 'grow' },
        { name: 'city', placeholder: 'City', row: 1, width: 'grow' },
        { name: 'venue', placeholder: 'Venue', row: 2, width: 'grow' },
        { name: 'state', placeholder: 'State', kind: 'select', options: STATE_OPTIONS, row: 2, width: 'sm' },
        { name: 'country', placeholder: 'Country (outside the US)' },
        { name: 'ticket_url', placeholder: 'Tickets URL', type: 'url' },
        { name: 'support', placeholder: 'Also performing…', kind: 'tags' },
        { name: 'is_past', placeholder: 'This was an old show', kind: 'toggle' },
      ]}
      preview={(v) => <TourPreview date={v.date} venue={v.venue} city={v.city} />}
      submit={(fd) => addContentAction('tour_date', artistId, fd)}
    />
  )
}
