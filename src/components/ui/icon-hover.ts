/**
 * HOW AN ICON ANSWERS THE POINTER (Sam, 2026-10-02): "I dont want the edit icons to have the
 * grey box around them on hover. I want them to get black and bold. Goes with all icons." The
 * nav got this first (nav-hover.ts builds on it); every icon button in the dashboard now does
 * the same: the glyph turns ink and its stroke thickens. No background, no box.
 *
 * Bolder without moving anything: CSS `stroke-width` on the svg beats the attribute Icon draws
 * with (1.6), and a stroke grows in place, so nothing shifts. A filled glyph (plug, more, grip)
 * has no stroke and just turns ink. A disabled control does not answer (`not-disabled:`).
 *
 * A tone that MEANS something keeps its colour and still gets bolder: every + turns blue, a
 * trash or × turns red (RowIcon's TONE). Pair those with `ICON_BOLD`, not `ICON_HOVER`, so two
 * hover colours never sit in one class list.
 */

/** The stroke half alone: for an icon whose hover colour is its own (blue +, red trash). */
export const ICON_BOLD = 'not-disabled:hover:[&_svg]:[stroke-width:2.1]'

/** Ink and bold: the default for every icon button. */
export const ICON_HOVER = 'hover:text-ink not-disabled:hover:[&_svg]:[stroke-width:2.1]'

/** The same, for an icon that answers its parent's hover (`group`). */
export const ICON_GROUP_HOVER = 'group-hover:text-ink group-hover:[&_svg]:[stroke-width:2.1]'

/**
 * EVERY EDIT PENCIL IS 14px (Sam, 2026-10-02: "these edit icons should be smaller across").
 * RowIcon draws every `edit` glyph at this size whatever the caller asks, and keeps its 32px box,
 * so the target under a finger does not shrink with the glyph. Pencils drawn outside RowIcon (the
 * modal rows, the editor's rows and tiles) use this constant too.
 */
export const EDIT_GLYPH = 14
