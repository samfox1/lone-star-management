import { cx } from '@/lib/cx'
import { FOCUS_RING } from './focus-ring'

/**
 * THE MANAGER TOOLS' SHARED LOOK, BY ROLE (AGENTS.md, Sam 2026-10-01: "shared look lives in
 * `_ui/`"). Each constant is the exact class list its hand-written copies had, so swapping one
 * in changes no pixel. Before writing one of these by hand, use it: a copy drifts.
 *
 * A look that only LOOKS shared is not here: the AI test's card (12px radius, 20px padding)
 * and the Profiles card (14px, 24px) are different boxes, each kept by its own component
 * (tools/seo/_ui/disclosure.tsx, tools/seo/profiles/_ui/profile-row.tsx).
 */

/** The keyboard ring (focus-ring.ts, which says why it needs its own `outline-solid`), set
 *  2px off the control: icons, glyphs, quiet links. A control inside a field takes no offset. */
export const FOCUS_RING_OFFSET = cx(FOCUS_RING, 'focus-visible:outline-offset-2')

/** Small faint Space Mono: a count ("4 of 5"), "Saved as …", a row's small print. */
export const MONO_META = 'font-space text-[11px] text-ink-faint'

/** The mono caps word over a block: "AI VISIBILITY TEST", a group's name. */
export const EYEBROW = 'font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint'

/** A bold mono caps label over a form block (the press kit, the site page). */
export const BLOCK_LABEL = 'font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint'

/** A refusal in red Space Mono, beside the thing it refuses. FieldError (tools/seo/_ui/parts)
 *  is the same words in a block with its own snug leading. */
export const ERROR_TEXT = 'font-space text-[11px] text-accent-red'
