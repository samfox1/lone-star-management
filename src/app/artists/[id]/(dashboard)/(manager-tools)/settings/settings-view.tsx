import type { SettingsRow } from '@/lib/settings'
import { LedgerRow, LedgerSection } from '../_ui/ledger'

/**
 * SETTINGS · GENERAL, in Brand's ledger (Batch 3, 2026-10-02). Plain text, nothing to click:
 * "the user can't just change their domain name like that" (Sam, 2026-09-13). The booking email
 * that used to be the one editable row lives in Settings › Email now (2026-10-02).
 */
export function SettingsView({ rows }: { rows: SettingsRow[] }) {
  return (
    <LedgerSection label="General">
      {rows.map((row) => (
        <LedgerRow key={row.key} title={row.label}>
          <span className="min-w-0 truncate font-space text-[13px] text-ink">{row.value || '—'}</span>
        </LedgerRow>
      ))}
    </LedgerSection>
  )
}
