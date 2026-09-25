/**
 * BRAND — what the manager's Brand page publishes, as the CSS and `<head>` values a
 * connected site wears (BRAND_SYNC_PLAN, 2026-09-24; site-bridge 0.41.0).
 *
 *   brandColorCss(brand)              → `:root{--brand-<key>:#rrggbb;…}`
 *   brandFontCss(fonts, slots, opts)  → the Google stylesheet, `@font-face` per upload,
 *                                       `.font-<family>` per font, `--font-<slot>` vars
 *   brandCss(payload, opts)           → both, in the one order that works
 *   googleFontsHref(fonts)            → the css2 URL, for a site that links it itself
 *   brandHead(payload, opts)          → `{ themeColor, appleTouchIcon }` for metadata
 *
 * The one principle holds: the bridge supplies VALUES and the site owns presentation.
 * Nothing here says where Red goes. A site maps its own tokens onto the variables, with
 * its current value as the fallback (`--red: var(--brand-primary, #c63a2a)`), so an
 * unpublished brand — or a site on an older bridge — looks exactly as it does today.
 *
 * EVERY VALUE IS A CSS-INJECTION SINK. This output goes into a `<style>` on every page a
 * fan loads: a colour key becomes a property NAME, a hex a property VALUE, a Google family
 * a quoted string AND a URL, an upload's path the inside of `url('…')`. lone-star
 * validates all of them on the way in, and "the other side promised" is not a boundary —
 * a script, a migration or an older writer arrives looking exactly like a good publish.
 * So every check is an ALLOWLIST, re-run here, and a value that fails is DROPPED, never
 * escaped or repaired: a colour we cannot name safely is not worth painting.
 *
 * Pure: no DOM, no fetch, no clock. Server components call it.
 */
import { FONT_SLOTS, type FontSlot, type FontSlotMap, type PublicSitePayload, type SiteBrand, type SiteFont, type WireMedia } from './payload'

/* ── The allowlists ───────────────────────────────────────────────────────── */

/** A brand colour key, exactly the door's shape (and the DB check's): lowercase words
 *  joined by single hyphens. It becomes `--brand-<key>`, so it must never hold anything
 *  that could end the property name. */
const COLOR_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** The door's ceiling: `brand_colors_key_format`. */
const MAX_COLOR_KEY = 40
/** `#rrggbb` and nothing else. Case-insensitive in, lowercase out. JS `$` has no
 *  "before a final newline" exception without the `m` flag, so `#c63a2a\n` fails. */
const HEX = /^#[0-9a-f]{6}$/i

/** lone-star's `sanitizeFamily` output, restated: lowercase alphanumeric groups joined by
 *  single hyphens — nothing that could close a quote or a selector. */
const FAMILY = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_FAMILY = 32

/**
 * Family tokens that must never become a `.font-<family>` class. lone-star refuses them at
 * upload and bumps them in its own emitter; this is the site-side gate for a row that got
 * past both.
 *   • Each slot's own class (`font-primary`, `font-custom-1`): a font called "Primary"
 *     would otherwise take over every region pointed at the primary SLOT. Derived from
 *     FONT_SLOTS, so a sixth slot is reserved in the same edit.
 *   • Tailwind's font utilities: `.font-bold{font-family:…}` restyles every bold word.
 */
const RESERVED_FAMILIES = new Set<string>([
  ...FONT_SLOTS.map(slotToken),
  'sans', 'serif', 'mono',
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
])

/**
 * A Google Fonts family name: words of ASCII letters and digits, one space between.
 * Every family on fonts.google.com fits ("Archivo", "Noto Sans JP", "M PLUS 1p"), and the
 * shape leaves nothing to escape — no quote for the CSS string, no `&` `:` `%` or `@` for
 * the URL, no leading/trailing/double space to make two spellings of one family.
 */
const GOOGLE_FAMILY = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/
const MAX_GOOGLE_FAMILY = 64

/** Storage paths we will build a URL from: plain from the first character, so there is
 *  nothing to escape. No quote, paren, space or backslash can appear. */
const PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const MAX_PATH = 200

/** A bare http(s) origin (an optional port, no path). It is the site's own config, but
 *  it is interpolated into `url('…')` and a `<link href>` all the same. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/

/** The CSS `format()` keyword per stored format. A closed map doubles as the format
 *  allowlist: a format that is not a key drops the font. */
const FORMAT_HINT: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
}

/**
 * The weights requested for every Google family: all nine, as a DISCRETE list.
 *
 * Discrete because the css2 API answers `400` — the whole stylesheet, every family in it —
 * to a range (`wght@100..900`) on a family that is not variable, while a discrete list
 * naming weights a family lacks gets `200` and the weights it has (probed 2026-09-24:
 * Anton, Bebas Neue, Orbitron). All nine because the editor offers all nine
 * (`font-thin` … `font-black`) and skeen's Archivo is set at 700–900; the browser only
 * downloads the files a page actually uses. Upright only, which is what every site loads
 * today — an italic falls back to the browser's slant, as it does now.
 */
export const GOOGLE_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

const GOOGLE_CSS = 'https://fonts.googleapis.com/css2'

/* ── Small readers ────────────────────────────────────────────────────────── */

/** `custom_1` → `custom-1`: the variable and the class are CSS, so they wear kebab. */
function slotToken(slot: FontSlot): string {
  return slot.replace(/_/g, '-')
}

/** A `#rrggbb` hex, lowercased, or null. */
function hexOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && HEX.test(raw) ? raw.toLowerCase() : null
}

function safeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const base = raw.replace(/\/+$/, '')
  return ORIGIN.test(base) ? base : null
}

function safePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_PATH || !PATH.test(raw)) return null
  // PATH allows dots, so a `..` segment needs its own check: it would read another
  // artist's folder.
  return raw.split('/').includes('..') ? null : raw
}

function publicObject(origin: string, bucket: 'fonts' | 'media', path: string): string {
  return `${origin}/storage/v1/object/public/${bucket}/${path}`
}

/* ── Colours ──────────────────────────────────────────────────────────────── */

/**
 * `:root{--brand-primary:#c63a2a;--brand-secondary:#8dbfd5;…}` — one variable per
 * published colour, in the manager's order. `''` when there is nothing to emit, so a
 * site with no published brand keeps its own values untouched.
 *
 * The colour's `name` is the manager's label and never reaches CSS. A duplicated key keeps
 * its FIRST row: two declarations of one variable is legal CSS where the later silently
 * wins, which would present as "the colour is wrong" with nothing to point at.
 */
export function brandColorCss(brand: SiteBrand | null | undefined): string {
  const colors = brand?.colors
  if (!Array.isArray(colors)) return ''
  const seen = new Set<string>()
  const decls: string[] = []
  for (const c of colors as unknown[]) {
    if (!c) continue // a primitive destructures to undefined fields and fails below
    const { key, hex } = c as { key?: unknown; hex?: unknown }
    if (typeof key !== 'string' || key.length > MAX_COLOR_KEY || !COLOR_KEY.test(key)) continue
    const value = hexOrNull(hex)
    if (!value || seen.has(key)) continue
    seen.add(key)
    decls.push(`--brand-${key}:${value}`)
  }
  return decls.length ? `:root{${decls.join(';')}}` : ''
}

/* ── Fonts ────────────────────────────────────────────────────────────────── */

/** A font that passed every gate: its class token, the name the variables point at, and
 *  either an `@font-face` source (upload) or a Google family. */
type ReadyFont =
  | { token: string; kind: 'upload'; name: string; url: string; hint: string }
  | { token: string; kind: 'google'; name: string }

/** Validate one payload font, or null. Unknown `source` values are dropped rather than
 *  guessed at — a future source (say, a foundry CDN) is simply invisible to this version. */
function readyFont(raw: unknown, origin: string | null): ReadyFont | null {
  if (!raw) return null // a primitive has no `family` and fails the next check
  const f = raw as Partial<Record<keyof SiteFont, unknown>>
  const token = f.family
  if (typeof token !== 'string' || token.length > MAX_FAMILY || !FAMILY.test(token) || RESERVED_FAMILIES.has(token)) {
    return null
  }
  const source = f.source ?? 'upload' // every font published before 0.41 is an upload
  if (source === 'google') {
    const name = f.google_family
    if (typeof name !== 'string' || name.length > MAX_GOOGLE_FAMILY || !GOOGLE_FAMILY.test(name)) return null
    return { token, kind: 'google', name }
  }
  if (source !== 'upload' || !origin) return null
  const path = safePath(f.path)
  const hint = typeof f.format === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_HINT, f.format) ? FORMAT_HINT[f.format] : null
  if (!path || !hint) return null
  return { token, kind: 'upload', name: token, url: publicObject(origin, 'fonts', path), hint }
}

/** Every font that passed, sorted by token (byte-stable output, whatever order the door
 *  aggregated them in), the FIRST row kept when two share a token. */
function readyFonts(fonts: readonly SiteFont[] | null | undefined, origin: string | null): ReadyFont[] {
  if (!Array.isArray(fonts)) return []
  const seen = new Set<string>()
  const out: ReadyFont[] = []
  for (const raw of fonts as unknown[]) {
    const f = readyFont(raw, origin)
    if (!f || seen.has(f.token)) continue
    seen.add(f.token)
    out.push(f)
  }
  // Tokens are unique by now, so no two compare equal: code-unit order, never locale.
  return out.sort((a, b) => (a.token < b.token ? -1 : 1))
}

function hrefFor(ready: readonly ReadyFont[], selfHosted: readonly string[] | undefined): string | null {
  const skip = new Set(Array.isArray(selfHosted) ? selfHosted : [])
  const names: string[] = []
  for (const f of ready) if (f.kind === 'google' && !skip.has(f.name) && !names.includes(f.name)) names.push(f.name)
  if (!names.length) return null
  const weights = GOOGLE_FONT_WEIGHTS.join(';')
  // GOOGLE_FAMILY leaves only letters, digits and single spaces, so encoding a family
  // is exactly "space → +" — Google's own spelling of it.
  const families = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:wght@${weights}`)
  return `${GOOGLE_CSS}?${families.join('&')}&display=swap`
}

/**
 * The Google Fonts stylesheet URL for every Google-sourced font, in ONE css2 request, or
 * null when there are none. For a site that prefers `<link rel="stylesheet">` (and a
 * preconnect) over the `@import` `brandFontCss` leads with — pass `googleImport: false`
 * there so the sheet is not requested twice. `selfHosted` as in `BrandCssOptions`.
 */
export function googleFontsHref(
  fonts: readonly SiteFont[] | null | undefined,
  opts: { selfHosted?: readonly string[] } = {},
): string | null {
  // Uploads play no part in the URL, so no origin is needed to read them.
  return hrefFor(readyFonts(fonts, null), opts.selfHosted)
}

export type BrandCssOptions = {
  /** `https://<project>.supabase.co` — an upload's file is served from its public
   *  `fonts` bucket, the home icon from `media`. Not a bare origin → uploads are dropped. */
  supabaseUrl: string
  /** Lead the CSS with `@import url('<googleFontsHref>')`. Default true, so one `<style>`
   *  is the whole job; false when the site links the stylesheet itself. */
  googleImport?: boolean
  /**
   * Google families the site ALREADY serves itself, in Google's spelling (`'Archivo'`,
   * `'Bebas Neue'`). They are left out of the css2 request; their class and slot variable
   * are still emitted, and point at the site's own face.
   *
   * Needed with next/font: it names its faces by the plain family, so Google's sheet —
   * later in the document, same family, same descriptors — would take over the site's own
   * files (skeen, 2026-09-24: a third-party request and a font swap on every page, for a
   * face the page already had).
   */
  selfHosted?: readonly string[]
}

/**
 * The font stylesheet, uploads and Google fonts alike:
 *
 *   1. `@import url('https://fonts.googleapis.com/css2?…')` when any font is Google's —
 *      FIRST, because an `@import` after any other rule is ignored by every browser.
 *   2. Per font, sorted by family: an `@font-face` (uploads only — Google's stylesheet
 *      declares its own faces) and the `.font-<family>` utility the editor's per-region
 *      font tokens resolve against.
 *   3. `:root{--font-primary:'…',sans-serif;…}` for every assigned slot whose font
 *      survived, in FONT_SLOTS order. A variable pointing at a dropped
 *      face would send the browser hunting for a family nothing defines, and look
 *      deliberate.
 *
 * An upload is named by its token (`'sorg'`), exactly as before 0.41. A Google font is
 * named by its REAL family (`'Archivo'`), because that is what Google's `@font-face`
 * declares — the variables and the class point there, the class is still `.font-archivo`.
 *
 * Variables, never element rules: a custom site's headings carry their own font classes,
 * and a bare `h1{font-family}` loses to every one of them (skeen, lib/fonts.ts).
 */
export function brandFontCss(
  fonts: readonly SiteFont[] | null | undefined,
  slots: FontSlotMap | null | undefined,
  opts: BrandCssOptions,
): string {
  const ready = readyFonts(fonts, safeOrigin(opts.supabaseUrl))
  const parts: string[] = []
  const href = opts.googleImport === false ? null : hrefFor(ready, opts.selfHosted)
  if (href) parts.push(`@import url('${href}');`)
  for (const f of ready) {
    if (f.kind === 'upload') {
      parts.push(`@font-face{font-family:'${f.name}';src:url('${f.url}') format('${f.hint}');font-display:swap}`)
    }
    parts.push(`.font-${f.token}{font-family:'${f.name}',sans-serif}`)
  }

  // Only a token that SURVIVED maps to a name, so a slot at a dropped (or non-string)
  // value finds nothing and emits nothing.
  const byToken = new Map<unknown, string>(ready.map((f) => [f.token, f.name]))
  const map = (slots ?? {}) as Record<string, unknown>
  const vars: string[] = []
  for (const slot of FONT_SLOTS) {
    const name = byToken.get(map[slot])
    // A generic fallback, as the class has: without one, a region set to the slot shows the
    // browser's default SERIF while the face loads (display=swap) or if it never does.
    if (name) vars.push(`--font-${slotToken(slot)}:'${name}',sans-serif`)
  }
  if (vars.length) parts.push(`:root{${vars.join(';')}}`)
  return parts.join('')
}

type BrandSource = Partial<Pick<PublicSitePayload, 'brand' | 'fonts' | 'font_slots' | 'media'>>

/**
 * Everything the Brand page puts in a stylesheet, in the one order that works: fonts
 * (whose `@import` must be the first rule) then colours. What a site renders as a single
 * `<style>` — late in the document, after its own stylesheets, so the `:root` variables
 * win their tie with the site's defaults by order (skeen's SiteBody does exactly this).
 */
export function brandCss(payload: BrandSource | null | undefined, opts: BrandCssOptions): string {
  if (!payload) return ''
  return brandFontCss(payload.fonts, payload.font_slots, opts) + brandColorCss(payload.brand)
}

/* ── Head ─────────────────────────────────────────────────────────────────── */

export type BrandHead = {
  /** `#rrggbb` for `<meta name="theme-color">` (Next: `viewport.themeColor`), or null
   *  — keep the site's own. */
  themeColor: string | null
  /** Absolute URL for `<link rel="apple-touch-icon">` (Next: `metadata.icons.apple`):
   *  the published 180px `home_icon`, else the `favicon`, else null. */
  appleTouchIcon: string | null
}

function iconPath(media: readonly WireMedia[] | null | undefined, purpose: 'home_icon' | 'favicon'): string | null {
  if (!Array.isArray(media)) return null
  for (const m of media) {
    if (m?.purpose !== purpose) continue
    const path = safePath(m.path)
    if (path) return path
  }
  return null
}

/**
 * The `<head>` values the Brand page publishes. The bridge never writes a site's head; it
 * hands back values for `generateMetadata` / `generateViewport`.
 *
 * The home-screen icon prefers the generated `home_icon` (180px, framed for iOS) and falls
 * back to the `favicon`, which is at least the artist's own mark — never a logo or an
 * `icon_source`, which were not framed for a square. A row whose path fails the check is
 * skipped, so a bad home icon falls back rather than shipping.
 */
export function brandHead(payload: BrandSource | null | undefined, opts: { supabaseUrl: string }): BrandHead {
  const themeColor = hexOrNull(payload?.brand?.theme_color)
  const origin = safeOrigin(opts.supabaseUrl)
  const path = iconPath(payload?.media, 'home_icon') ?? iconPath(payload?.media, 'favicon')
  return { themeColor, appleTouchIcon: origin && path ? publicObject(origin, 'media', path) : null }
}
