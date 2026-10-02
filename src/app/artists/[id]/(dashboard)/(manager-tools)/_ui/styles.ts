import { cx } from '@/lib/cx'
import { FOCUS_RING } from './focus-ring'

/**
 * THE MANAGER TOOLS' SHARED LOOK, BY ROLE (AGENTS.md, Sam 2026-10-01: "shared look lives in
 * `_ui/`"). Each constant is the exact class list its hand-written copies had, so swapping one
 * in changes no pixel. Before writing one of these by hand, use it: a copy drifts.
 *
 * The AI test's and the Profiles tab's rows and cards are ONE look (Batch 2, Sam 2026-10-02),
 * drawn by one component: _ui/disclosure.tsx (lifted from tools/seo/_ui when Settings › Email
 * became its second tool, Batch 3, 2026-10-02).
 */

/** The keyboard ring (focus-ring.ts, which says why it needs its own `outline-solid`), set
 *  2px off the control: icons, glyphs, quiet links. A control inside a field takes no offset. */
export const FOCUS_RING_OFFSET = cx(FOCUS_RING, 'focus-visible:outline-offset-2')

/**
 * AN EDIT PENCIL SHOWS ONLY WHEN IT IS NEEDED (Sam, 2026-10-02: "the edit button should only
 * show up when hovering over the text area … It should only show when needed, when the user
 * hovers over what they want to edit"). Every pencil in the dashboard, one rule:
 *
 *   EDIT_TARGET      on the thing the pencil edits: a ledger row, a modal's LABEL/value row, a
 *                    card's line, an editor row or tile. Ledger, KvRow, CardField and
 *                    CardActions already carry it.
 *   REVEAL_ON_HOVER  on the pencil (or a span around it). Invisible until the pointer is on its
 *                    target or on the pencil itself; shown while anything in the target has
 *                    keyboard focus; always shown on a touch screen, which has no hover.
 *
 * OPACITY ONLY: the pencil keeps its box at rest, so nothing moves when it appears. The caller
 * transitions opacity (RowIcon does), because two `transition-*` classes on one element fight.
 * RowIcon applies it to every `edit` glyph by default (`reveal`). Only pencils: +, ✓, ↗ and ×
 * keep their own look.
 *
 * Targets must not nest: `group-hover/edit` fires for ANY hovered ancestor target, so a pencil
 * inside a popover inside a ledger row would light with the whole row. The Brand font menu,
 * which opens inside its row, keys its rename pencil on its own item instead (font-menu.tsx).
 */
export const EDIT_TARGET = 'group/edit'
export const REVEAL_ON_HOVER =
  'opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover/edit:opacity-100 group-has-[:focus-visible]/edit:opacity-100 [@media(hover:none)]:opacity-100'

/** Small faint Space Mono: a count ("4 of 5"), "Saved as …", a row's small print. */
export const MONO_META = 'font-space text-[11px] text-ink-faint'

/**
 * THE MONO CAPS LADDER (Batch 2, Sam 2026-10-02, prototypes/batch2_compare_20261002.html §2):
 * three sizes, two letter-spacings. A LABEL names a thing (.10em); a VALUE in caps IS the thing
 * (.06em). These are size, case and spacing only: colour, weight and leading are the caller's
 * (cx joins classes, it doesn't resolve a clash, so a colour here would fight the caller's).
 *
 *            label · .10em                               value · .06em
 *   10px     CAPS_LABEL: a card row, a group, a table    CAPS_VALUE: a tag (OUTSIDE TAPIR),
 *            head, a tile's caption                      a font's category
 *   11px     CAPS_SECTION: the ledger's section word,    CAPS_META: a kind (BOOKING), a count,
 *            a block or form label                       a modal's meta
 *   26px     CAPS_TITLE: the AI test's title             —
 *
 * No 9px, no 10.5px, no third spacing: those were drift.
 */
export const CAPS_LABEL = 'font-space text-[10px] uppercase tracking-[0.1em]'
export const CAPS_VALUE = 'font-space text-[10px] uppercase tracking-[0.06em]'
export const CAPS_SECTION = 'font-space text-[11px] uppercase tracking-[0.1em]'
export const CAPS_META = 'font-space text-[11px] uppercase tracking-[0.06em]'
export const CAPS_TITLE = 'font-space text-[26px] uppercase tracking-[0.1em]'

/** The mono caps word over a block: "AI VISIBILITY TEST", a group's name. */
export const EYEBROW = cx(CAPS_LABEL, 'text-ink-faint')

/** A bold mono caps label over a form block (the press kit, the site page). */
export const BLOCK_LABEL = cx(CAPS_SECTION, 'font-bold text-ink-faint')

/** A refusal in red Space Mono, beside the thing it refuses. FieldError (field-error.tsx) is
 *  the same words in a block with its own snug leading. */
export const ERROR_TEXT = 'font-space text-[11px] text-accent-red'
