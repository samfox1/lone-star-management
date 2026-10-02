'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { FOCUS_RING_OFFSET } from '../_ui/styles'

/** The site's own drop-down (the Type select's look): the value in plain ink and the up-down
 *  glyph that says it's a choice. The empty choice reads as its own label ("Site default",
 *  "—"); a stored value that isn't among the options reads as itself, never as another one.
 *  Long lists (every country, every state) scroll inside the menu, open at the current
 *  choice, and jump as letters are typed; ↑ ↓ move, Escape closes. */
export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  align = 'end',
  size = 'row',
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (v: string) => void
  align?: 'start' | 'end'
  /** `cell`: the 15px value of a small labelled cell (city · region · country). */
  size?: 'row' | 'cell'
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation() // the menu closes; a window under it stays open
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    // Open at the current choice (or the top), with focus on it.
    const current = list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('[role="option"]')
    current?.focus({ preventScroll: true })
    current?.scrollIntoView?.({ block: 'nearest' })
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const match = options.find((o) => o.value === value)
  const shown = match ? match.label : value || (options.find((o) => o.value === '')?.label ?? '')
  // Only the bare "—" reads faint; a named empty choice ("Site default") is a real choice.
  const faint = !value && shown === '—'

  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      return
    }
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
    // Type to jump: the letters typed within a moment, as the start of a name.
    const now = Date.now()
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
    const hit = items.find((el) => (el.dataset.label ?? '').toLowerCase().startsWith(typed.current.text))
    if (hit) {
      e.preventDefault()
      hit.focus()
      hit.scrollIntoView?.({ block: 'nearest' })
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex max-w-full items-center rounded-md text-[15px]',
          size === 'cell' ? 'gap-1.5 leading-6' : 'gap-2.5',
          faint ? 'text-ink-faint' : 'text-ink',
          FOCUS_RING_OFFSET,
        )}
      >
        <span className="min-w-0 truncate">{shown}</span>
        <Icon name="chevronsUpDown" size={size === 'cell' ? 15 : 18} className="flex-none text-ink-faint" />
      </button>
      {open ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          className={cx('absolute top-full z-20 mt-1 max-h-72 min-w-[200px] overflow-auto rounded-xl border border-hairline bg-paper py-1 shadow-2xl', align === 'end' ? 'right-0' : 'left-0')}
        >
          {options.map((t) => (
            <button
              key={t.value || '__default'}
              type="button"
              role="option"
              data-label={t.label}
              aria-selected={t.value === value}
              onClick={() => {
                setOpen(false)
                if (t.value !== value) onChange(t.value)
              }}
              className={cx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm outline-none hover:bg-surface focus:bg-surface', t.value === value ? 'text-ink' : 'text-ink-muted')}
            >
              {t.label}
              {t.value === value ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
