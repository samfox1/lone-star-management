import { ICON_GROUP_HOVER, ICON_HOVER } from '@/components/ui/icon-hover'

/**
 * HOW A NAV ITEM ANSWERS THE POINTER (Sam, 2026-10-02): the icon and its words turn black and
 * get a little bolder; no grey box behind them ("i just want the icons and text to turn black",
 * then "have it get a little bolder too"). Used by the top bar, the tools rail and its sub-tab
 * panel, and the assets rail.
 *
 * The icon half is every icon button's rule (ICON_HOVER, components/ui/icon-hover.ts: Sam later
 * the same day, "Goes with all icons"). The words get a hairline shadow in their own colour
 * instead of a heavier weight, because Space Mono has only 400 and 700 and a real weight change
 * would widen the label and nudge the rail.
 */
export const NAV_HOVER = `${ICON_HOVER} hover:[text-shadow:0_0_0.45px_currentColor]`

/** The same, for an icon that answers its parent's hover (`group`). */
export const NAV_GROUP_HOVER = ICON_GROUP_HOVER
