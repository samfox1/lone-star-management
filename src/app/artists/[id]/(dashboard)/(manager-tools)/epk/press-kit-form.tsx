'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import { PITCH_MAX, QUOTES_MAX, QUOTE_MAX, SOURCE_MAX, pressKitFormData, type PressKitDraft, type PressQuote } from '@/lib/epk'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { toast } from '../../toast'
import { AddPlus } from '../_ui/add-row'
import { LineField } from '../_ui/fields'
import { FOCUS_RING } from '../_ui/focus-ring'
import { LEDGER_ROW_GRID, LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { savePressKitAction } from './actions'

/** A row needs a key that survives removal, and a quote's text is not one (two blank rows
 *  would collide). A counter is, and it never leaves the client. */
type Row = PressKitDraft['rows'][number] & { key: number }
/** One quote's three fields, as typed. */
type Quote = Omit<Row, 'key'>

/** What one save sends: everything the form holds, because the action writes both columns. */
type PressKit = { pitch: string; rows: readonly Row[] }

/** An open field is only a line (Sam: no boxes), in the type of the text it stands in for:
 *  edit-list.tsx's underline. */
const UNDERLINE = 'border-b border-hairline bg-transparent p-0 outline-none placeholder:text-ink-faint focus:border-ink'

/** A quote as the server keeps it: trimmed, capped, one line. */
const tidy = (q: Quote): Quote => ({
  source: q.source.trim().slice(0, SOURCE_MAX),
  quote: q.quote.replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, QUOTE_MAX),
  url: q.url.trim(),
})

/**
 * The hand-typed half of the press kit, in Brand's ledger (Batch 3, Sam 2026-10-02): Pitch and
 * Quotes. NO SAVE BUTTON: the pitch saves itself to the draft half a second after the last
 * keystroke (useDebouncedFieldSave, the editor panels' own: serialized, flushed on leaving),
 * through the same action the old Save button posted. One key for the whole form, because the
 * action writes the pitch and the quotes together: two keys would race two whole copies.
 *
 * QUOTES ARE A CLICK-TO-EDIT LIST (Sam, 2026-10-05, prototypes/lists_before_after_20261002.html;
 * the grammar of _ui/edit-list.tsx, with three fields where it has one). At rest a quote is its
 * text: who said it, what they said, the link. A click opens the three as lines, with ✓ and
 * its trash; Enter or ✓ saves, Escape or a click away puts it back. The bare + opens three
 * empty lines where the new quote will sit, with ✓ and ×. A quote needs words: ✓ on an empty
 * one goes to its "What they said" line, and a quote emptied of them leaves the list.
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
  const [adding, setAdding] = useState(false)
  const plus = useRef<HTMLButtonElement>(null)
  /** Focus goes back to the + after an add or a cancel. */
  const refocusPlus = useRef(false)
  useEffect(() => {
    if (!adding && refocusPlus.current) {
      refocusPlus.current = false
      plus.current?.focus()
    }
  }, [adding])

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
  const editRow = (key: number, q: Quote) => commit({ pitch, rows: rows.map((r) => (r.key === key ? { ...r, ...q } : r)) })
  const removeRow = (key: number) => commit({ pitch, rows: rows.filter((r) => r.key !== key) })
  const addRow = (q: Quote) => {
    refocusPlus.current = true
    setAdding(false)
    commit({ pitch, rows: [...rows, { key: nextKey.current++, ...q }] })
  }
  const cancelAdd = () => {
    refocusPlus.current = true
    setAdding(false)
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
          <QuoteRow key={r.key} quote={r} onSave={(q) => editRow(r.key, q)} onRemove={() => removeRow(r.key)} />
        ))}
        {adding ? (
          <QuoteFields start={{ source: '', quote: '', url: '' }} onSave={addRow} onCancel={cancelAdd} />
        ) : rows.length < QUOTES_MAX ? (
          // `data-ledger-add`: the list can grow a row, so it reserves the end column.
          <div data-ledger-add="" className="mt-2.5 flex h-9 items-center">
            <AddPlus ref={plus} label="Add quote" onClick={() => setAdding(true)} />
          </div>
        ) : null}
      </LedgerSection>
    </>
  )
}

/** One saved quote: its text at rest (the whole row is the way in), its fields once clicked. */
function QuoteRow({ quote, onSave, onRemove }: { quote: Quote; onSave: (q: Quote) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  /** Hand focus back to the row after Enter or Escape (a keyboard user's place). */
  const refocus = useRef(false)
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [open])
  const close = (keyboard: boolean) => {
    refocus.current = keyboard
    setOpen(false)
  }

  if (open) {
    return (
      <QuoteFields
        start={quote}
        onSave={(q) => {
          close(true)
          // Emptied of its words, it is no longer a quote (the server would drop it too).
          if (!q.quote) onRemove()
          else if (q.source !== quote.source || q.quote !== quote.quote || q.url !== quote.url) onSave(q)
        }}
        onCancel={(keyboard) => close(keyboard)}
        onRemove={() => {
          close(false)
          onRemove()
        }}
      />
    )
  }

  return (
    <button
      ref={button}
      type="button"
      data-ledger-row=""
      data-quote-row=""
      onClick={() => setOpen(true)}
      className={cx(LEDGER_ROW_GRID, 'w-full cursor-text text-left', FOCUS_RING)}
    >
      <span className="flex min-w-0 flex-col">
        {quote.source ? <span className="truncate text-[15px] font-medium leading-6 text-ink">{quote.source}</span> : null}
        <span className="mt-0.5 max-w-[40ch] text-[14px] leading-[1.5] text-ink-muted">{quote.quote}</span>
      </span>
      <span className="min-w-0 truncate font-space text-[11px] leading-5 text-ink-faint min-[900px]:text-right">{quote.url}</span>
    </button>
  )
}

/**
 * A quote's three lines, open: who said it, what they said, the link. Enter (in any of them) or
 * ✓ saves, tidied, unless there are no words yet: then focus goes to "What they said". Escape
 * or × (a new one) cancels. An open saved quote also puts itself back when focus leaves it.
 */
function QuoteFields({
  start,
  onSave,
  onCancel,
  onRemove,
}: {
  start: Quote
  onSave: (q: Quote) => void
  /** `true` when the keyboard did it (Escape), so focus can go back where it was. */
  onCancel: (keyboard: boolean) => void
  /** A saved quote's trash. Without it this is a new quote, which has × instead. */
  onRemove?: () => void
}) {
  const [draft, setDraft] = useState<Quote>(start)
  const who = useRef<HTMLInputElement>(null)
  const words = useRef<HTMLTextAreaElement>(null)
  /** One save per Enter-and-click in the same tick (AGENTS.md rule 5). */
  const doneRef = useRef(false)
  useEffect(() => who.current?.focus(), [])

  const save = () => {
    if (doneRef.current) return
    const q = tidy(draft)
    if (!q.quote) {
      words.current?.focus()
      return
    }
    doneRef.current = true
    onSave(q)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel(true)
    }
  }

  return (
    <div
      data-ledger-row=""
      data-quote-row=""
      onKeyDown={onKeyDown}
      // A saved quote puts itself back when focus leaves it; a new one stays until × or Escape.
      onBlur={(e) => {
        if (onRemove && !e.currentTarget.contains(e.relatedTarget as Node | null)) onCancel(false)
      }}
      className={LEDGER_ROW_GRID}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <input
          ref={who}
          aria-label="Who said it"
          value={draft.source}
          placeholder="Who said it"
          maxLength={SOURCE_MAX}
          spellCheck={false}
          onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
          className={cx(UNDERLINE, 'w-full max-w-[320px] text-[15px] font-medium leading-6 text-ink')}
        />
        <textarea
          ref={words}
          aria-label="The quote"
          value={draft.quote}
          placeholder="What they said"
          rows={1}
          maxLength={QUOTE_MAX}
          spellCheck={false}
          // It wraps to show a long quote whole, but it is one line: no line breaks (Enter saves).
          onChange={(e) => setDraft((d) => ({ ...d, quote: e.target.value.replace(/\s*[\r\n]+\s*/g, ' ') }))}
          className={cx(UNDERLINE, 'w-full max-w-[40ch] resize-none text-[14px] leading-[1.5] text-ink-muted [field-sizing:content] focus:text-ink')}
        />
      </div>
      <div className="flex min-w-0 items-center justify-start gap-2.5 min-[900px]:justify-end">
        <input
          aria-label="Link to the review"
          value={draft.url}
          placeholder="Link"
          inputMode="url"
          spellCheck={false}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          className={cx(UNDERLINE, 'w-[280px] max-w-full font-space text-[11px] leading-5 text-ink min-[900px]:text-right')}
        />
        {/* mousedown would blur the fields first, and a blur is "put it back". */}
        <span className="inline-flex flex-none items-center gap-1.5" onMouseDown={(e) => e.preventDefault()}>
          <RowIcon icon="check" label={onRemove ? 'Save' : 'Add'} variant="bare" tone="accent" glyphSize={14} onClick={save} />
          {onRemove ? (
            <RowIcon icon="trash" label="Remove" variant="bare" tone="danger" glyphSize={14} onClick={onRemove} />
          ) : (
            <RowIcon icon="close" label="Cancel" variant="bare" tone="danger" glyphSize={14} onClick={() => onCancel(false)} />
          )}
        </span>
      </div>
    </div>
  )
}
