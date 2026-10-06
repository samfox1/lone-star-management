'use client'

import { Fragment, useEffect, useRef, useState, type Key, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cx } from '@/lib/cx'
import { toast } from '../../toast'
import { AddPlus } from './add-row'
import { FOCUS_RING } from './focus-ring'
import { RowIcon } from './row-icon'

/**
 * A CLICK-TO-EDIT LIST (Sam, 2026-10-02, Settings › Email: "when I click on a submitted email,
 * then I can edit it or delete it. The delete icon appears after I click on it, same with the
 * edit. I want minimal stuff on the screen"; "Dont say add email. Have it be a plus (+)"; "I dont
 * like the border around the container"). Lifted from Settings › Email's kind-rows.tsx
 * (2026-10-05) so every list of short user-written items works the same way.
 *
 *   at rest        each item is its text alone, a button (so a keyboard reaches it: Tab, Enter)
 *   click / Enter  the item becomes an underline field in the same type, with ✓, a trash (when
 *                  `onRemove`) and any `extra` controls, which exist only while it is open
 *   Enter or ✓     saves the trimmed text, only when it changed; focus goes back to the item
 *   Escape         puts it back; focus goes back to the item
 *   a click away   puts it back (focus leaving the field and its controls)
 *   the bare +     at the end of the items: opens an underline field where the new item will
 *                  sit; Enter or ✓ adds, Escape or × closes it; focus goes back to the +
 *   `detail`       a SECOND line the open item (and the + field) edits beside its text, such
 *                  as a lineup act's website (Sam, 2026-10-05). Never shown at rest; Enter in
 *                  either line or ✓ saves both
 *   `atRest`       an item drawn some other way, which does NOT open its field: the caller's
 *                  node stands in its place (Settings › Email: an address waiting for its code
 *                  is blue with a key and opens the code window, 2026-10-05)
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
type InputMode = 'email' | 'text' | 'url'

/** The open item's second line (see `detail`). */
export type EditListDetail<T> = {
  /** The item's value for this line ('' when it has none). */
  text: (item: T) => string
  /** The line's accessible name and placeholder: "Website". */
  label: string
  maxLength: number
  inputMode?: InputMode
  /** The line's look. Default: the items' `textClass`. */
  textClass?: string
}

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
  /** The add field's hint, and what an item with NO text shows at rest (faint), so a blank one
   *  (a button with no link yet) can still be clicked open. */
  placeholder?: string
  maxLength: number
  inputMode?: InputMode
  /** The items' look, at rest and while edited (type, size, colour). Default: 15px ink. */
  textClass?: string
  /** The add field's width (it takes `textClass` too). Default: 16 characters, growing. */
  addFieldClass?: string
  /** The reason a value cannot be taken, or nothing. `index` is the item being edited, or
   *  null for a new one (so a repeat check can leave the item itself out). */
  validate?: (value: string, index: number | null) => string | null | undefined
  /** A second line edited with the text, only while open: `detail` is its trimmed value. */
  detail?: EditListDetail<T>
  /** Save an edited item. Resolve `{ error }` to refuse it: the field keeps the draft. */
  onSave: (index: number, value: string, detail?: string) => MaybeAsync<EditListResult>
  /** Add one. Resolve `{ error }` to refuse it: the field keeps the draft. */
  onAdd?: (value: string, detail?: string) => MaybeAsync<EditListResult>
  /** The open item's trash. No trash without it. */
  onRemove?: (index: number) => void
  /** The trash's name: "Remove ar@label.com". Default: "Delete". */
  removeLabel?: (item: T) => string
  /** More controls for the OPEN item only, after ✓ and the trash (an on/off-site switch). */
  extra?: (item: T, index: number) => ReactNode
  /** An item drawn by the caller instead, which is not click-to-edit: return its node, or
   *  nothing for the usual text. */
  atRest?: (item: T, index: number) => ReactNode | undefined
  /** The row's layout (justify, gaps); it is a wrapping flex row. */
  className?: string
}

/** A field that is only a line (Sam: no boxes), in the type of the text it stands in for. */
const UNDERLINE = 'border-b border-hairline bg-transparent p-0 outline-none placeholder:text-ink-faint focus:border-ink'
const DEFAULT_TEXT = 'text-[15px] leading-6 text-ink'

/** A + field that starts short, so it stays on the names' line in a narrow column (it grows as
 *  you type): a song's Featuring and a tour date's lineup. */
export const SHORT_ADD_FIELD = 'min-w-[8ch] max-w-full [field-sizing:content]'

/**
 * THE WHOLE-LIST SAVE, for a list stored as ONE value (a song's Featuring names, a tour date's
 * lineup). Every add, edit and remove sends the whole list through `persist`, optimistic first.
 * A refusal puts the list back and hands its message to EditList, which keeps the open field's
 * text; the server's own copy (`saved`: trimmed, deduped) replaces ours when it sends one. A
 * refused remove has no field to keep its reason, so it toasts. FeaturedChips and SupportActs
 * wrote this out line for line until 2026-10-05.
 */
export function useListSave<T>(initial: T[], persist: (next: T[]) => MaybeAsync<{ error?: string; saved?: T[] } | void>) {
  const [items, setItems] = useState(initial)

  async function save(next: T[]): Promise<EditListResult> {
    const prev = items
    setItems(next) // optimistic
    const res = await persist(next)
    if (res?.error) {
      setItems(prev)
      return { error: res.error }
    }
    if (res?.saved) setItems(res.saved) // as stored
  }

  async function remove(i: number) {
    const res = await save(items.filter((_, j) => j !== i))
    if (res?.error) toast(res.error, 'error')
  }

  return { items, save, remove }
}

/** The second line's shape inside an item or the + field. */
type Line = { label: string; maxLength: number; inputMode?: InputMode; textClass: string }

/** Nothing holds focus (the closed field took it with it), so handing it back takes it from no
 *  one. A window that opened on the save (the code window, after an address is added) keeps it. */
function focusIsFree(): boolean {
  return !document.activeElement || document.activeElement === document.body
}

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
  detail,
  onSave,
  onAdd,
  onRemove,
  removeLabel,
  extra,
  atRest,
  className,
}: EditListProps<T>) {
  const plus = useRef<HTMLButtonElement>(null)
  /** The second line's shape, without its value (the + field starts it empty). */
  const line = detail
    ? { label: detail.label, maxLength: detail.maxLength, inputMode: detail.inputMode, textClass: detail.textClass ?? textClass }
    : undefined
  return (
    <div className={cx('flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item, i) => {
        const key = itemKey ? itemKey(item, i) : i
        const own = atRest?.(item, i)
        if (own != null) return <Fragment key={key}>{own}</Fragment>
        return (
          <EditItem
            key={key}
            value={text(item)}
            title={title?.(item)}
            label={label}
            placeholder={placeholder}
            textClass={textClass}
            inputMode={inputMode}
            maxLength={maxLength}
            refuse={validate ? (v) => validate(v, i) : undefined}
            detail={detail && line ? { ...line, value: detail.text(item) } : undefined}
            onSave={(v, d) => (detail ? onSave(i, v, d) : onSave(i, v))}
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
        )
      })}
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
          detail={line}
          onAdd={(v, d) => (detail ? onAdd(v, d) : onAdd(v))}
        />
      ) : null}
    </div>
  )
}

function EditItem({
  value,
  title,
  label,
  placeholder,
  textClass,
  inputMode,
  maxLength,
  refuse,
  detail,
  onSave,
  onRemove,
  removeLabel,
  extra,
}: {
  value: string
  title?: string
  label: string
  placeholder?: string
  textClass: string
  inputMode?: InputMode
  maxLength: number
  refuse?: (v: string) => string | null | undefined
  detail?: Line & { value: string }
  onSave: (v: string, d?: string) => MaybeAsync<EditListResult>
  onRemove?: () => void
  removeLabel: string
  extra?: ReactNode
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [detailDraft, setDetailDraft] = useState('')
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
      if (focusIsFree()) button.current?.focus()
    }
  }, [editing])

  function close(keyboard: boolean) {
    refocus.current = keyboard
    setDraft(null)
  }

  async function save() {
    if (draft === null || savingRef.current) return
    const next = draft.trim()
    const nextDetail = detail ? detailDraft.trim() : undefined
    if (next === value && nextDetail === detail?.value) return close(true)
    const problem = refuse?.(next)
    if (problem) {
      toast(problem, 'error')
      input.current?.focus()
      return
    }
    savingRef.current = true
    try {
      const error = await attempt(() => onSave(next, nextDetail), `Couldn’t save that ${label.toLowerCase()}.`)
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
        onClick={() => {
          setDetailDraft(detail?.value ?? '')
          setDraft(value)
        }}
        className={cx('max-w-full cursor-text truncate rounded text-left', textClass, FOCUS_RING)}
      >
        {/* A blank item was a zero-width button nobody could find or click (2026-10-05). */}
        {value || (placeholder ? <span className="text-ink-faint">{placeholder}</span> : null)}
      </button>
    )
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
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
        onKeyDown={onKey}
        // As wide as the text (field-sizing where supported), never wider than the row.
        className={cx(UNDERLINE, textClass, 'min-w-[8ch] max-w-full [field-sizing:content]')}
      />
      {detail ? (
        <input
          aria-label={detail.label}
          placeholder={detail.label}
          value={detailDraft}
          maxLength={detail.maxLength}
          inputMode={detail.inputMode}
          spellCheck={false}
          onChange={(e) => setDetailDraft(e.target.value)}
          onKeyDown={onKey}
          className={cx(UNDERLINE, detail.textClass, 'ml-1.5 min-w-[12ch] max-w-full [field-sizing:content]')}
        />
      ) : null}
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
  detail,
  onAdd,
}: {
  plusRef: RefObject<HTMLButtonElement | null>
  label: string
  fieldLabel: string
  placeholder?: string
  maxLength: number
  inputMode?: InputMode
  textClass: string
  refuse?: (v: string) => string | null | undefined
  detail?: Line
  onAdd: (value: string, d?: string) => MaybeAsync<EditListResult>
}) {
  const [value, setValue] = useState<string | null>(null)
  const [detailValue, setDetailValue] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  /** Focus goes back to the + after a cancel or an add. */
  const refocus = useRef(false)
  const open = value !== null

  useEffect(() => {
    if (open) field.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      if (focusIsFree()) plusRef.current?.focus()
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
      const error = await attempt(() => onAdd(next, detail ? detailValue.trim() : undefined), 'Couldn’t add that.')
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

  if (!open)
    return (
      <AddPlus
        ref={plusRef}
        label={label}
        onClick={() => {
          setDetailValue('')
          setValue('')
        }}
      />
    )

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void confirm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

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
        onKeyDown={onKey}
        className={cx(UNDERLINE, textClass)}
      />
      {detail ? (
        <input
          aria-label={detail.label}
          placeholder={detail.label}
          value={detailValue}
          maxLength={detail.maxLength}
          inputMode={detail.inputMode}
          spellCheck={false}
          onChange={(e) => setDetailValue(e.target.value)}
          onKeyDown={onKey}
          className={cx(UNDERLINE, detail.textClass, 'min-w-[12ch] max-w-full [field-sizing:content]')}
        />
      ) : null}
      <RowIcon icon="check" label="Add" variant="bare" tone="accent" glyphSize={16} onClick={() => void confirm()} />
      <RowIcon icon="close" label="Cancel" variant="bare" tone="danger" glyphSize={16} onClick={close} />
    </span>
  )
}
