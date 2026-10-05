'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { RowIcon } from './row-icon'

/**
 * THE ADD CONTROL, everywhere: a bare + and no words (Sam, 2026-10-02: "Dont say add email. Have
 * it be a plus (+)"; applied app-wide 2026-10-05). Its name ("Add logo", "Connect") is the hover
 * label and the accessible name, never text on the screen. Ink at rest, blue and bold on hover
 * (every + turns blue, RowIcon's `accent` tone), no box.
 *
 * The glyph sits where the list's text starts; the padding (cancelled by the same negative
 * margin) makes it a 28px target without moving it. AddRow's closed state, the press kit's
 * quotes, Connections' Connect (which opens a picker instead of a name field), and EditList's +
 * (edit-list.tsx).
 *
 * `size="lg"`: a 20px glyph in a 36px target, where the + is the page's one way to grow a list
 * (the SEO Answers tab's questions; Sam, 2026-10-05: "the plus button should be bigger").
 */
const PLUS_SIZE = {
  md: { glyph: 16, pad: '-m-1.5 p-1.5' },
  lg: { glyph: 20, pad: '-m-2 p-2' },
} as const

export function AddPlus({
  label,
  onClick,
  ref,
  className,
  size = 'md',
}: {
  label: string
  onClick: () => void
  ref?: Ref<HTMLButtonElement>
  className?: string
  size?: keyof typeof PLUS_SIZE
}) {
  return (
    <RowIcon
      ref={ref}
      icon="plus"
      label={label}
      variant="bare"
      labelAlign="start"
      glyphSize={PLUS_SIZE[size].glyph}
      onClick={onClick}
      className={className ?? PLUS_SIZE[size].pad}
    />
  )
}

/** The open add flow's one-line field: a LINE, not a box (Sam, 2026-10-02: "I dont like the
 *  border around the container when adding"). 320px everywhere (Batch 2): a 40-character brand
 *  name fits whole. The text starts where the list's text starts (no side padding), and the
 *  padding on top makes up the box's lost top border, so the row is exactly as tall as before. */
export const ADD_FIELD =
  'w-[320px] max-w-full border-b border-hairline bg-transparent px-0 pt-[8px] pb-[7px] text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-ink'

/**
 * THE ADD FLOW, every Brand list (Sam, 2026-09-23, BRAND_PAGE_PLAN.md):
 *
 *   a bare + ("Add logo / color / font" on hover only, 2026-10-05) → a name field with ✓ (blue
 *   on hover) and × (red on hover) → focus lands in the new row's note → Enter moves it to
 *   the row's + → that + does the thing.
 *
 * This component owns the first two steps. The field is a line and ✓ × are bare glyphs:
 * no boxes anywhere in the flow (Sam, 2026-10-02). `onAdd(name)` is where the parent inserts its
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
  size = 'md',
}: {
  /** "logo" → the +'s name and hover label, "Add logo". */
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
  /** The closed +'s size (AddPlus). */
  size?: keyof typeof PLUS_SIZE
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
    let added = false
    try {
      added = onAdd(next) !== false
    } finally {
      // A refusal OR a throw releases the latch, or the field would ignore every later ✓.
      if (!added) done.current = false
    }
    if (!added) {
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
      // h-9: as tall as the open field (36px), so opening it moves nothing below.
      <div data-ledger-add="" className="pt-2.5">
        <div className="flex h-9 items-center">
          <AddPlus ref={addButton} label={`Add ${noun}`} onClick={start} size={size} />
        </div>
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
        className={ADD_FIELD}
      />
      {/* Bare glyphs, no boxes (Sam dislikes icons in a box, row-icon.tsx). */}
      <RowIcon icon="check" label="Add" variant="bare" tone="accent" glyphSize={18} onClick={confirm} />
      <RowIcon icon="close" label="Cancel" variant="bare" tone="danger" glyphSize={18} onClick={cancel} />
    </div>
  )
}
