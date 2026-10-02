'use client'

import { forwardRef, useRef, useState, type KeyboardEventHandler, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { HoverLabel, RowIcon } from './row-icon'
import { FOCUS_RING } from './focus-ring'
import { END_SLOT } from './ledger'

/**
 * THE LEDGER'S SMALL FIELDS, in round 2's row grammar (prototypes/seo_variants_20260928_r2.html,
 * Brand's ledger): values that read as text and edit in place with a thin underline, faint
 * icons with hover labels for every action (Sam, 2026-09-28: "I dont like the white pill form
 * buttons to take action... I like icons"), chips for lists.
 *
 * Users: the SEO / GEO tabs (Details, Answers) and Profile (2026-10-02, when Facts moved there).
 * Was tools/seo/_ui/parts.tsx until a second tool used it.
 */

/** The ledger row's end column (32px, ledger.tsx END_SLOT), for a row whose action sits there. */
export function EndSlot({ children }: { children?: ReactNode }) {
  return <span className={cx(END_SLOT, 'flex')}>{children}</span>
}

/** "37 of 70" — faint, red once over. */
export function Count({ n, max, className }: { n: number; max: number; className?: string }) {
  return <span className={cx('whitespace-nowrap font-space text-[11px]', n > max ? 'text-accent-red' : 'text-ink-faint', className)}>{`${n} of ${max}`}</span>
}

/** The value look every in-place field shares: no box, a thin underline on focus only. No
 *  colour or size here: each field picks exactly one of each (cx joins, it doesn't resolve a
 *  clash, so two text colours would leave the stylesheet's order to pick). */
const FIELD = 'min-w-0 border-b border-transparent bg-transparent p-0 outline-none placeholder:text-ink-faint focus:border-ink'

type Tone = 'ink' | 'muted' | 'faint'
const TONE: Record<Tone, string> = { ink: 'text-ink', muted: 'text-ink-muted focus:text-ink', faint: 'text-ink-faint focus:text-ink' }

/** One line of text, read as text until focused. `mono` is the small Space Mono line (a file
 *  name); `mono="value"` is an address read as the row's value (13px, Settings' booking email);
 *  `invalid` turns it red. */
export const LineField = forwardRef<
  HTMLInputElement,
  {
    label: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
    /** Width and alignment only. */
    className?: string
    invalid?: boolean
    mono?: boolean | 'value'
    tone?: Tone
    inputMode?: 'numeric' | 'text' | 'email'
    onFocus?: () => void
    onBlur?: () => void
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  }
>(function LineField({ label, value, onChange, placeholder, className, invalid, mono, tone = 'ink', inputMode, onFocus, onBlur, onKeyDown }, ref) {
  return (
    <input
      ref={ref}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={cx(
        FIELD,
        mono === 'value' ? 'font-space text-[13px] leading-6' : mono ? 'font-space text-[11px] leading-5' : 'text-[15px] leading-6',
        invalid ? 'text-accent-red' : TONE[tone],
        className,
      )}
    />
  )
})

/** Several lines, as tall as its text (`field-sizing: content`; `rows` is the floor where a
 *  browser can't size it). */
export const AreaField = forwardRef<
  HTMLTextAreaElement,
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; rows?: number; tone?: Tone; small?: boolean } & Pick<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'onKeyDown' | 'onBlur' | 'onFocus' | 'autoFocus'
  >
>(function AreaField({ label, value, onChange, placeholder, className, rows = 2, tone = 'ink', small = false, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      className={cx(FIELD, 'resize-none [field-sizing:content]', small ? 'text-[14px] leading-[1.5]' : 'text-[15px] leading-[1.5]', TONE[tone], className)}
      {...rest}
    />
  )
})

/**
 * A short list as CHIPS (modal-kit grammar: "Lists are CHIPS"): each chip has its own ×, the
 * dashed + at the end opens a one-line field; Enter or ✓ adds, Escape or × cancels. The
 * caller decides whether a new list is allowed (`onChange` returns an error to show, or null).
 */
export function Chips({
  label,
  items,
  onChange,
  addLabel,
  max,
}: {
  /** "Genre": names the list, its + ("Add genre") and each chip's × ("Remove House"). */
  label: string
  items: readonly string[]
  /** The whole new list. Resolves to an error sentence to show, or null when it was taken. */
  onChange: (next: string[]) => string | null
  addLabel: string
  max?: number
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const plus = useRef<HTMLButtonElement>(null)
  const done = useRef(false)
  const full = max !== undefined && items.length >= max

  function add() {
    const v = draft.trim()
    if (!v || done.current) return
    done.current = true
    if (onChange([...items, v]) === null) {
      setDraft('')
      setAdding(false)
    } else {
      done.current = false
      input.current?.focus()
    }
  }
  function cancel() {
    done.current = true
    setDraft('')
    setAdding(false)
    setTimeout(() => plus.current?.focus(), 0)
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center justify-start gap-1.5 min-[900px]:justify-end">
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className="group/chip relative inline-flex items-center gap-1 rounded-full border border-hairline bg-paper py-1 pl-2.5 pr-1.5 text-[12px] text-ink">
          {it}
          <button
            type="button"
            aria-label={`Remove ${it}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            // Always visible: a touch screen has no hover to reveal it (review L7).
            className={cx('-my-1 -mr-1 inline-flex rounded-full p-1 text-ink-faint transition-colors hover:text-accent-red', FOCUS_RING)}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={input}
            autoFocus
            aria-label={addLabel}
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              done.current = false
              setDraft(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancel()
              }
            }}
            className="w-[140px] rounded-full border border-hairline bg-paper px-2.5 py-1 text-[12px] text-ink outline-none focus:border-ink"
          />
          <RowIcon icon="check" label="Add" variant="primary" tone="accent" onClick={add} />
          <RowIcon icon="close" label="Cancel" variant="primary" tone="danger" onClick={cancel} />
        </span>
      ) : full ? null : (
        <button
          ref={plus}
          type="button"
          aria-label={addLabel}
          onClick={() => {
            done.current = false
            setAdding(true)
          }}
          className={cx('relative inline-flex items-center rounded-full border border-dashed border-hairline px-2 py-[5px] text-ink-faint transition-colors hover:border-ink-faint hover:text-accent', FOCUS_RING)}
        >
          <Icon name="plus" size={12} />
          <HoverLabel label={addLabel} />
        </button>
      )}
    </div>
  )
}
