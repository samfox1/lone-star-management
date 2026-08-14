import { useEffect, useRef } from 'react'
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


/** One control on the sheet grid: [mono label] [control]. No icon — the style controls
 *  read as a clean list of named values, and a glyph per row was noise, not navigation. */
export function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // py-1 (was py-1.5): the editor's control column reads denser (Sam, 2026-08-12).
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 py-1">
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
  title,
  children,
}: {
  /** Optional: a column of text fields reads better without one glyph per row. */
  icon?: IconName
  label: string
  /** Trailing control on the label line (an Edit button). */
  action?: React.ReactNode
  /** Hover text on the label — a longer explanation that would cost a whole row if it
   *  were rendered as a line of its own. */
  title?: string
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
          <span className={CONTROL_LABEL} title={title}>{label}</span>
          {action}
        </div>
        <label className="block">{children}</label>
      </div>
    </div>
  )
}

/**
 * THE unified list row (Sam, 2026-08-12): a mono-caps KEY over its current VALUE, with
 * a bare grey edit pencil that appears only on row hover (no bordered button). One row
 * shape for Text, Links, Merch, and Style — the "version A" prototype. An empty value
 * renders muted so a blank reads as "nothing set yet", not broken.
 */
export function EditRow({
  label,
  value,
  empty = false,
  grip = false,
  trailing,
  expanded,
  editLabel,
  onEdit,
}: {
  /** The KEY — always shown, so a field like "Name" is unambiguous. */
  label: string
  /** The current value (or the muted placeholder when `empty`). OMIT for a single-line
   *  row that is just its name — the Style panel's regions, which have no one value to
   *  summarise (Sam, 2026-08-12: "I don't need to see the paper, 2x padding"). */
  value?: React.ReactNode
  empty?: boolean
  /** A leading drag grip that appears on hover — the reorder handle for the socials
   *  list. The row's own draggable wrapper does the actual dragging. */
  grip?: boolean
  /** A trailing element before the pencil (the socials "Off" tag). */
  trailing?: React.ReactNode
  /** Sets `aria-expanded` on the pencil, for a row whose pencil toggles an inline box. */
  expanded?: boolean
  /** Overrides the pencil's accessible name (`Edit <editLabel>`) when the visible label
   *  is user content — socials number their rows ("social link 1") so two lists don't
   *  collide, even though the row shows the platform name. */
  editLabel?: string
  onEdit: () => void
}) {
  const singleLine = value === undefined
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface">
      {grip && (
        <span className="flex-none cursor-grab text-ink-faint opacity-0 transition-opacity group-hover:opacity-60" aria-hidden>
          <Icon name="grip" size={16} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {singleLine ? (
          <span className="truncate text-[13px] text-ink">{label}</span>
        ) : (
          <>
            <span className={CONTROL_LABEL}>{label}</span>
            <span
              className={cx('truncate text-[13px]', empty ? 'italic text-ink-faint' : 'text-ink')}
            >
              {value}
            </span>
          </>
        )}
      </div>
      {trailing}
      {/* OPEN rows carry an X, not a pencil (Sam, 2026-08-14: "the edit button should be
          an x to close it") — and it is NOT hover-gated. The pencil may fade in on hover
          because a closed row is quiet by design; the only way to shut an open one must
          be visible the moment it opens, or the affordance is a secret. */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${expanded ? 'Close' : 'Edit'} ${editLabel ?? label}`}
        aria-expanded={expanded}
        className={cx(
          'flex-none text-ink-faint transition-opacity hover:text-ink focus-visible:opacity-100',
          expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Icon name={expanded ? 'close' : 'edit'} size={16} />
      </button>
    </div>
  )
}

/**
 * Close an expanded row when the manager clicks ANYWHERE outside it (Sam, 2026-08-14:
 * "when the editing panel is open, hitting the x or tapping anywhere else should close
 * it"). Attach the returned ref to the wrapper that holds BOTH the row header and its
 * expanded body — everything inside is "still working in here".
 *
 * `mousedown`, not `click`, for two reasons. It fires before the click that OPENS another
 * row, so switching rows lands open-on-the-new-one rather than closing what the second
 * click just opened. And a slider drag that starts inside the body but releases outside it
 * (the handle at the far right, the pointer drifting off the panel) never sees a `click`
 * on the body at all — on `click` semantics that drag would shut the panel mid-adjust.
 *
 * Escape closes too: same intent, and it is the one gesture that works when the open body
 * covers everything a manager might otherwise click.
 */
export function useCollapseOnOutsideClick(
  isOpen: boolean,
  onClose: () => void,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  // The callback lives in a ref so the listener subscribes ONCE per open, instead of
  // tearing down and re-adding on every parent render (every keystroke, every slider tick).
  const close = useRef(onClose)
  // Written in an effect, never during render: React's rule, and the timing is free
  // here because the listener can only fire after a commit.
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      const el = ref.current
      if (el && e.target instanceof Node && !el.contains(e.target)) close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])
  return ref
}

/** The brief empty state for a manifest-slot panel (Images, Videos, site Links). When the
 *  site declares no slots of this kind there is nothing to place, so the panel says so in
 *  one plain line rather than offering an add button that would upload work the site has
 *  nowhere to show (Sam, 2026-08-13). ONE wording for all three so the empty panels read
 *  identically. */
export function NoSlots({ noun }: { noun: string }) {
  return <p className="px-5 py-6 text-sm text-ink-muted">No {noun} slots on this site.</p>
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
