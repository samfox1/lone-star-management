'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { FOCUS_RING } from './focus-ring'
import { RowIcon } from './row-icon'

/** The quiet "+ Add …" that ends a list: grey words beside a 16px plus, black on hover, no
 *  box. AddRow's closed state, and Connections' "+ Connect", which opens a picker instead of a
 *  name field (Batch 3, Sam 2026-10-02). Render it with `<Icon name="plus" size={16} />`. */
export const ADD_BUTTON = cx(
  'inline-flex w-max items-center gap-2 py-1.5 text-[14px] text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-offset-2 motion-reduce:transition-none',
  FOCUS_RING,
)

/**
 * THE ADD FLOW, every Brand list (Sam, 2026-09-23, BRAND_PAGE_PLAN.md):
 *
 *   "+ Add logo / color / font" (hover turns it black, no box) → a name field with ✓ (blue
 *   on hover) and × (red on hover) → focus lands in the new row's note → Enter moves it to
 *   the row's + → that + does the thing.
 *
 * This component owns the first two steps. `onAdd(name)` is where the parent inserts its
 * client-only row (saved only once it gets its thing) and renders that row's NoteField
 * with `autoFocus`, which is the third. Enter is ✓, Escape is ×.
 *
 * The latch is a ref (AGENTS.md rule 5): Enter and a click on ✓ in the same tick both
 * read the pre-render state, and two rows would appear.
 */
export function AddRow({
  noun,
  onAdd,
  prefill,
  placeholder,
  maxLength = 40,
  label = 'Name',
}: {
  /** "logo" → "Add logo". */
  noun: string
  /** The trimmed, non-empty name. The parent adds the row and focuses its note. Returning
   *  `false` refuses it: the field stays open with the text still in it, so a refused entry
   *  (an address the list can't take, a save still in flight) is never wiped unsaved. */
  onAdd: (name: string) => boolean | void
  /** Colours: "Color N", pre-selected so typing replaces it. */
  prefill?: string
  /** The name field's hint, e.g. "Tertiary logo". */
  placeholder?: string
  /** 40, the database's limit on every brand title. */
  maxLength?: number
  /** The field's accessible name: "Name", or "New question" on the SEO Answers tab. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const done = useRef(false)
  /** Focus goes back to the Add control after ×, not after ✓ (the new row's note gets it). */
  const refocusAdd = useRef(false)

  useEffect(() => {
    if (open) {
      input.current?.focus()
      if (prefill) input.current?.select()
    } else if (refocusAdd.current) {
      refocusAdd.current = false
      addButton.current?.focus()
    }
  }, [open, prefill])

  function start() {
    done.current = false
    setName(prefill ?? '')
    setOpen(true)
  }

  function confirm() {
    const next = name.trim()
    if (!next || done.current) return
    done.current = true
    if (onAdd(next) === false) {
      done.current = false
      input.current?.focus()
      return
    }
    setOpen(false)
    setName('')
  }

  function cancel() {
    done.current = true
    refocusAdd.current = true
    setOpen(false)
    setName('')
  }

  // `data-ledger-add` on both states: it tells the list (ledger.tsx) that it can grow a
  // row with a trash, so every row reserves the trash column from the start.
  if (!open) {
    return (
      <div data-ledger-add="" className="pt-2.5">
        <button
          ref={addButton}
          type="button"
          onClick={start}
          className={ADD_BUTTON}
        >
          <Icon name="plus" size={16} />
          {`Add ${noun}`}
        </button>
      </div>
    )
  }

  return (
    <div data-ledger-add="" className="flex items-center gap-2 pt-2.5">
      <input
        ref={input}
        aria-label={label}
        value={name}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }
        }}
        // 320px everywhere (Batch 2, Sam 2026-10-02): a 40-character brand name fits whole.
        className="w-[320px] max-w-full rounded-lg border border-hairline bg-paper px-2.5 py-[7px] text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-ink"
      />
      <RowIcon icon="check" label="Add" variant="boxed" size="sm" tone="accent" onClick={confirm} />
      <RowIcon icon="close" label="Cancel" variant="boxed" size="sm" tone="danger" onClick={cancel} />
    </div>
  )
}
