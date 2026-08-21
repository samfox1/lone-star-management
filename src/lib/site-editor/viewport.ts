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

/**
 * Canvas width per device — the width the SITE believes it has.
 *
 * 1440 is the standard desktop design width (and the usable width of a 15-16" laptop);
 * 390 is the iPhone 12-15 logical width, the mainstream phone.
 *
 * ONE phone, on purpose (Sam, 2026-08-21: "Just have 1 mobile view for now"). A menu of
 * 375/390/430 briefly existed here: it is the right idea for a responsiveness pass, and a
 * distraction while the phone layout itself is still being shaped — three widths to check
 * after every change is three times the work to find the same problems. `isPhone` stays
 * because the mobile style twins should never key off ONE device name; when the extra
 * widths come back, nothing but this table needs to change.
 */
export const CANVAS_WIDTH = { desktop: 1440, mobile: 390 } as const

export type Device = keyof typeof CANVAS_WIDTH

/** Every phone-width canvas. The MOBILE-scope style controls (`--lse-*-m`) key off THIS,
 *  never off one device name: the day a second phone width returns, editing at 430 must
 *  write the same phone twin as 390, or a manager's phone edits would silently depend on
 *  which phone they happened to be previewing. */
const PHONES = new Set<Device>(['mobile'])

export function isPhone(device: Device): boolean {
  return PHONES.has(device)
}

/** What the device picker offers, in order. Derived from CANVAS_WIDTH so a device added
 *  above cannot be missing from the menu (AGENTS.md rule 4). */
export const DEVICE_OPTIONS: readonly { value: Device; label: string }[] = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' },
]

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
