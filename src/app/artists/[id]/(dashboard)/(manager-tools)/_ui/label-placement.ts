/**
 * WHERE A HOVER LABEL GOES (Sam, 2026-09-23: the icon editor's "Upload new" label was cut
 * off by the modal body's top edge). Pure, so it is tested without a browser
 * (tests/unit/manager-tools/shared/label-placement.test.ts); HoverLabel (row-icon.tsx) feeds it real rects.
 *
 * The chip is `position: fixed`, so the answer is viewport coordinates. `side` and `align`
 * are PREFERENCES:
 *   - the room is the viewport ∩ the nearest clipping/scrolling ancestor's rect (a modal's
 *     scrolling middle), less a small margin: a chip drawn outside that box would sit over
 *     the header, or over whatever the box hides;
 *   - the preferred side if the chip fits there, else the other side if it fits there, else
 *     whichever side has more room;
 *   - aligned as asked, then shifted sideways to stay inside the room (and when it is wider
 *     than the room, pinned to the room's left edge);
 *   - `visible: false` when the anchor itself is entirely outside the room (scrolled away
 *     while focused): a chip pointing at nothing would float.
 */
export type Box = { top: number; left: number; right: number; bottom: number }
export type LabelSide = 'top' | 'bottom'
export type LabelAlign = 'center' | 'start' | 'end'
export type LabelPlacement = { side: LabelSide; top: number; left: number; visible: boolean }

/** Between the control and its chip — the prototype's 8px. */
export const LABEL_GAP = 8
/** The closest a chip comes to the edge of its room. */
export const LABEL_MARGIN = 4

export function placeLabel({
  anchor,
  size,
  viewport,
  clip = null,
  side,
  align,
}: {
  anchor: Box
  size: { width: number; height: number }
  viewport: { width: number; height: number }
  clip?: Box | null
  side: LabelSide
  align: LabelAlign
}): LabelPlacement {
  const room: Box = {
    top: Math.max(0, clip?.top ?? 0),
    left: Math.max(0, clip?.left ?? 0),
    right: Math.min(viewport.width, clip?.right ?? viewport.width),
    bottom: Math.min(viewport.height, clip?.bottom ?? viewport.height),
  }
  const visible = anchor.bottom > room.top && anchor.top < room.bottom && anchor.right > room.left && anchor.left < room.right

  const inner = { top: room.top + LABEL_MARGIN, left: room.left + LABEL_MARGIN, right: room.right - LABEL_MARGIN, bottom: room.bottom - LABEL_MARGIN }
  const above = anchor.top - LABEL_GAP - size.height
  const below = anchor.bottom + LABEL_GAP
  const fits: Record<LabelSide, boolean> = { top: above >= inner.top, bottom: below + size.height <= inner.bottom }
  const other: LabelSide = side === 'top' ? 'bottom' : 'top'
  const roomAbove = anchor.top - inner.top
  const roomBelow = inner.bottom - anchor.bottom
  const placed: LabelSide = fits[side] ? side : fits[other] ? other : roomAbove > roomBelow ? 'top' : 'bottom'

  let left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - size.width : (anchor.left + anchor.right - size.width) / 2
  if (left + size.width > inner.right) left = inner.right - size.width
  if (left < inner.left) left = inner.left

  return { side: placed, top: placed === 'top' ? above : below, left, visible }
}
