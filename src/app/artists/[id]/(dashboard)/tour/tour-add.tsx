'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import type { SupportAct } from '@/lib/content'
import { US_STATES } from '@/lib/us-states'
import { CardModal } from '../card-modal'
import { DateSquare, KvRow, ModalHeader } from '../modal-kit'
import { addContentAction, setSupportActsAction } from '../actions'
import { toast } from '../toast'
import { SupportActs } from './support-acts'

const STATE_OPTIONS = US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))

type Draft = { date: string; venue: string; city: string; state: string; country: string; ticket_url: string }
const EMPTY: Draft = { date: '', venue: '', city: '', state: '', country: '', ticket_url: '' }

const rowInput = 'min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-hairline'

/**
 * The Tour "Add" button and its card (prototype G, Sam, 2026-09-11). The Add card IS
 * the edit card with its rows as inputs and one solid button: the header fills in as
 * you type. Manual only — per-date automation is the Bandsintown / Ticketmaster sync.
 *
 * No "old show" toggle: a date in the past is an old show by itself. Acts (with their
 * websites) can be added before the row exists; the names ride the create as `support`
 * and the links are written right after, by the new row's id.
 */
export function TourAddButton({ artistId }: { artistId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<Draft>(EMPTY)
  const [acts, setActs] = useState<SupportAct[]>([])
  const busyRef = useRef(false) // re-entry latch: two fast clicks must not add two rows
  const [busy, setBusy] = useState(false)

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((d) => ({ ...d, [k]: e.target.value }))

  function close() {
    setOpen(false)
    setV(EMPTY)
    setActs([])
  }

  async function add() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const fd = new FormData()
      for (const [k, val] of Object.entries(v)) if (val.trim()) fd.set(k, val.trim())
      for (const a of acts) fd.append('support', a.name)
      const res = await addContentAction('tour_date', artistId, fd)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      if (res.id && acts.some((a) => a.url)) {
        const linked = await setSupportActsAction(artistId, res.id, acts)
        if (linked.error) toast(linked.error, 'error')
      }
      toast('Date added')
      close()
      router.refresh()
    } catch {
      toast('Something went wrong adding the date.', 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const place = [v.city, v.state || v.country].filter(Boolean).join(', ')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add date"
        title="Add date"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <Icon name="plus" size={14} />
      </button>

      <CardModal
        open={open}
        onClose={close}
        label="Add date"
        footer={
          <div className="flex items-center justify-end border-t border-hairline pt-4">
            <button type="button" onClick={add} disabled={busy} className={buttonClass('solid')}>
              {busy ? 'Adding…' : 'Add date'}
            </button>
          </div>
        }
      >
        <ModalHeader
          square={<DateSquare date={v.date || null} />}
          title={<span className={v.venue ? undefined : 'text-hairline'}>{v.venue || 'New date'}</span>}
          meta={<span>{place || 'draft'}</span>}
        />
        <div className="mt-5">
          <KvRow label="Date">
            <input aria-label="Date" type="date" value={v.date} onChange={set('date')} className={`${rowInput} font-space text-[13px]`} />
          </KvRow>
          <KvRow label="Venue">
            <input aria-label="Venue" value={v.venue} onChange={set('venue')} placeholder="Venue" className={rowInput} />
          </KvRow>
          <KvRow label="Where">
            <div className="grid min-w-0 flex-1 grid-cols-[1.4fr_0.7fr_1fr] gap-4">
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className="font-space text-[9px] uppercase tracking-[0.12em] text-ink-faint">City</span>
                <input aria-label="City" value={v.city} onChange={set('city')} placeholder="—" className={rowInput} />
              </label>
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className="font-space text-[9px] uppercase tracking-[0.12em] text-ink-faint">State</span>
                <select aria-label="State" value={v.state} onChange={set('state')} className={`${rowInput} ${v.state ? '' : 'text-hairline'}`}>
                  <option value="">—</option>
                  {STATE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="text-ink">
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className="font-space text-[9px] uppercase tracking-[0.12em] text-ink-faint">Country</span>
                <input aria-label="Country" value={v.country} onChange={set('country')} placeholder="—" className={rowInput} />
              </label>
            </div>
          </KvRow>
          <KvRow label="Tickets">
            <input aria-label="Tickets" type="url" value={v.ticket_url} onChange={set('ticket_url')} placeholder="https://" className={`${rowInput} font-space text-[13px]`} />
          </KvRow>
          <KvRow label="Lineup" align="start">
            <SupportActs artistId={artistId} acts={acts} onChange={setActs} />
          </KvRow>
        </div>
      </CardModal>
    </>
  )
}
