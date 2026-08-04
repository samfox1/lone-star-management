'use client'

import { useState } from 'react'
import { PITCH_MAX, QUOTES_MAX, QUOTE_MAX, SOURCE_MAX, type PressQuote } from '@/lib/epk'
import { Icon } from '@/components/ui/icons'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SaveForm } from '../save-form'
import { savePressKitAction } from './actions'

/** A row needs a key that survives reordering/removal, and a quote's text is not one
 *  (two blank rows would collide). A counter is, and it never leaves the client. */
type Row = PressQuote & { key: number }

const blank = (key: number): Row => ({ key, quote: '', source: '', url: null })

/**
 * The only hand-typed part of the press kit: a one-line pitch and the review quotes.
 *
 * Rows are client state so "Add quote" doesn't need a round trip, but nothing about the
 * ROW COUNT is persisted — the server zips the three field lists by index and drops
 * anything with no quote text (`readPressQuotesFromForm`). That is why clearing a
 * quote's text is the delete gesture, and why the remove button below is a convenience
 * rather than the mechanism.
 *
 * Draft until the profile is published, like the bio it sits next to.
 */
export function PressKitForm({
  artistId,
  pitch,
  quotes,
}: {
  artistId: string
  pitch: string
  quotes: PressQuote[]
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    quotes.length ? quotes.map((q, i) => ({ ...q, key: i })) : [blank(0)],
  )
  const [nextKey, setNextKey] = useState(rows.length)

  function addRow() {
    setRows((r) => [...r, blank(nextKey)])
    setNextKey((k) => k + 1)
  }

  return (
    <SaveForm
      action={savePressKitAction.bind(null, artistId)}
      savedMessage="Press kit saved"
      className="space-y-8"
    >
      <label className="block">
        <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          One-line pitch
        </span>
        <input
          name="press_pitch"
          defaultValue={pitch}
          maxLength={PITCH_MAX}
          placeholder="Austin four-piece with a debut out this autumn"
          className={`mt-1.5 ${inputClass} w-full`}
        />
        <span className="mt-1 block font-space text-[11px] text-ink-faint">
          One sentence a journalist can quote straight into a piece.
        </span>
      </label>

      <div className="space-y-3">
        <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Press quotes
        </span>

        {rows.map((row, i) => (
          <div key={row.key} className="space-y-2 rounded-xl border border-hairline p-3">
            <div className="flex items-start gap-2">
              <input
                name="quote"
                defaultValue={row.quote}
                maxLength={QUOTE_MAX}
                placeholder="What the reviewer said"
                className={`${inputClass} w-full flex-1`}
              />
              <button
                type="button"
                aria-label={`Remove quote ${i + 1}`}
                title="Remove this quote"
                onClick={() => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : [blank(row.key)]))}
                className="mt-1 text-ink-faint transition-colors hover:text-ink"
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                name="source"
                defaultValue={row.source}
                maxLength={SOURCE_MAX}
                placeholder="Who said it"
                className={`${inputClass} w-1/2`}
              />
              <input
                name="quote_url"
                defaultValue={row.url ?? ''}
                placeholder="Link to the review (optional)"
                className={`${inputClass} w-1/2`}
              />
            </div>
          </div>
        ))}

        {rows.length < QUOTES_MAX && (
          <button type="button" onClick={addRow} className={buttonClass('ghost')}>
            Add quote
          </button>
        )}
      </div>

      <button type="submit" className={buttonClass('ghost')}>
        Save press kit
      </button>
    </SaveForm>
  )
}
