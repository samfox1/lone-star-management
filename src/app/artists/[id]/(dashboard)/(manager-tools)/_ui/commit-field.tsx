'use client'

import { useRef, useState, type ComponentProps, type RefObject } from 'react'
import { toast } from '../../toast'
import { LineField } from './fields'
import { useSeeded } from './use-seeded'

type SaveResult = { error?: string } | void | undefined

type CommitFieldProps = Omit<ComponentProps<typeof LineField>, 'value' | 'onChange' | 'onFocus' | 'onBlur' | 'onKeyDown'> & {
  value: string
  /** The trimmed text, only when it changed. Resolve `{ error }` to refuse it. */
  onCommit: (next: string) => Promise<SaveResult> | SaveResult
  /** The input, for a row's pencil to focus. */
  inputRef?: RefObject<HTMLInputElement | null>
}

/**
 * A LINE THAT SAVES WHEN YOU LEAVE IT (Batch 3, Sam 2026-10-02: "Email you can type in place"):
 * Settings' booking email and an enquiry kind's name. LineField's look (text until focused, a
 * thin underline while it is), and instant: no draft, no Publish, no Save button.
 *
 *   blur or Enter  saves the trimmed text, only when it changed
 *   Escape         puts the saved text back and saves nothing
 *   a refusal      an error toast in the server's words; what was typed STAYS in the field so
 *                  it can be corrected (Escape puts the saved text back)
 *
 * A success says nothing: the text in the field is the confirmation.
 *
 * Not the debounced autosave Profile uses: an address is checked WHOLE by its door, and a
 * half-typed one saved at every pause would be refused at every pause.
 */
export function CommitField({ value, onCommit, inputRef, ...field }: CommitFieldProps) {
  const own = useRef<HTMLInputElement>(null)
  const el = inputRef ?? own
  // What the field shows as saved: optimistic, re-seeded when the parent sends a new value.
  const [current, setCurrent] = useSeeded(value)
  // What is being typed, or null when nothing is.
  const [draft, setDraft] = useState<string | null>(null)
  /** Enter or Escape already settled this edit; the blur they cause must not save again. */
  const settled = useRef(false)

  async function commit(raw: string) {
    setDraft(null)
    const next = raw.trim()
    if (next === current) return
    const prev = current
    setCurrent(next)
    let res: SaveResult
    try {
      res = await onCommit(next)
    } catch {
      res = { error: `Couldn't save that ${field.label.toLowerCase()}.` }
    }
    if (res && 'error' in res && res.error) {
      setCurrent(prev)
      // Keep the refused text to fix, unless something newer was typed while it was out.
      setDraft((d) => d ?? next)
      toast(res.error, 'error')
    }
  }

  return (
    <LineField
      {...field}
      ref={el}
      value={draft ?? current}
      onFocus={() => {
        settled.current = false
      }}
      onChange={(v) => {
        settled.current = false
        setDraft(v)
      }}
      onBlur={() => {
        if (settled.current) {
          settled.current = false
          return
        }
        if (draft !== null) void commit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          settled.current = true
          if (draft !== null) void commit(draft)
          el.current?.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          settled.current = true
          setDraft(null)
          el.current?.blur()
        }
      }}
    />
  )
}
