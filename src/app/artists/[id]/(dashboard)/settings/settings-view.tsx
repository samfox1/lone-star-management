'use client'

import { useState, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import { rowHoverClass } from '@/components/ui/ui'
import type { SettingsRow } from '@/lib/settings'
import { toast } from '../toast'
import { saveArtistNameAction, saveBookingEmailAction } from './actions'

/**
 * SETTINGS, the way Sam settled it (2026-09-13): two columns, both centred. The keys sit
 * in their own column, each centred in it; the values in theirs, each centred in that;
 * and the pair of columns floats in the middle of the main area, a touch above dead
 * centre. No panel, no border, no arrows, no headings.
 *
 * Booking email and Name are rows you click to edit — the whole row, with the same hover
 * the tour dates and connections wear (`rowHoverClass`) — and they save on blur or Enter.
 * Site and Address are plain text: "the user can't just change their domain name like
 * that". They carry no hover, no pencil, no input, nothing to click.
 */
export function SettingsView({ artistId, rows: initial }: { artistId: string; rows: SettingsRow[] }) {
  // Seeded from the server and re-seeded when it changes; render-phase, not an effect.
  const [state, setState] = useState({ from: initial, rows: initial })
  if (state.from !== initial) setState({ from: initial, rows: initial })
  const rows = state.rows
  const patch = (key: SettingsRow['key'], next: Partial<SettingsRow>) =>
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...next } : r)) }))

  async function save(row: SettingsRow, value: string): Promise<{ error?: string } | void> {
    if (row.key === 'booking_email') {
      const res = await saveBookingEmailAction(artistId, value)
      if (!res.error) patch(row.key, { value: res.value ?? '', sub: res.value ? 'Enquiries from the site go here' : 'No address for enquiries yet' })
      return res
    }
    if (row.key === 'name') {
      const res = await saveArtistNameAction(artistId, value)
      if (!res.error) patch(row.key, { value })
      return res
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="-mt-10 inline-grid grid-cols-[auto_auto] items-start">
        {rows.map((row) => (
          <Row key={row.key} row={row} onSave={(v) => save(row, v)} />
        ))}
      </div>
    </div>
  )
}

const KEY = 'pt-[19px] text-center font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint'

/** One row: two cells of the outer grid (subgrid), so the row can be hovered and clicked
 *  as ONE thing while its cells stay in their columns. */
function Row({ row, onSave }: { row: SettingsRow; onSave: (v: string) => Promise<{ error?: string } | void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.value)
  // What the row SHOWS: optimistic, put back if the save is refused.
  const [shown, setShown] = useState({ from: row.value, now: row.value })
  if (shown.from !== row.value) setShown({ from: row.value, now: row.value })
  const current = shown.now

  function begin() {
    if (!row.editable || editing) return
    setDraft(current)
    setEditing(true)
  }

  async function commit(next: string) {
    setEditing(false)
    if (next === current) return
    const prev = current
    setShown((s) => ({ ...s, now: next }))
    const res = await onSave(next)
    if (res && 'error' in res && res.error) {
      setShown((s) => ({ ...s, now: prev }))
      toast(res.error, 'error')
    }
  }

  const box = cx('block h-6 min-w-[12ch] border-b text-center leading-6', row.mono ? 'font-space text-[13px]' : 'text-[15px]')
  const value = editing ? (
    <input
      autoFocus
      aria-label={row.label}
      value={draft}
      size={Math.max(12, draft.length + 1)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit(draft.trim())}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit(draft.trim())
        } else if (e.key === 'Escape') {
          setDraft(current)
          setEditing(false)
        }
      }}
      className={cx(box, 'border-ink bg-transparent p-0 outline-none')}
    />
  ) : (
    <span className={cx(box, 'border-transparent', !current && 'text-hairline')}>{current || '—'}</span>
  )

  return (
    <div
      role={row.editable ? 'button' : undefined}
      tabIndex={row.editable ? 0 : undefined}
      aria-label={row.editable ? row.label : undefined}
      onClick={begin}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          begin()
        }
      }}
      className={cx('col-span-2 grid grid-cols-subgrid items-start gap-x-9', row.editable && rowHoverClass)}
    >
      <span className={KEY}>{row.label}</span>
      <div className="justify-self-center py-3 text-center">
        {value}
        {row.sub && <div className="mt-1 font-space text-[10.5px] text-ink-faint">{row.sub}</div>}
      </div>
    </div>
  )
}
