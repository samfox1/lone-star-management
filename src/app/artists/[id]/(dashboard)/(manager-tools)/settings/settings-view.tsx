'use client'

import { useRef } from 'react'
import { recipientLine, type SettingsRow } from '@/lib/settings'
import { CommitField } from '../_ui/commit-field'
import { LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { useSeeded } from '../_ui/use-seeded'
import { saveBookingEmailAction } from './actions'

/**
 * SETTINGS · GENERAL. The same three rows in the same order Sam settled on 2026-09-13 (booking
 * email, site, address), in Brand's ledger since Batch 3 (Sam, 2026-10-02, prototypes/
 * batch3_20261002.html: "Email you can type in place"). The name moved to Profile (2026-10-02).
 *
 * The booking email is a field you type into where it sits (CommitField): it saves through
 * its door on blur or Enter, instantly, with no Publish; the pencil that focuses it shows only
 * on hover. The line under the title is STATE (where enquiries go), never instruction.
 *
 * Site and Address are plain text: "the user can't just change their domain name like that".
 * No input, no pencil, nothing to click.
 */
export function SettingsView({ artistId, rows: initial }: { artistId: string; rows: SettingsRow[] }) {
  // Seeded from the server and re-seeded when it changes (useSeeded).
  const [rows, setRows] = useSeeded(initial)
  const patch = (key: SettingsRow['key'], next: Partial<SettingsRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...next } : r)))

  async function saveBookingEmail(value: string): Promise<{ error?: string }> {
    const res = await saveBookingEmailAction(artistId, value)
    // The address just saved is where enquiries now go, so the line is the resolver's own.
    if (!res.error) patch('booking_email', { value: res.value ?? '', sub: recipientLine(res.value ?? '', res.value ? { to_email: res.value, recipient_source: 'artist' } : null) })
    return res
  }

  return (
    <LedgerSection label="General">
      {rows.map((row) =>
        row.key === 'booking_email' ? (
          <BookingEmailRow key={row.key} row={row} onSave={saveBookingEmail} />
        ) : (
          <LedgerRow key={row.key} title={row.label} meta={row.sub ?? undefined}>
            <span className="min-w-0 truncate font-space text-[13px] text-ink">{row.value || '—'}</span>
          </LedgerRow>
        ),
      )}
    </LedgerSection>
  )
}

/** The one row you can change: the address enquiries go to. */
function BookingEmailRow({ row, onSave }: { row: SettingsRow; onSave: (v: string) => Promise<{ error?: string }> }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <LedgerRow
      title={row.label}
      meta={row.sub ?? undefined}
      end={<RowIcon icon="edit" label="Edit the booking email" onClick={() => input.current?.focus()} />}
    >
      <CommitField
        inputRef={input}
        label={row.label}
        value={row.value}
        onCommit={onSave}
        placeholder="—"
        mono="value"
        inputMode="email"
        className="w-[300px] max-w-full text-left min-[900px]:text-right"
      />
    </LedgerRow>
  )
}
