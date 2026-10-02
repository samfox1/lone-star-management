/**
 * HOW A NAV ITEM ANSWERS THE POINTER (Sam, 2026-10-02): the icon and its words turn black and
 * get a little bolder; no grey box behind them ("i just want the icons and text to turn black",
 * then "have it get a little bolder too"). Used by the top bar, the tools rail and its sub-tab
 * panel, and the assets rail.
 *
 * Bolder without moving anything: the icon's stroke thickens (CSS stroke-width beats the SVG's
 * own attribute), and the text gets a hairline shadow in its own colour instead of a heavier
 * weight, because Space Mono has only 400 and 700 and a real weight change would widen the
 * label and nudge the rail.
 */
export const NAV_HOVER = 'hover:text-ink hover:[text-shadow:0_0_0.45px_currentColor] hover:[&_svg]:[stroke-width:2.1]'

/** The same, for an icon that answers its parent's hover (`group`). */
export const NAV_GROUP_HOVER = 'group-hover:text-ink group-hover:[&_svg]:[stroke-width:2.1]'
