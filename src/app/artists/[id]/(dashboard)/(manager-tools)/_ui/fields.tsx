'use client'

import { forwardRef, type KeyboardEventHandler, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cx } from '@/lib/cx'
import { END_SLOT } from './ledger'

/**
 * THE LEDGER'S SMALL FIELDS, in round 2's row grammar (prototypes/seo_variants_20260928_r2.html,
 * Brand's ledger): values that read as text and edit in place with a thin underline, faint
 * icons with hover labels for every action (Sam, 2026-09-28: "I dont like the white pill form
 * buttons to take action... I like icons"). Lists are click-to-edit (edit-list.tsx, 2026-10-05).
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
