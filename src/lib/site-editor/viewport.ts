/**
 * The editor frame's VIEWPORT maths.
 *
 * The problem: the frame panel is only ~800-950px wide once the inspector takes
 * its share, so an iframe sized to fit renders the site at ~900px — which trips
 * the site's tablet breakpoints. The manager ends up editing a layout no desktop
 * visitor will ever see.
 *
 * The fix (what Webflow/Framer do): render the iframe at a REAL desktop width and
 * scale the whole thing down with a CSS transform. The site still believes it's in
 * a 1440px window — same breakpoints, same layout — it's just drawn smaller. The
 * height is divided by the same scale so the canvas fills the panel, giving a
 * plausible desktop window rather than a letterboxed strip.
 *
 * Pure functions, so the arithmetic is unit-testable without a DOM.
 */

/** Canvas width per device. 1440 is the standard desktop design width (and the
 *  usable width of a 15-16" laptop); 390 is the iPhone 14/15 logical width. */
export const CANVAS_WIDTH = { desktop: 1440, mobile: 390 } as const

export type Device = keyof typeof CANVAS_WIDTH

export type Viewport = {
  /** CSS pixel width to give the iframe — the width the SITE sees. */
  width: number
  /** CSS pixel height to give the iframe — the height the SITE sees. */
  height: number
  /** CSS transform scale to draw it at. */
  scale: number
  /** On-screen size after scaling (what the wrapper reserves). */
  renderedWidth: number
  renderedHeight: number
}

/**
 * Fit a device canvas into the available panel box.
 *
 * NEVER scales up past 1: a 390px mobile canvas in a 900px panel should stay
 * 390px (a phone doesn't get wider), and a desktop canvas in a huge panel should
 * render 1:1 rather than blow up to fuzzy 1.5x.
 */
export function fitViewport(device: Device, availableWidth: number, availableHeight: number): Viewport {
  const width = CANVAS_WIDTH[device]
  // Guard the first paint, before the ResizeObserver has measured anything: a 0
  // box would divide by zero and produce NaN styles.
  if (availableWidth <= 0 || availableHeight <= 0) {
    return { width, height: 0, scale: 1, renderedWidth: 0, renderedHeight: 0 }
  }
  const scale = Math.min(1, availableWidth / width)
  // Divide the height by the scale so that, once scaled, the canvas exactly fills
  // the panel's height — the site gets a taller viewport instead of being cropped.
  const height = availableHeight / scale
  return {
    width,
    height,
    scale,
    renderedWidth: width * scale,
    renderedHeight: availableHeight,
  }
}

/** Human-readable zoom for the frame's status chip. 1 → '100%'. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
