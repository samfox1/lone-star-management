/**
 * Turning a STORED class string into what the DOM actually needs.
 *
 * Two things stand between `site_styles.class_names` and a styled pixel, and both are
 * handled here so the editor frame and the site can't drift apart:
 *
 * 1. **An arbitrary colour can never be a class.** Tailwind compiles the utilities it can
 *    SEE in source; `border-[#123abc]` is chosen at runtime from a palette of 16.7M, so no
 *    build ever emits a rule for it and the class is inert. Safelisting is not an option at
 *    that cardinality. So colour tokens are pulled out of the class string and applied as
 *    INLINE style, which needs no build step. Every other token (`scale-110`, `border-[4px]`,
 *    `rounded-[6px]`) is drawn from a small fixed vocabulary and IS safelisted, so those stay
 *    classes.
 *
 * 2. **Section regions REPLACE, per-item overlays ADD.** A section's stored string is the
 *    whole class list (the editor seeds its textarea with the base and the manager edits it,
 *    SITE_STYLING_PLAN.md D-B). A per-item string is only the manager's overlay — the item
 *    editor starts EMPTY and emits `scale-110 rounded-[6px]`, which must augment the image's
 *    own layout classes rather than erase them. The two are told apart by the key shape,
 *    which is already the storage contract (D-E): a per-item key carries a colon
 *    (`slot:polaroid_1_photo`, `image:<uuid>`), a section key never does.
 *
 * Pure string logic, no DOM and no React: the frame bridge, the editor's own preview and
 * the site all route through it, and it is unit-tested directly.
 */
import { canonicalHex } from '@/lib/color'
import type { SiteStyleOptions } from '@/lib/site-editor/style-controls'

/** Arbitrary-value colour utilities the editor can produce → the CSS property each sets.
 *  Only these prefixes are lifted; `border-[4px]` (a width) stays a class because it is a
 *  length, not a colour, and the safelist covers it. */
const COLOR_PROPS = {
  border: 'borderColor',
  text: 'color',
  bg: 'backgroundColor',
} as const

export type ManagedStyleProp = (typeof COLOR_PROPS)[keyof typeof COLOR_PROPS]

/** The CSS properties this module may write, so a caller can clear exactly what it set
 *  without touching inline styles that belong to the site. */
export const MANAGED_STYLE_PROPS = [...new Set(Object.values(COLOR_PROPS))] as readonly ManagedStyleProp[]

/** The ONE spelling of the arbitrary-colour token grammar. Everything that reads or
 *  writes these tokens (`owns` in style-controls, the item editor's constructor) goes
 *  through `colorToken`/`colorClass` rather than re-spelling the regex. */
const COLOR_TOKEN_RE = /^([a-z]+)-\[(#[0-9a-fA-F]{3,8})\]$/

/** `<prefix>-[#hex]` → its CSS property, or null if the token isn't an arbitrary colour. */
export function colorToken(token: string): { prop: ManagedStyleProp; value: string } | null {
  const m = token.match(COLOR_TOKEN_RE)
  if (!m) return null
  const prop = COLOR_PROPS[m[1] as keyof typeof COLOR_PROPS]
  return prop ? { prop, value: m[2] } : null
}

/** The arbitrary-colour utility for a prefix — the write half of `colorToken`. */
export function colorClass(prefix: keyof typeof COLOR_PROPS, hex: string): string {
  return `${prefix}-[${hex}]`
}

/** True when the key addresses ONE item inside a slot rather than a whole section — the
 *  colon convention from D-E. Item strings are overlays and merge onto the element's base
 *  classes; section strings replace them. */
export function isItemKey(key: string): boolean {
  return key.includes(':')
}

export type ResolvedStyle = {
  /** The classes to put on the element. */
  className: string
  /** Inline CSS properties to set (colours Tailwind cannot compile). */
  style: Partial<Record<ManagedStyleProp, string>>
}

/** Split a class string into the classes a build can compile and the inline colours it
 *  can't. Later tokens win, matching CSS/class-attribute order. */
export function resolveStyle(classString: string): ResolvedStyle {
  const classes: string[] = []
  const style: Partial<Record<ManagedStyleProp, string>> = {}
  for (const token of classString.split(/\s+/).filter(Boolean)) {
    const color = colorToken(token)
    if (color) style[color.prop] = color.value
    else classes.push(token)
  }
  return { className: classes.join(' '), style }
}

/**
 * The final class string for a region: an item overlay merged onto the element's base
 * classes, or a section override replacing them. A blank override always falls back to the
 * base, which is what makes "clear the field to restore the original" work for both.
 *
 * The overlay goes LAST so it wins on equal specificity — that is the whole point of an
 * overlay, and it is why the item editor can round a square image.
 */
export function mergeStyle(key: string, base: string, override: string): string {
  if (!override.trim()) return base
  if (!isItemKey(key)) return override
  return base.trim() ? `${base.trim()} ${override.trim()}` : override.trim()
}

/** The whole pipeline: what a marked element's `class` and inline colours should become,
 *  given its base classes and the manager's stored string for that key. */
export function resolveRegionStyle(key: string, base: string, override: string): ResolvedStyle {
  return resolveStyle(mergeStyle(key, base, override))
}

/**
 * The site's OWN declared colours, as hexes.
 *
 * A site declares its palette as classes (`text-flash-1`) because those are what its
 * build compiles — but a class name says nothing about what colour it is, so the editor
 * can only offer them as swatches if the site also declares the hex. Sites that don't
 * contribute nothing here rather than guesses.
 */
function paletteColors(options?: SiteStyleOptions): string[] {
  const out: string[] = []
  for (const opt of [...(options?.textColors ?? []), ...(options?.bgColors ?? [])]) {
    const hex = canonicalHex(opt.hex ?? '')
    if (hex && !out.includes(hex)) out.push(hex)
  }
  return out
}

/**
 * The swatch row the colour picker offers: the site's declared palette FIRST, then any
 * other colour already used in its saved styles.
 *
 * Palette first because those are the site's canonical colours — the ones a manager
 * should be reaching for to stay in sync. The used-elsewhere colours follow so a one-off
 * that isn't in the palette is still one click away on the next item.
 */
export function siteSwatches(
  options: SiteStyleOptions | undefined,
  styleValues: Record<string, string>,
  limit = 14,
): string[] {
  const palette = paletteColors(options)
  const extras = usedColors(styleValues, limit).filter((hex) => !palette.includes(hex))
  return [...palette, ...extras].slice(0, limit)
}

/**
 * Every colour already in use across the site's saved styles, most-used first.
 *
 * A palette of 16.7M is precise but not consistent: matching the border you put on one
 * photo three sections ago means remembering its hex. This reads the colours back out of
 * what's already stored, so the editor can offer them as one-click swatches and the site
 * stays in sync with itself.
 *
 * `#FFF` and `#ffffff` are the same colour and collapse to one entry (canonicalised to
 * the long form). Ties keep first-seen order, so the list is stable between renders.
 */
export function usedColors(styleValues: Record<string, string>, limit = 12): string[] {
  const counts = new Map<string, { count: number; order: number }>()
  let seen = 0
  for (const classString of Object.values(styleValues)) {
    for (const token of (classString ?? '').split(/\s+/).filter(Boolean)) {
      const color = colorToken(token)
      if (!color) continue
      const hex = canonicalHex(color.value)
      if (!hex) continue
      const entry = counts.get(hex)
      if (entry) entry.count++
      else counts.set(hex, { count: 1, order: seen++ })
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .slice(0, limit)
    .map(([hex]) => hex)
}
