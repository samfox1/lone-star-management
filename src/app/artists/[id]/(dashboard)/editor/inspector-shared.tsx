import { cx } from '@/lib/cx'
import { Icon, type IconName } from '@/components/ui/icons'

/**
 * The shared vocabulary of the editor inspector — the primitives every panel (Style,
 * Links, Text, Images, Videos, Music, Tour, Merch, component slots) builds from. Pulled
 * out of editor-inspector.tsx so a panel imports what it needs instead of the whole
 * file, and so the visual language (mono labels, tinted fields, section rows) lives in
 * ONE place rather than being re-styled per panel.
 *
 * Purely presentational + one save helper. No data, no server actions, no panel logic.
 */

/** `2 photos` / `1 photo`. Every noun the inspector counts pluralizes with +s. */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export const EYEBROW = 'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'
// Red ring for a field whose value the server would reject (a blank required field, a
// bad price) — gating the save so the panel can't claim "Saved" on a dropped write.
export const INVALID_RING = 'border-accent-red focus:border-accent-red'
// The same signal for a BORDERLESS field (the restyled Style/Links/Text panels): those
// have no border to redden, so the invalid state is a ring instead. Kept separate from
// INVALID_RING so the still-bordered panels (Merch, Music, Tour) are untouched.
export const INVALID_FIELD = 'ring-1 ring-accent-red focus:ring-accent-red'

/* ── Panel layout primitives (the "grid sheet" inspector) ────────────────────────────
 * The Style / Links / Text panels share one visual language: NO bordered containers.
 * Structure comes from grouping (a mono eyebrow + trailing rule), a leading icon per
 * row, and whitespace — not from boxes. Fields are tinted rather than outlined.
 *
 * TYPE RULE: the panel is Space Mono THROUGHOUT — labels, names, values, and the text
 * the manager types into a field (Sam, 2026-07-21). `font-space` sits on the <aside>
 * so everything inherits it; inputs/selects/textareas restate it because form controls
 * do not inherit font-family from an ancestor. Mono runs wider than Inter, so row text
 * is 13px where Inter was 14px, keeping the same line count per row.
 */

/** A borderless field on the panel's white ground: tinted at rest, paper on focus. */
export const FIELD =
  'w-full rounded-md bg-surface px-2.5 py-2 font-space text-[13px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline'

/** The same field INSIDE an expanded body, which is itself tinted — so it inverts:
 *  paper on grey, or it would vanish into its own background. */
export const FIELD_ON_TINT =
  'w-full rounded-md bg-paper px-2.5 py-2 font-space text-[13px] text-ink outline-none ring-1 ring-hairline placeholder:font-space placeholder:text-ink-faint focus:ring-ink-faint'

/** An expanded section's body. The grey ground is what separates a section from the
 *  controls it owns — the parent row stays on white and needs no extra weight. */
export const PANEL_BODY = 'bg-surface px-5 pb-3 pt-2'

/** The mono micro-cap that names a control or field. */
export const CONTROL_LABEL = 'font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted'

/** The inspector's scrolling body. Scrolls, but draws NO scrollbar: the panel is a fixed
 *  narrow column beside the site preview, and a permanent gutter (or a bar that appears
 *  and reflows every row by a few px) is visual noise on a surface that is meant to read
 *  as chrome. Wheel, trackpad, keyboard and touch are untouched. */
export const SCROLL_BODY = 'flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Run a field's save SERIALIZED per id (chained onto that field's previous save, so an
 * older keystroke's write can't land after a newer one — review #6), and reflect the
 * result honestly across concurrent fields via an `errored` set, so one field's failure
 * isn't masked by another field's later success (review #8).
 */
export function runSerialized(
  saving: { current: Map<string, Promise<unknown>> },
  errored: { current: Set<string> },
  setStatus: (s: SaveStatus) => void,
  id: string,
  action: () => Promise<{ error?: string } | void>,
): void {
  // Fire immediately when this field has no save in flight; only CHAIN behind a prior
  // one (so overlapping saves of the same field can't land out of order).
  const prev = saving.current.get(id)
  const settled = Promise.resolve(prev ? prev.then(() => action()) : action())
  saving.current.set(id, settled.catch(() => {}))
  // BOTH outcomes must land: an action that REJECTS (network drop, an uncaught server
  // throw) is not the same as one that resolves `{ error }`. Handling only the resolved
  // shape leaves the field on "Saving…" forever and the rejection unhandled.
  void settled.then(
    (res) => {
      if (res && (res as { error?: string }).error) errored.current.add(id)
      else errored.current.delete(id)
      setStatus(errored.current.size ? 'error' : 'saved')
    },
    () => {
      errored.current.add(id)
      setStatus('error')
    },
  )
}

/** A collapsible section header — label, optional tag, chevron. No border and no
 *  leading icon: the section list reads as a plain outline of the page (Sam,
 *  2026-07-21); the chevron rotating is the only open/closed signal. */
export function SectionRow({
  label,
  tag,
  open,
  onClick,
}: {
  label: string
  tag?: React.ReactNode
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label}</span>
      {tag}
      <span className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90')} aria-hidden>
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  )
}

/** One control on the sheet grid: [mono label] [control]. No icon — the style controls
 *  read as a clean list of named values, and a glyph per row was noise, not navigation. */
export function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 py-1.5">
      <span className={CONTROL_LABEL}>{label}</span>
      {children}
    </div>
  )
}

/** A labelled field on the sheet grid: [icon] [label over field]. */
export function FieldRow({
  icon,
  label,
  action,
  children,
}: {
  /** Optional: a column of text fields reads better without one glyph per row. */
  icon?: IconName
  label: string
  /** Trailing control on the label line (an Edit button). */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cx('grid items-start gap-x-2.5 py-1.5', icon ? 'grid-cols-[20px_1fr]' : 'grid-cols-1')}>
      {icon && (
        <span className="mt-2 justify-self-center text-ink-faint" aria-hidden>
          <Icon name={icon} size={14} />
        </span>
      )}
      {/* The action sits OUTSIDE the <label>: a button inside one is also a click target
          for the field, so pressing Edit would focus the input on the way past — and it
          makes the label ambiguous to assistive tech, which then reads two controls. */}
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={CONTROL_LABEL}>{label}</span>
          {action}
        </div>
        <label className="block">{children}</label>
      </div>
    </div>
  )
}

/** "Edit" on a row that opens a full-panel editor — the same affordance the image and
 *  video tiles use, so the word means one thing across the inspector. */
export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className="flex-none rounded-md px-1.5 py-0.5 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint transition-colors hover:bg-surface hover:text-accent"
    >
      Edit
    </button>
  )
}

/** The mono status line every panel ends with. */
export function SaveLine({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  return (
    <p className={cx('px-5 pt-3', EYEBROW, status === 'error' && 'text-accent-red')}>
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed'}
    </p>
  )
}

/** A panel-level group heading: the mono eyebrow padded to the gutter, hairline rule
 *  trailing it (Socials / Tour support / Hero / Sections …). */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-4">
      <span className={EYEBROW}>{children}</span>
      <span className="h-px flex-1 bg-hairline-soft" />
    </div>
  )
}

/** A tighter group heading used INSIDE a panel body (the orientation groups). */
export function SlotGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className={EYEBROW}>{children}</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  )
}

/** Per-item "on the site" toggle (writes the `on_site` flag). Being in the library never
 *  implies on-site — the manager selects each item on. */
export function OnSiteToggle({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? 'On the site — click to take off' : 'Off the site — click to add'}
      className={cx(
        'inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] transition-colors',
        on ? 'bg-accent text-white' : 'border border-hairline bg-paper text-ink-faint hover:text-ink',
        className,
      )}
    >
      <Icon name="check" size={11} className={on ? undefined : 'opacity-40'} />
      {on ? 'On site' : 'Off'}
    </button>
  )
}
