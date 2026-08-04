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

/**
 * The editor's per-item vocabulary is applied as INLINE STYLE, not classes — not just
 * the colours. Two hard lessons forced this (2026-08-03, the "border slider does
 * nothing" bug):
 *
 *  1. A class the site's build didn't compile is silently inert, and every site has its
 *    own build — the safelist has to be replicated per site and redeployed in lockstep
 *    with the editor's vocabulary, and it WILL drift.
 *  2. Even a compiled class can lose: `border-4` (base) vs `border-[6px]` (overlay) both
 *    set border-width, and CSS resolves that by STYLESHEET order, which neither the
 *    manager nor the editor controls. Class-attribute order is irrelevant to CSS —
 *    "the overlay goes last" was never a real guarantee at this layer.
 *
 * Inline style loses both problems at once: it needs no build, and it beats any class
 * deterministically. Tokens the editor doesn't own (a site's own utilities) pass
 * through as classes untouched.
 */
export type ManagedStyleProp =
  | (typeof COLOR_PROPS)[keyof typeof COLOR_PROPS]
  | 'scale'
  | 'opacity'
  | 'borderWidth'
  | 'borderStyle'
  | 'borderRadius'
  | 'boxShadow'

/** The CSS properties this module may write, so a caller can clear exactly what it set
 *  without touching inline styles that belong to the site. */
export const MANAGED_STYLE_PROPS = [
  ...new Set(Object.values(COLOR_PROPS)),
  'scale',
  'opacity',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'boxShadow',
] as readonly ManagedStyleProp[]

/** Tailwind's shadow presets, inlined — the one place a preset VALUE lives. */
const SHADOWS: Record<string, string> = {
  'shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  'shadow-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  'shadow-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
}

/** One owned utility → the inline CSS it means, or null when the token isn't ours.
 *  Kept to exactly the tokens the item controls EMIT (style-controls) — anything else
 *  is site vocabulary and stays a class. */
function inlineToken(token: string): Partial<Record<ManagedStyleProp, string>> | null {
  let m = token.match(/^scale-(\d{1,3})$/)
  if (m) return { scale: String(Number(m[1]) / 100) }
  m = token.match(/^opacity-(\d{1,3})$/)
  if (m) return { opacity: String(Number(m[1]) / 100) }
  m = token.match(/^border-\[(\d{1,3})px\]$/)
  if (m) return { borderWidth: `${m[1]}px`, borderStyle: 'solid' }
  m = token.match(/^rounded-\[(\d{1,3})px\]$/)
  if (m) return { borderRadius: `${m[1]}px` }
  if (token === 'rounded-full') return { borderRadius: '9999px' }
  if (token in SHADOWS) return { boxShadow: SHADOWS[token] }
  return null
}

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

/** `speed-[<rate>x]` → the playback rate it sets, or null. Playback speed can never be
 *  CSS at all — like the colours above it rides the stored class string as a token the
 *  DOM consumer applies as a PROPERTY (`video.playbackRate`), so one stored string still
 *  describes the whole per-item look. The site must apply it too (skeen mirrors this). */
const SPEED_TOKEN_RE = /^speed-\[(\d+(?:\.\d+)?)x\]$/

/** What a media element will actually accept. Outside this WebKit throws
 *  NotSupportedError on assignment, and both consumers (applyStyleToDom here, skeen's
 *  mirror) set `video.playbackRate` unguarded — so an out-of-range token would not just
 *  misbehave, it would throw mid-apply and abandon the rest of the style update, leaving
 *  the element half-styled. Rejecting here instead means the token stays an inert class,
 *  exactly like any other malformed one. Comfortably wider than the panel's own range
 *  (0.25×–2×), so the product's vocabulary is never clipped. */
const SPEED_MIN = 0.0625
const SPEED_MAX = 16

export function speedToken(token: string): number | null {
  const m = token.match(SPEED_TOKEN_RE)
  if (!m) return null
  const rate = Number(m[1])
  if (!Number.isFinite(rate)) return null
  return rate >= SPEED_MIN && rate <= SPEED_MAX ? rate : null
}

/** The speed token for a playback rate — the write half of `speedToken`. */
export function speedClass(rate: number): string {
  return `speed-[${rate}x]`
}

/**
 * True when the key addresses ONE item rather than a whole section. Item strings are
 * overlays and merge onto the element's base classes; section strings replace them.
 *
 * The vocabulary is a RULE, not a fixed list: any `<kind>:<id>` is an item key. Today
 * that means `slot:<role>` for a named placement and `<assetType>:<id>` for a library
 * asset — `image:`, `video:`, `track:`, `merch:`, `tour_date:`, `link:` (see
 * `ASSET_TYPES` in ./markers). Sites emit their own subset: skeen emits `video:` for
 * video tiles, which older docs here didn't mention. A section key never contains a
 * colon, which is what makes the test cheap and open-ended.
 */
export function isItemKey(key: string): boolean {
  return key.includes(':')
}

export type ResolvedStyle = {
  /** The classes to put on the element. */
  className: string
  /** Inline CSS properties to set (colours Tailwind cannot compile). */
  style: Partial<Record<ManagedStyleProp, string>>
  /** Video playback rate (`speed-[1.5x]`), a DOM property rather than CSS. Undefined
   *  when the string carries no speed token — the consumer resets to 1. */
  playbackRate?: number
}

/** Split a class string into the classes a build can compile, the inline colours it
 *  can't, and the playback rate that isn't CSS at all. Later tokens win, matching
 *  CSS/class-attribute order. */
function resolveTokens(classString: string, liftAll: boolean): ResolvedStyle {
  const classes: string[] = []
  const style: Partial<Record<ManagedStyleProp, string>> = {}
  let playbackRate: number | undefined
  for (const token of classString.split(/\s+/).filter(Boolean)) {
    const color = colorToken(token)
    const speed = liftAll ? speedToken(token) : null
    const inline = color ? { [color.prop]: color.value } : liftAll ? inlineToken(token) : null
    if (inline) Object.assign(style, inline)
    else if (speed != null) playbackRate = speed
    else classes.push(token)
  }
  return { className: classes.join(' '), style, ...(playbackRate != null ? { playbackRate } : {}) }
}

/** Full lift — for a string the MANAGER authored (an item overlay). */
export function resolveStyle(classString: string): ResolvedStyle {
  return resolveTokens(classString, true)
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

/**
 * The whole pipeline: what a marked element's `class` and inline styles should become,
 * given its base classes and the manager's stored string for that key.
 *
 * PROVENANCE matters (review, 2026-08-03): the item-vocabulary lift applies ONLY to the
 * manager's overlay — never to the element's base classes, which belong to the site and
 * may legitimately carry `opacity-0`/`rounded-full`/variant pairs whose class semantics
 * (hover:, md:) inlining would destroy. Section strings lift colours only, matching
 * their pre-inline behavior: their vocabulary is site-compiled classes.
 *
 * KNOWN, ACCEPTED (skeen mirror diff, 2026-08-04): the protection stops at the overlay's
 * edge. WITHIN a manager's overlay a bare token still lifts even when the same overlay
 * also carries a variant of that property — `opacity-40 hover:opacity-100` inlines
 * opacity, and an inline value has no hover state, so the hover half is dead. Both sides
 * behave identically, so they agree. It is unreachable from the item panel, whose
 * controls emit bare tokens only; it can only be produced by hand-authoring an overlay.
 * Revisit if hand-authored overlays ever become a supported path.
 */
export function resolveRegionStyle(key: string, base: string, override: string): ResolvedStyle {
  if (!isItemKey(key)) return resolveTokens(mergeStyle(key, base, override), false)
  const ov = resolveTokens(override.trim(), true)
  const b = base.trim()
  const className = [b, ov.className].filter(Boolean).join(' ')
  return { className, style: ov.style, ...(ov.playbackRate != null ? { playbackRate: ov.playbackRate } : {}) }
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
