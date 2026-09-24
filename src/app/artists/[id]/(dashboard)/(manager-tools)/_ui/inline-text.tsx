'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react'
import { cx } from '@/lib/cx'
import { toast } from '../../toast'

/**
 * TITLES AND NOTES YOU CLICK INTO (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): "click → a thin
 * underline only, type, Enter or click away saves. Empty note shows 'Add a note…'."
 *
 * contentEditable rather than an <input>, as in the prototype: the underline hugs the text
 * and a long note WRAPS inside 40ch instead of scrolling out of sight in a fixed box.
 *
 * The text is React's single string child, which React writes through the element itself
 * (no text-node fiber to go stale when the browser edits the DOM), so putting the old text
 * back after Escape or a refusal is a plain `textContent` write.
 *
 * Every refusal is an ERROR toast (toast.tsx) and the old text returns. A success says
 * nothing — the text on the row is the confirmation.
 */
export type SaveResult = { error?: string } | void | undefined
type Save = (next: string) => Promise<SaveResult> | SaveResult

type InlineTextProps = {
  value: string
  onCommit: Save
  label: string
  maxLength: number
  /** An empty value is a real save (a cleared note) rather than a revert (a title). */
  allowEmpty: boolean
  placeholder?: string
  /** Where Enter sends focus after saving. Without one, Enter just leaves the field. */
  primaryRef?: RefObject<HTMLElement | null>
  autoFocus?: boolean
  className: string
}

/** Whitespace of any kind (a pasted line break included) becomes one space: names and
 *  notes are one line, and the database refuses CR/LF in both. */
const clean = (raw: string, max: number) => raw.replace(/\s+/g, ' ').trim().slice(0, max)

function InlineText({ value, onCommit, label, maxLength, allowEmpty, placeholder, primaryRef, autoFocus, className }: InlineTextProps) {
  const el = useRef<HTMLSpanElement>(null)
  // What the row shows as saved. Re-seeded when the parent sends a new value (a refresh
  // after another save), so a stale optimistic value cannot outlive the server's.
  const [shown, setShown] = useState({ from: value, now: value })
  if (shown.from !== value) setShown({ from: value, now: value })
  const current = shown.now
  /** Enter / Escape already settled this edit; the blur they cause must not save again. */
  const settled = useRef(false)

  // ONCE, on mount — the add flow lands here. Keyed on the prop, not on every render, so
  // the re-render after a save cannot pull focus back from the row's + (see NoteField).
  useEffect(() => {
    if (autoFocus) el.current?.focus()
  }, [autoFocus])

  function putBack(text: string) {
    if (el.current && el.current.textContent !== text) el.current.textContent = text
  }

  async function commit() {
    const node = el.current
    if (!node) return
    const next = clean(node.textContent ?? '', maxLength)
    if (next === current || (!next && !allowEmpty)) {
      putBack(current)
      return
    }
    const prev = current
    putBack(next)
    setShown((s) => ({ ...s, now: next }))
    let res: SaveResult
    try {
      res = await onCommit(next)
    } catch {
      res = { error: `Couldn't save that ${label.toLowerCase()}.` }
    }
    if (res && 'error' in res && res.error) {
      toast(res.error, 'error')
      setShown((s) => ({ ...s, now: prev }))
      putBack(prev)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === 'Enter') {
      e.preventDefault() // a line break is never typed into a one-line field
      settled.current = true
      void commit()
      const target = primaryRef?.current
      if (target) target.focus()
      else el.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // Escape answers the field, not a modal around it
      settled.current = true
      putBack(current)
      el.current?.blur()
    }
  }

  function onBlur() {
    if (settled.current) {
      settled.current = false
      return
    }
    void commit()
  }

  // Plain text only: a paste from a web page would otherwise bring its markup with it.
  function onPaste(e: ClipboardEvent<HTMLSpanElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ')
    document.execCommand('insertText', false, text)
  }

  return (
    <span
      ref={el}
      role="textbox"
      aria-label={label}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={() => {
        settled.current = false
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPaste={onPaste}
      onInput={() => {
        // A browser can leave a lone <br> behind when everything is deleted, and then
        // `:empty` no longer matches and the hint never comes back.
        const node = el.current
        if (node && node.textContent === '' && node.innerHTML !== '') node.innerHTML = ''
      }}
      className={cx(
        // THIN UNDERLINE ONLY on focus: no box, no ring, no radius (Sam).
        'inline-block cursor-text border-b border-transparent outline-none focus:border-ink',
        className,
      )}
    >
      {current}
    </span>
  )
}

/**
 * A renamable row title (every added row, every colour). Enter or a click away saves the
 * trimmed name; an EMPTY or UNCHANGED name puts the old one back without calling; Escape
 * puts it back. 40 characters, the database's limit.
 */
export function RowTitle({
  value,
  onRename,
  label = 'Name',
  maxLength = 40,
}: {
  value: string
  onRename: Save
  /** Accessible name. */
  label?: string
  maxLength?: number
}) {
  return (
    <InlineText
      value={value}
      onCommit={onRename}
      label={label}
      maxLength={maxLength}
      allowEmpty={false}
      className="min-w-[60px] whitespace-nowrap text-[15px] font-medium text-ink"
    />
  )
}

/**
 * An editable note under a row title. "Add a note…" shows while it is empty — focused
 * too, so the manager can see what the field is for as they start typing. Enter saves
 * and hands focus to the row's primary action (`primaryRef`, the empty row's +) when
 * there is one, else leaves the field. Clearing a note is a save. Saves are silent: a
 * note is dashboard-only and never lights the Publish bar.
 */
export function NoteField({
  value,
  onSave,
  primaryRef,
  autoFocus = false,
  label = 'Note',
  placeholder = 'Add a note…',
  maxLength = 500,
}: {
  value: string
  onSave: Save
  /** Where Enter sends focus: the row's + (RowIcon variant "primary" takes a ref). */
  primaryRef?: RefObject<HTMLElement | null>
  /** Focus on mount — the new row's note, straight after the add form. */
  autoFocus?: boolean
  label?: string
  placeholder?: string
  /** 500, the database's limit on every brand note. */
  maxLength?: number
}) {
  return (
    <div className="mt-0.5">
      <InlineText
        value={value}
        onCommit={onSave}
        label={label}
        placeholder={placeholder}
        maxLength={maxLength}
        allowEmpty
        primaryRef={primaryRef}
        autoFocus={autoFocus}
        className="min-h-[1.45em] min-w-[160px] max-w-[40ch] text-[13px] text-ink-muted empty:before:text-ink-faint empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  )
}
