/**
 * Colour conversion for the editor's palette picker.
 *
 * A picked colour is STORED as a hex string (it ends up in an arbitrary Tailwind value,
 * `border-[#rrggbb]`), but a palette is navigated in HSV: hue on a rainbow slider, then
 * saturation × brightness on a square. So the picker converts both ways on every drag,
 * and the round trip has to be stable — otherwise dragging vertically would drift the
 * hue as the value bounced through rgb and back.
 *
 * Pure functions, no React: the picker's geometry and its maths are unit-tested without
 * a DOM (jsdom gives every element a zero-sized rect, so anything that depends on
 * measuring an element cannot be tested through the component).
 */

/** Hue in degrees [0,360), saturation and value in [0,1]. */
export type Hsv = { h: number; s: number; v: number }

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/**
 * A typed colour normalised to lowercase `#rgb` / `#rrggbb` / `#rrggbbaa`, or '' if it
 * isn't a hex. A missing `#` is forgiven — people paste bare hexes constantly, and
 * rejecting them reads as the field being broken.
 */
export function normalizeHex(v: string): string {
  let s = v.trim()
  if (!s) return ''
  if (!s.startsWith('#')) s = '#' + s
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ? s.toLowerCase() : ''
}

/** Expand `#rgb` to `#rrggbb`; pass 6/8-digit through. '' for anything else — so `#FFF`
 *  and `#ffffff` compare and de-duplicate as one colour. */
export function canonicalHex(v: string): string {
  const hex = normalizeHex(v)
  if (!hex) return ''
  if (hex.length === 4) return '#' + [...hex.slice(1)].map((c) => c + c).join('')
  return hex
}

/** `#rrggbb`(`aa`) → HSV, or null if it isn't a hex. Any alpha is dropped: the palette
 *  picks a colour, and the item's transparency is a separate control. */
export function hexToHsv(v: string): Hsv | null {
  const hex = canonicalHex(v)
  if (!hex) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  // Grey (d === 0) has no hue. Reporting 0 would silently snap the hue slider to red
  // every time the manager dragged brightness to black, so the caller keeps its own hue
  // and only takes this one when the colour actually has one.
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** HSV → `#rrggbb`. Out-of-range inputs are clamped (hue wraps) rather than rejected —
 *  a drag past the edge of the square should pin, not produce garbage. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 1)
  const val = clamp(v, 0, 1)
  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  const i = Math.floor(hue / 60) % 6
  let r = 0
  let g = 0
  let b = 0
  if (i === 0) {
    r = c
    g = x
  } else if (i === 1) {
    r = x
    g = c
  } else if (i === 2) {
    g = c
    b = x
  } else if (i === 3) {
    g = x
    b = c
  } else if (i === 4) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const byte = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/** Fully-saturated, full-brightness hex for a hue — the base colour the saturation ×
 *  brightness square is painted over. */
export function hueHex(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 })
}

/** Where a pointer landed inside a track/area, as a 0→1 fraction. `size <= 0` (jsdom, or
 *  a hidden element) yields 0 rather than NaN, so a stray event can't write a broken colour. */
export function fractionAt(client: number, start: number, size: number): number {
  if (size <= 0) return 0
  return clamp((client - start) / size, 0, 1)
}

/** Black or white, whichever stays visible on `hex` — used for the drag handle's ring so
 *  it doesn't vanish at either end of the brightness axis. Rec. 601 luma. */
export function contrastInk(hex: string): '#000000' | '#ffffff' {
  const full = canonicalHex(hex)
  if (!full) return '#000000'
  const r = parseInt(full.slice(1, 3), 16)
  const g = parseInt(full.slice(3, 5), 16)
  const b = parseInt(full.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#000000' : '#ffffff'
}
