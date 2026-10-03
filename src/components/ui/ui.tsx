import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/lib/cx'

/* ── Button ──────────────────────────────────────────────────────────────── */
export type ButtonVariant = 'solid' | 'accent' | 'ghost' | 'danger' | 'confirm'

/** Button classes, exported so links that should look like buttons (e.g. a
 *  next/link) can share them without nesting a <button> inside an <a>. */
export function buttonClass(variant: ButtonVariant = 'solid', className?: string): string {
  // The editor's button voice, everywhere (Sam, 2026-08-28: "you keep coming back to
  // these style of buttons"): Space Mono, small caps, hairline or ink. One definition, so
  // the roster, the dashboard, the tools and the modals cannot drift apart again.
  const base =
    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] transition-colors disabled:opacity-50'
  const styles: Record<ButtonVariant, string> = {
    solid: 'border-ink bg-ink text-paper hover:opacity-85',
    accent: 'border-accent bg-accent text-white hover:bg-accent-hover',
    ghost: 'border-hairline bg-paper text-ink-muted hover:border-accent hover:text-accent',
    // The destructive half of a pair — the SAME pill as its neighbour (Sam, 2026-09-12:
    // "put a border around the delete button just like the Done button"), saying what it
    // is in colour rather than by being the only bare word in the row.
    danger: 'border-hairline bg-paper text-accent-red hover:border-accent-red hover:bg-danger-soft',
    // The affirming half — ghost's pill, but in INK (Sam asked twice: "I want the text
    // black"). A VARIANT rather than `buttonClass('ghost', 'text-ink')`, because cx is a
    // plain joiner with no Tailwind conflict resolution: both text colours would land in
    // the class list and the stylesheet's order would pick the winner — which it did,
    // leaving Save grey.
    confirm: 'border-hairline bg-paper text-ink hover:border-accent hover:text-accent',
  }
  return cx(base, styles[variant], className)
}

export function Button({
  variant = 'solid',
  className,
  children,
  ...rest
}: { variant?: ButtonVariant } & ComponentProps<'button'>) {
  return (
    <button className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  )
}

/** Shared text-input classes for the dashboard's compact inline edit forms. */
export const inputClass =
  'min-w-0 rounded-lg border border-hairline px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'

/** One shape for every dashboard modal: a dim overlay + a squarish paper card. Shared
 *  so Add / edit / publish / confirm dialogs never drift apart. */
export const modalOverlayClass = 'fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6'
export const modalCardClass = 'relative flex max-h-[88vh] w-[640px] max-w-full flex-col overflow-auto rounded-2xl bg-paper p-7 shadow-2xl'
/** Wide, two-column variant (e.g. the release editor): fits its content without a
 *  vertical scroll, so both columns read at a glance. */
export const modalCardWideClass = 'relative flex w-[880px] max-w-[94vw] flex-col rounded-2xl bg-paper p-7 shadow-2xl'
/** A modal's title, when it has one (Sam, 2026-10-02): a few plain words at body size.
 *  Never an icon, a mark or a picture beside it, never a meta line under it, never big.
 *  Most modals have NO title: the click that opened them already said what they are. A
 *  title is kept only to say WHICH item is open (a song's name, a show's date and venue)
 *  or to ask a question nothing else asked (the upload gate). */
export const modalTitleClass = 'text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink'

/* ── Avatar ──────────────────────────────────────────────────────────────── */
export function Avatar({
  initials,
  size = 38,
  pending = false,
  className,
  title,
}: {
  initials: string
  size?: number
  pending?: boolean
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={cx(
        'inline-flex flex-none items-center justify-center rounded-full font-space font-bold',
        pending ? 'bg-surface text-ink-faint' : 'bg-avatar text-avatar-ink',
        className,
      )}
    >
      {initials}
    </span>
  )
}

/** First letters of the first two words — avatar fallback for a name. */
export function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return (((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?').slice(0, 2)
}

/* ── Card ────────────────────────────────────────────────────────────────── */
export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cx('rounded-xl border border-hairline bg-paper', className)} {...rest}>
      {children}
    </div>
  )
}

/* ── KLabel — small mono uppercase caption ───────────────────────────────── */
export function KLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ── StatusDot ───────────────────────────────────────────────────────────── */
export function StatusDot({
  tone = 'neutral',
  className,
}: {
  tone?: 'live' | 'neutral' | 'pending'
  className?: string
}) {
  const tones = {
    live: 'bg-accent-red',
    neutral: 'bg-ink-faint',
    pending: 'bg-status-pending',
  } as const
  return (
    <span className={cx('inline-block h-[7px] w-[7px] flex-none rounded-full', tones[tone], className)} />
  )
}

/* ── Form field ──────────────────────────────────────────────────────────── */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  )
}

const fieldBase =
  'w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(fieldBase, className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(fieldBase, 'min-h-24 resize-y leading-relaxed', className)} {...rest} />
}

/**
 * A clickable LIST ROW — a tour date, a connection. The whole row opens its editor, and
 * the hover says so: a soft surface tint and a slight grow, the "between" Sam asked for
 * (2026-09-13: "maybe the row grows a bit or maybe the background color changes a bit.
 * I want something else between these two"). The negative x-margin lets the tint run past
 * the text without moving it.
 */
export const rowHoverClass =
  '-mx-3 cursor-pointer rounded-xl px-3 transition-[background-color,transform] duration-150 hover:scale-[1.01] hover:bg-surface'
export const listRowClass = `flex items-center ${rowHoverClass}`
