'use client'

/**
 * The SEO / GEO editor's row language — the editor inspector's own: a mono eyebrow with a
 * rule (GroupLabel), a surface-tinted body, label-left / field-right rows, fields on the
 * tint. One place, so every section reads the same.
 */
import { ControlRow, FIELD_ON_TINT, GroupLabel, PANEL_BODY, SaveLine, type SaveStatus } from '../../../editor/inspector-shared'
import { cx } from '@/lib/cx'

export { GroupLabel, ControlRow, SaveLine, PANEL_BODY, FIELD_ON_TINT }
export type { SaveStatus }

export function Body({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx(PANEL_BODY, 'rounded-b-xl', className)}>{children}</div>
}

/** A full-width labelled field (title, description, bio): eyebrow above, field below. */
export function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted">{label}</span>
        {hint && <span className="font-space text-[10px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export const INPUT = FIELD_ON_TINT
export const TEXTAREA = cx(FIELD_ON_TINT, 'min-h-28 resize-y font-sans text-[13px] leading-relaxed')
export const SELECT = cx(FIELD_ON_TINT, 'w-[200px]')

/** The one line under a section: how to see the effect, in plain words. */
export function SeeIt({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pt-3 font-space text-[10px] leading-relaxed text-ink-faint">
      <span className="font-bold uppercase tracking-[0.1em] text-ink-muted">To see it </span>
      {children}
    </p>
  )
}
