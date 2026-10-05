'use client'

import { useEffect, useRef, useState, type Key, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cx } from '@/lib/cx'
import { toast } from '../../toast'
import { AddPlus } from './add-row'
import { FOCUS_RING } from './focus-ring'
import { RowIcon } from './row-icon'

/**
 * A CLICK-TO-EDIT LIST (Sam, 2026-10-02, Settings › Email: "when I click on a submitted email,
 * then I can edit it or delete it. The delete icon appears after I click on it, same with the
 * edit. I want minimal stuff on the screen"; "Dont say add email. Have it be a plus (+)"; "I dont
 * like the border around the container"). Lifted from enquiries/kind-rows.tsx (2026-10-05) so
 * every list of short user-written items works the same way.
 *
 *   at rest        each item is its text alone, a button (so a keyboard reaches it: Tab, Enter)
 *   click / Enter  the item becomes an underline field in the same type, with ✓, a trash (when
 *                  `onRemove`) and any `extra` controls, which exist only while it is open
 *   Enter or ✓     saves the trimmed text, only when it changed; focus goes back to the item
 *   Escape         puts it back; focus goes back to the item
 *   a click away   puts it back (focus leaving the field and its controls)
 *   the bare +     at the end of the items: opens an underline field where the new item will
 *                  sit; Enter or ✓ adds, Escape or × closes it; focus goes back to the +
 *
 * A REFUSAL KEEPS THE DRAFT. `validate` runs first; then the save's own `{ error }`. Either way
 * the reason is a toast and the field stays open with what was typed in it: a refused entry is
 * never wiped unsaved.
 *
 * THE LIST IS THE PARENT'S. EditList holds only the open item's draft and the add field's text;
 * `items` is what is shown, so an optimistic parent shows its change at once and a refused one
 * puts it back. Items are keyed by POSITION unless `itemKey` says otherwise: a refused edit
 * puts the list back, and the open field must survive that with its text.
 *
 * Re-entry latches are refs (AGENTS.md rule 5): Enter and a click on ✓ in one tick save once.
 * The glyphs keep the field focused on mousedown, so a click on ✓ is a save, not a click away.
 */
export type EditListResult = { error?: string } | void
type MaybeAsync<T> = T | Promise<T>

export type EditListProps<T> = {
  items: readonly T[]
  /** An item's text: what shows at rest and what its field starts with. */
  text: (item: T) => string
  /** An item's hover text at rest (an address's label). */
  title?: (item: T) => string | undefined
  itemKey?: (item: T, index: number) => Key
  /** An open item's field's accessible name: "Email". */
  label: string
  /** The +'s name and hover label: "Add email to Booking". No + without `onAdd`. */
  addLabel?: string
  /** The add field's accessible name. Default: `New ${label}` in lower case. */
  addFieldLabel?: string
  placeholder?: string
  maxLength: number
  inputMode?: 'email' | 'text' | 'url'
  /** The items' look, at rest and while edited (type, size, colour). Default: 15px ink. */
  textClass?: string
  /** The add field's width (it takes `textClass` too). Default: 16 characters, growing. */
  addFieldClass?: string
  /** The reason a value cannot be taken, or nothing. `index` is the item being edited, or
   *  null for a new one (so a repeat check can leave the item itself out). */
  validate?: (value: string, index: number | null) => string | null | undefined
  /** Save an edited item. Resolve `{ error }` to refuse it: the field keeps the draft. */
  onSave: (index: number, value: string) => MaybeAsync<EditListResult>
  /** Add one. Resolve `{ error }` to refuse it: the field keeps the draft. */
  onAdd?: (value: string) => MaybeAsync<EditListResult>
  /** The open item's trash. No trash without it. */
  onRemove?: (index: number) => void
  /** The trash's name: "Remove ar@label.com". Default: "Delete". */
  removeLabel?: (item: T) => string
  /** More controls for the OPEN item only, after ✓ and the trash (an on/off-site switch). */
  extra?: (item: T, index: number) => ReactNode
  /** The row's layout (justify, gaps); it is a wrapping flex row. */
  className?: string
}

/** A field that is only a line (Sam: no boxes), in the type of the text it stands in for. */
const UNDERLINE = 'border-b border-hairline bg-transparent p-0 outline-none placeholder:text-ink-faint focus:border-ink'
const DEFAULT_TEXT = 'text-[15px] leading-6 text-ink'

/** The way a save says no: a returned `{ error }`, or a throw. */
async function attempt(run: () => MaybeAsync<EditListResult>, fallback: string): Promise<string | null> {
  try {
    const res = await run()
    return res && res.error ? res.error : null
  } catch {
    return fallback
  }
}

export function EditList<T>({
  items,
  text,
  title,
  itemKey,
  label,
  addLabel,
  addFieldLabel,
  placeholder,
  maxLength,
  inputMode,
  textClass = DEFAULT_TEXT,
  addFieldClass = 'min-w-[16ch] max-w-full [field-sizing:content]',
  validate,
  onSave,
  onAdd,
  onRemove,
  removeLabel,
  extra,
  className,
}: EditListProps<T>) {
  const plus = useRef<HTMLButtonElement>(null)
  return (
    <div className={cx('flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item, i) => (
        <EditItem
          key={itemKey ? itemKey(item, i) : i}
          value={text(item)}
          title={title?.(item)}
          label={label}
          textClass={textClass}
          inputMode={inputMode}
          maxLength={maxLength}
          refuse={validate ? (v) => validate(v, i) : undefined}
          onSave={(v) => onSave(i, v)}
          onRemove={
            onRemove
              ? () => {
                  // Focus to the + first: the item is about to go, and a question asked before
                  // it goes (the last address) hands focus back to whoever had it.
                  plus.current?.focus()
                  onRemove(i)
                }
              : undefined
          }
          removeLabel={removeLabel?.(item) ?? 'Delete'}
          extra={extra?.(item, i)}
        />
      ))}
      {onAdd ? (
        <AddField
          plusRef={plus}
          label={addLabel ?? `Add ${label.toLowerCase()}`}
          fieldLabel={addFieldLabel ?? `New ${label.toLowerCase()}`}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          textClass={cx(textClass, addFieldClass)}
          refuse={validate ? (v) => validate(v, null) : undefined}
          onAdd={onAdd}
        />
      ) : null}
    </div>
  )
}

function EditItem({
  value,
  title,
  label,
  textClass,
  inputMode,
  maxLength,
  refuse,
  onSave,
  onRemove,
  removeLabel,
  extra,
}: {
  value: string
  title?: string
  label: string
  textClass: string
  inputMode?: 'email' | 'text' | 'url'
  maxLength: number
  refuse?: (v: string) => string | null | undefined
  onSave: (v: string) => MaybeAsync<EditListResult>
  onRemove?: () => void
  removeLabel: string
  extra?: ReactNode
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  /** Hand focus back to the text after Enter or Escape (a keyboard user's place). */
  const refocus = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (editing) input.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [editing])

  function close(keyboard: boolean) {
    refocus.current = keyboard
    setDraft(null)
  }

  async function save() {
    if (draft === null || savingRef.current) return
    const next = draft.trim()
    if (next === value) return close(true)
    const problem = refuse?.(next)
    if (problem) {
      toast(problem, 'error')
      input.current?.focus()
      return
    }
    savingRef.current = true
    try {
      const error = await attempt(() => onSave(next), `Couldn’t save that ${label.toLowerCase()}.`)
      if (error) {
        toast(error, 'error')
        input.current?.focus()
        return
      }
      close(true)
    } finally {
      savingRef.current = false
    }
  }

  if (!editing) {
    return (
      <button
        ref={button}
        type="button"
        title={title}
        onClick={() => setDraft(value)}
        className={cx('max-w-full cursor-text truncate rounded text-left', textClass, FOCUS_RING)}
      >
        {value}
      </button>
    )
  }

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(false)
      }}
    >
      <input
        ref={input}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        inputMode={inputMode}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close(true)
          }
        }}
        // As wide as the text (field-sizing where supported), never wider than the row.
        className={cx(UNDERLINE, textClass, 'min-w-[8ch] max-w-full [field-sizing:content]')}
      />
      {/* mousedown would blur the field first, and a blur is "put it back". */}
      <span className="inline-flex items-center gap-1.5" onMouseDown={(e) => e.preventDefault()}>
        <RowIcon icon="check" label="Save" variant="bare" tone="accent" glyphSize={14} onClick={() => void save()} />
        {onRemove ? (
          <RowIcon
            icon="trash"
            label={removeLabel}
            variant="bare"
            tone="danger"
            glyphSize={14}
            onClick={() => {
              close(false)
              onRemove()
            }}
          />
        ) : null}
        {extra}
      </span>
    </span>
  )
}

function AddField({
  plusRef,
  label,
  fieldLabel,
  placeholder,
  maxLength,
  inputMode,
  textClass,
  refuse,
  onAdd,
}: {
  plusRef: RefObject<HTMLButtonElement | null>
  label: string
  fieldLabel: string
  placeholder?: string
  maxLength: number
  inputMode?: 'email' | 'text' | 'url'
  textClass: string
  refuse?: (v: string) => string | null | undefined
  onAdd: (value: string) => MaybeAsync<EditListResult>
}) {
  const [value, setValue] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  /** Focus goes back to the + after a cancel or an add. */
  const refocus = useRef(false)
  const open = value !== null

  useEffect(() => {
    if (open) field.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      plusRef.current?.focus()
    }
  }, [open, plusRef])

  function close() {
    refocus.current = true
    setValue(null)
  }

  async function confirm() {
    const next = (value ?? '').trim()
    if (!next || busyRef.current) return
    const problem = refuse?.(next)
    if (problem) {
      toast(problem, 'error')
      field.current?.focus()
      return
    }
    busyRef.current = true
    try {
      const error = await attempt(() => onAdd(next), 'Couldn’t add that.')
      if (error) {
        toast(error, 'error')
        field.current?.focus()
        return
      }
      close()
    } finally {
      busyRef.current = false
    }
  }

  if (!open) return <AddPlus ref={plusRef} label={label} onClick={() => setValue('')} />

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <input
        ref={field}
        aria-label={fieldLabel}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
        className={cx(UNDERLINE, textClass)}
      />
      <RowIcon icon="check" label="Add" variant="bare" tone="accent" glyphSize={16} onClick={() => void confirm()} />
      <RowIcon icon="close" label="Cancel" variant="bare" tone="danger" glyphSize={16} onClick={close} />
    </span>
  )
}
