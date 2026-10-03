'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icons'
import { EDIT_GLYPH } from '@/components/ui/icon-hover'
import { cx } from '@/lib/cx'
import { CAPS_LABEL, EDIT_TARGET, REVEAL_ON_HOVER } from './(manager-tools)/_ui/styles'

/**
 * The grammar every dashboard modal is built from (prototype G, Sam, 2026-09-11; its header
 * rewritten 2026-10-02):
 *
 *   title    usually NONE: the click that opened the modal already said what it is (Sam,
 *            2026-10-02: "I dont like these type of headers in modals. Remove it if its not
 *            needed, or make it simple, a few words, no icons"). Kept only to say WHICH item
 *            is open — a song's name, a show's date and venue — as a few plain words on
 *            CardModal's top bar (`title`, styled by `modalTitleClass`). Never an icon, a
 *            mark, a logo or a picture beside it; never a meta line or subtitle under it;
 *            never big type. The dialog keeps its accessible name either way (`label`).
 *   rows     `LABEL  value` — a value reads as text until clicked, then it is an input;
 *            blur / Enter saves THAT field alone, Escape puts the old value back;
 *            an empty value reads as "—", never a blank line
 *   footer   Delete left, Save right (CardModal owns it)
 *
 * No section headings, no hairlines beside labels, no Save-to-write button: each row saves
 * itself. The song modal was the first to read this way and Sam asked for it everywhere.
 */

type SaveResult = { error?: string } | void | undefined

/**
 * The mono uppercase label cell every dashboard row starts with — 100px, the width
 * KvRow already used everywhere (song modal, tour, connections, merch, releases,
 * videos). Brand and Settings drifted to 120px (Brand plain, Settings with an extra
 * `pt-[7px]`) before converging back on this one (2026-09-18): rather than widen every
 * modal to match two outliers, the two outliers moved. Exported so a page-level row
 * that can't be a full KvRow (Settings' whole-row click, stacked label+value) still
 * wears the same label.
 */
export function KvLabel({ children, top = false }: { children: ReactNode; top?: boolean }) {
  return <span className={cx(CAPS_LABEL, 'w-[100px] flex-none text-ink-faint', top && 'pt-2')}>{children}</span>
}

/** The row shell: a mono label on the left, whatever the row holds on the right. The row is
 *  its pencil's EDIT_TARGET (_ui/styles.ts): the pencil shows while the row is hovered or its
 *  value has keyboard focus. */
export function KvRow({
  label,
  labelNode,
  children,
  className,
  align = 'center',
}: {
  label: string
  /** Something to show INSTEAD of the label text — a platform's logo, say. The text stays
   *  for screen readers (and tests) as an sr-only span. */
  labelNode?: ReactNode
  children: ReactNode
  className?: string
  /** `start` keeps the label on the FIRST line when the row can grow (a lineup with its
   *  act panel open); `center` is the one-line default. */
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={cx(
        EDIT_TARGET,
        'group flex min-h-[44px] gap-4 border-b border-hairline-soft py-3 last:border-b-0',
        align === 'start' ? 'items-start' : 'items-center',
        className,
      )}
    >
      {labelNode ? (
        <span className={cx('flex w-7 flex-none items-center', align === 'start' && 'pt-2')}>
          {labelNode}
          <span className="sr-only">{label}</span>
        </span>
      ) : (
        <KvLabel top={align === 'start'}>{label}</KvLabel>
      )}
      <div className={cx('relative flex min-w-0 flex-1 gap-3', align === 'start' ? 'items-start' : 'items-center')}>{children}</div>
    </div>
  )
}

export type SelectOption = { value: string; label: string }

type EditableProps = {
  label: string
  value: string
  onSave: (value: string) => Promise<SaveResult> | SaveResult
  onError?: (message: string) => void
  /** Space Mono for dates, times, URLs, ids. */
  mono?: boolean
  type?: 'text' | 'url' | 'date' | 'time'
  /** A select instead of a text input; saves on change. The empty option reads "—". */
  options?: SelectOption[]
  /** Drop the empty option — for a value that always has to be something (a song's type). */
  required?: boolean
  /** Shown, never edited — a value another system owns (a Shopify product's price). */
  readOnly?: boolean
}

/**
 * The editable value. Text until clicked; then an input with the value. Only a CHANGED
 * value is saved — an untouched row never writes — and a refused save puts the old
 * value back and reports why. Optimistic: the new value shows while the save is out.
 */
function Editable({ label, value, onSave, onError, mono, type = 'text', options, required, readOnly, size }: EditableProps & { size: 'row' | 'cell' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // What the row SHOWS. Seeded from the prop and re-seeded when the prop changes (a
  // refresh after another save), so a stale optimistic value can't outlive the server's.
  const [shown, setShown] = useState({ from: value, now: value })
  if (shown.from !== value) setShown({ from: value, now: value })
  const current = shown.now

  async function commit(next: string) {
    setEditing(false)
    if (next === current) return
    const prev = current
    setShown((s) => ({ ...s, now: next }))
    const res = await onSave(next)
    if (res && 'error' in res && res.error) {
      setShown((s) => ({ ...s, now: prev }))
      onError?.(res.error)
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault() // inside a form this must never submit it
      void commit(draft.trim())
    } else if (e.key === 'Escape') {
      setDraft(current)
      setEditing(false)
    }
  }

  // Text and input share ONE box — same height, same line, a bottom border on both
  // (transparent on text, ink on the input) — so clicking a row never moves the modal.
  const textClass = cx('block h-6 min-w-0 flex-1 truncate border-b leading-6', mono ? 'font-space text-[13px]' : 'text-[15px]', size === 'cell' && 'h-6')

  if (readOnly) {
    return <span className={cx(textClass, 'border-transparent', !current && 'text-hairline')}>{current || '—'}</span>
  }

  if (options) {
    return (
      // No chevron here: the row already wears the pencil on hover; a click on the value
      // opens the menu (Sam, 2026-09-11).
      <SelectMenu label={label} value={current} options={options} required={required} mono={mono} chevron={false} onChange={(v) => void commit(v)} />
    )
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit(draft.trim())}
        onKeyDown={onKey}
        className={cx(textClass, 'border-ink bg-transparent p-0 outline-none')}
      />
    )
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => {
        setDraft(current)
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setDraft(current)
          setEditing(true)
        }
      }}
      className={cx(textClass, 'cursor-text border-transparent', !current && 'text-hairline')}
    >
      {current || '—'}
    </span>
  )
}

/** The row's pencil: a mark, not a control (the value is the click). Hidden until the row is
 *  hovered or its value is focused, always there on a touch screen (REVEAL_ON_HOVER). */
function RowPencil() {
  return <Icon name="edit" size={EDIT_GLYPH} className={cx('flex-none text-ink-faint transition-opacity', REVEAL_ON_HOVER)} />
}

/** One `LABEL  value` row that saves its own field. `trailing` sits after the value —
 *  an "open in a new tab" mark beside a link, say — and shows whatever the hover state. */
export function KvField({ trailing, labelNode, ...props }: EditableProps & { trailing?: ReactNode; labelNode?: ReactNode }) {
  return (
    <KvRow label={props.label} labelNode={labelNode}>
      <Editable {...props} size="row" />
      {trailing}
      {props.readOnly ? null : <RowPencil />}
    </KvRow>
  )
}

/** One row holding several small labelled cells on a line (city · state · country),
 *  each saving its own field alone. */
export function KvCells({ label, cells }: { label: string; cells: EditableProps[] }) {
  return (
    <KvRow label={label}>
      <div className="grid min-w-0 flex-1 grid-cols-[1.4fr_0.7fr_1fr] gap-4">
        {cells.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col gap-0.5">
            <span className={cx(CAPS_LABEL, 'text-ink-faint')}>{c.label}</span>
            <Editable {...c} size="cell" />
          </div>
        ))}
      </div>
      <RowPencil />
    </KvRow>
  )
}

/**
 * The dashboard's own drop-down (Sam, 2026-09-11: the native one "isn't styled like the
 * rest of the site"). Reads as the row's value with a chevron; opens the same paper menu
 * the ⋯ menus use — hairline, rounded, a check on the current choice. Closes on a pick,
 * on Escape, or on a click anywhere else. `combobox` / `listbox` / `option` roles, so it
 * reads to a screen reader (and a test) as the select it replaces.
 */
export function SelectMenu({
  label,
  value,
  options,
  required,
  mono,
  chevron = true,
  onChange,
  placeholder = '—',
}: {
  label: string
  value: string
  options: SelectOption[]
  /** No empty choice — for a value that always has to be something. */
  required?: boolean
  mono?: boolean
  /** The small arrow after the value. Off inside a row, whose hover pencil already says
   *  "this is editable". */
  chevron?: boolean
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation() // the menu closes; the card under it stays open
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const shown = options.find((o) => o.value === value)?.label ?? value
  const choose = (v: string) => {
    setOpen(false)
    if (v !== value) onChange(v)
  }
  const item = (v: string, text: string) => (
    <button
      key={v || '__empty'}
      type="button"
      role="option"
      aria-selected={v === value}
      onClick={() => choose(v)}
      className={cx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface', v === value ? 'text-ink' : 'text-ink-muted', !v && 'text-ink-faint')}
    >
      <span className="truncate">{text}</span>
      {v === value ? <Icon name="check" size={13} className="flex-none" /> : null}
    </button>
  )

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'flex h-6 w-full min-w-0 items-center gap-1.5 border-b border-transparent text-left leading-6 outline-none',
          mono ? 'font-space text-[13px]' : 'text-[15px]',
          !value && 'text-hairline',
        )}
      >
        <span className="truncate">{value ? shown : placeholder}</span>
        {chevron ? <Icon name="chevronRight" size={12} className={cx('flex-none rotate-90 text-ink-faint transition-transform', open && '-rotate-90')} /> : null}
      </button>
      {open && (
        <div id={listId} role="listbox" aria-label={label} className="absolute left-0 top-full z-20 mt-1 max-h-64 min-w-[180px] overflow-auto rounded-xl border border-hairline bg-paper py-1 shadow-2xl">
          {required ? null : item('', placeholder)}
          {options.map((o) => item(o.value, o.label))}
        </div>
      )}
    </div>
  )
}
