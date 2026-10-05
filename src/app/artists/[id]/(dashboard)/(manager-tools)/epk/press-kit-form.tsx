'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { PITCH_MAX, QUOTES_MAX, QUOTE_MAX, SOURCE_MAX, pressKitFormData, type PressKitDraft, type PressQuote } from '@/lib/epk'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { toast } from '../../toast'
import { AddPlus } from '../_ui/add-row'
import { AreaField, LineField } from '../_ui/fields'
import { END_SLOT, LEDGER_ROW_GRID, LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { savePressKitAction } from './actions'

/** A row needs a key that survives removal, and a quote's text is not one (two blank rows
 *  would collide). A counter is, and it never leaves the client. */
type Row = PressKitDraft['rows'][number] & { key: number }

/** What one save sends: everything the form holds, because the action writes both columns. */
type PressKit = { pitch: string; rows: readonly Row[] }

/**
 * The hand-typed half of the press kit, in Brand's ledger (Batch 3, Sam 2026-10-02): Pitch and
 * Quotes. NO SAVE BUTTON: every edit saves itself to the draft half a second after the last
 * keystroke (useDebouncedFieldSave, the editor panels' own: serialized, flushed on leaving),
 * through the same action the old Save button posted. One key for the whole form, because the
 * action writes the pitch and the quotes together: two keys would race two whole copies.
 *
 * Draft until the profile is published (the page's rising Publish bar). A save says nothing on
 * success; a refusal is an error toast.
 */
export function PressKitForm({ artistId, pitch: savedPitch, quotes }: { artistId: string; pitch: string; quotes: PressQuote[] }) {
  // Plain state, seeded once: the refresh after each save sends the server's (cleaned) copy
  // back, and re-seeding from it would undo whatever was typed while the save was out.
  const [pitch, setPitch] = useState(savedPitch)
  const [rows, setRows] = useState<Row[]>(() => quotes.map((q, i) => ({ key: i, quote: q.quote, source: q.source, url: q.url ?? '' })))
  const nextKey = useRef(quotes.length)
  /** The row "Add quote" just made: its first field takes focus once it mounts. */
  const focusKey = useRef<number | null>(null)

  const saver = useDebouncedFieldSave<PressKit>({
    persist: async (_key, kit) => {
      const res = await savePressKitAction(artistId, pressKitFormData(kit)).catch(() => ({ error: SAVE_FAILED }))
      if (res.error) toast(res.error, 'error')
      return res
    },
  })

  const commit = (next: PressKit) => {
    setPitch(next.pitch)
    setRows([...next.rows])
    saver.save('press', next)
  }
  const editRow = (key: number, patch: Partial<Omit<Row, 'key'>>) => commit({ pitch, rows: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) })
  const removeRow = (key: number) => commit({ pitch, rows: rows.filter((r) => r.key !== key) })
  /** A blank row changes nothing the server keeps, so adding one saves nothing. */
  const addRow = () => {
    const key = nextKey.current++
    focusKey.current = key
    setRows((r) => [...r, { key, quote: '', source: '', url: '' }])
  }

  return (
    <>
      <LedgerSection label="Pitch">
        <LedgerRow title="One-line pitch" guide="One sentence a journalist can quote.">
          <LineField
            label="One-line pitch"
            value={pitch}
            placeholder="Add a pitch"
            onChange={(v) => commit({ pitch: v.slice(0, PITCH_MAX), rows })}
            className="w-[440px] max-w-full min-[900px]:text-right"
          />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Quotes">
        {rows.map((r) => (
          // The ledger row's grid, with fields where a built-in row has its fixed title.
          <div key={r.key} data-ledger-row="" data-quote-row="" className={LEDGER_ROW_GRID}>
            <div className="flex min-w-0 flex-col">
              <LineField
                ref={(el) => {
                  if (el && focusKey.current === r.key) {
                    focusKey.current = null
                    el.focus()
                  }
                }}
                label="Who said it"
                value={r.source}
                placeholder="Who said it"
                onChange={(v) => editRow(r.key, { source: v.slice(0, SOURCE_MAX) })}
                className="w-full max-w-[320px] font-medium"
              />
              <AreaField
                label="The quote"
                value={r.quote}
                placeholder="What they said"
                rows={1}
                small
                tone="muted"
                // It wraps to show a long quote whole, but it is one line: no line breaks.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault()
                }}
                onChange={(v) => editRow(r.key, { quote: v.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, QUOTE_MAX) })}
                className="mt-0.5 w-full max-w-[40ch]"
              />
            </div>
            <div className="flex min-w-0 items-center justify-start gap-2.5 min-[900px]:justify-end">
              <LineField
                mono
                label="Link to the review"
                value={r.url}
                placeholder="Link"
                onChange={(v) => editRow(r.key, { url: v })}
                className="w-[280px] max-w-full min-[900px]:text-right"
              />
              <div data-ledger-end="remove" className={cx(END_SLOT, 'flex')}>
                <RowIcon icon="trash" label="Remove" tone="danger" onClick={() => removeRow(r.key)} />
              </div>
            </div>
          </div>
        ))}
        {rows.length < QUOTES_MAX ? (
          // `data-ledger-add`: the list can grow a row with a trash, so it reserves the column.
          <div data-ledger-add="" className="mt-2.5 flex h-9 items-center">
            <AddPlus label="Add quote" onClick={addRow} />
          </div>
        ) : null}
      </LedgerSection>
    </>
  )
}
