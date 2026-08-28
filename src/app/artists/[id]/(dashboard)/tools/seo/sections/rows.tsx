'use client'

/**
 * The SEO / GEO editor's building blocks, in the ASSETS pages' language (Sam,
 * 2026-08-28: "resemble more from the assets page", not the editing panel): a mono
 * KLabel caption, bordered rounded-2xl cards, the dashboard's own Field / Input /
 * Textarea, and one quiet mono line under a card. No surface tint, no inspector rows.
 */
import { cx } from '@/lib/cx'
import { KLabel, Input, Textarea } from '@/components/ui/ui'
import { SaveLine, type SaveStatus } from '../../../editor/inspector-shared'

export { KLabel, Input, Textarea, SaveLine }
export type { SaveStatus }

/** A section caption: the assets pages' "12 photos" label, here naming the card. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <KLabel>{children}</KLabel>
    </div>
  )
}

/** A card, like an asset tile: hairline border, 2xl corners, paper. */
export function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-hairline bg-paper p-5', className)}>{children}</div>
}

/** A labelled field inside a card. */
export function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{label}</span>
        {hint && <span className="font-space text-[10px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** A short field row: label left, control right, like the dashboard's inline forms. */
export function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-1.5">
      <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{label}</span>
      {children}
    </div>
  )
}

const fieldBase =
  'w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'
export const INPUT = fieldBase
export const TEXTAREA = cx(fieldBase, 'min-h-28 resize-y leading-relaxed')
export const SELECT = cx(fieldBase, 'w-[220px]')

/** The one line under a card: how to see the effect, in plain words. */
export function SeeIt({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 px-1 font-space text-[11px] leading-relaxed text-ink-muted">
      <span className="font-bold uppercase tracking-[0.1em] text-ink-faint">To see it </span>
      {children}
    </p>
  )
}
