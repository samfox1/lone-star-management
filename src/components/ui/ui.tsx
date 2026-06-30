import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon, type IconName } from './icons'

/* ── Button ──────────────────────────────────────────────────────────────── */
export type ButtonVariant = 'solid' | 'accent' | 'ghost'

/** Button classes, exported so links that should look like buttons (e.g. a
 *  next/link) can share them without nesting a <button> inside an <a>. */
export function buttonClass(variant: ButtonVariant = 'solid', className?: string): string {
  const base =
    'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50'
  const styles: Record<ButtonVariant, string> = {
    solid: 'bg-ink text-white hover:bg-black',
    accent: 'bg-accent text-white hover:bg-accent-hover',
    ghost: 'border border-hairline bg-paper text-ink hover:border-ink-faint',
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

/** Square icon button with a hairline border. */
export function IconButton({
  name,
  active = false,
  className,
  ...rest
}: { name: IconName; active?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-accent-soft bg-accent-soft text-accent'
          : 'border-hairline bg-paper text-ink-muted hover:text-ink',
        className,
      )}
      {...rest}
    >
      <Icon name={name} size={17} />
    </button>
  )
}

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

/* ── Stat — big mono number with a caption ───────────────────────────────── */
export function Stat({
  value,
  label,
  accent,
  className,
}: {
  value: ReactNode
  label: ReactNode
  accent?: 'blue' | 'red'
  className?: string
}) {
  return (
    <div className={className}>
      <div
        className={cx(
          'font-space text-[25px] font-bold tracking-[-0.02em]',
          accent === 'blue' && 'text-accent',
          accent === 'red' && 'text-accent-red',
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </div>
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
