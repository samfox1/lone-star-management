/**
 * HOW AN ICON ANSWERS THE POINTER (Sam, 2026-10-02): "I dont want the edit icons to have the
 * grey box around them on hover. I want them to get black and bold. Goes with all icons." The
 * nav got this first (NAV_HOVER below builds on it); every icon button in the dashboard now does
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
 * A WORD that answers the pointer gets a little bolder: a hairline shadow in its own colour, not
 * a heavier weight, because Space Mono has only 400 and 700 and a real weight change would widen
 * the word and nudge what sits beside it. The nav's labels, the confirm dialog's answers and the
 * Publish bar's Revert.
 */
export const WORD_HOVER = 'hover:[text-shadow:0_0_0.45px_currentColor]'

/**
 * HOW A NAV ITEM ANSWERS THE POINTER (Sam, 2026-10-02): the icon and its words turn black and
 * get a little bolder; no grey box behind them ("i just want the icons and text to turn black",
 * then "have it get a little bolder too"). The top bar, the tools rail and its sub-tab panel,
 * the assets rail and the app shell's nav. It lived in the dashboard's route folder
 * (nav-hover.ts) until 2026-10-05, where the app shell could not reach it and spelled it out.
 */
export const NAV_HOVER = `${ICON_HOVER} ${WORD_HOVER}`

/**
 * EVERY EDIT PENCIL IS 14px (Sam, 2026-10-02: "these edit icons should be smaller across").
 * RowIcon draws every `edit` glyph at this size whatever the caller asks, and keeps its 32px box,
 * so the target under a finger does not shrink with the glyph. Pencils drawn outside RowIcon (the
 * modal rows, the editor's rows and tiles) use this constant too.
 */
export const EDIT_GLYPH = 14
