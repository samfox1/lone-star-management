/**
 * NO-CODE style controls (SITE_STYLING_PLAN.md — friendly styling).
 *
 * A style region stores a full Tailwind class string (site_styles.class_names, REPLACE
 * semantics). Editing that raw string is not something a non-technical manager can do —
 * so the editor renders a fixed set of FRIENDLY controls (size, boldness, font, color,
 * alignment, uppercase, italic) over it. Each control OWNS a slice of the class string:
 * reading finds the current utility, applying swaps it while PRESERVING every class the
 * controls don't own (layout, z-index, spacing, …).
 *
 * The vocabulary is intentionally small and standard. Because Tailwind v4 only compiles
 * classes it sees, the SITE must safelist this vocabulary (and declare its own colours /
 * fonts via the manifest) — otherwise an applied class has no CSS and silently no-ops.
 *
 * Pure string logic, no React — so it's unit-testable and importable server-side.
 */
import { colorClass, colorToken } from '@/lib/site-editor/style-apply'

// MOVED to @samfox1/site-bridge (they ride the manifest — a site declares its palette
// through them). Re-exported from their historical home; imported for local use.
export type { StyleOption, SiteStyleOptions } from '@samfox1/site-bridge/manifest'
import type { ManifestStyleRegion, StyleOption, SiteStyleOptions } from '@samfox1/site-bridge/manifest'
import { TEXT_SIZES } from '@samfox1/site-bridge/styles'
// The option TABLES live in the package's vocabulary module (2026-08-07 deepening):
// they generate tokens.css, which is append-only contract, so the vocabulary lives
// beside the sheet it produces. This module adds the editor machinery on top.
import {
  ALIGN_OPTIONS,
  BORDER_WIDTH_STEPS,
  CASE_TOGGLE_CLASS,
  ITALIC_TOGGLE_CLASS,
  LEADING_OPTIONS,
  OPACITY_STEPS,
  GRAYSCALE_STEPS,
  SEPIA_STEPS,
  BRIGHTNESS_STEPS,
  CONTRAST_STEPS,
  SATURATE_STEPS,
  BLUR_STEPS,
  TILT_STEPS,
  FIT_STEPS,
  FIT_POSITIONS,
  TEXT_SHADOW_STEPS,
  TEXT_GLOW_STEPS,
  UNDERLINE_TOGGLE,
  STRIKE_TOGGLE,
  SHAPE_STEPS,
  FEATHER_STEPS,
  FROST_STEPS,
  PAD_STEPS,
  DECO_THICKNESS_STEPS,
  DECO_OFFSET_STEPS,
  // ENTRANCE_OPTIONS, ENTRANCE_SPEED_STEPS, ENTRANCE_TRAVEL_STEPS — ENTRANCES PAUSED
  // (2026-08-12), see motionControls().
  HOVER_OPTIONS,
  TEXT_STROKE_STEPS,
  RADIUS_STEPS,
  SCALE_STEPS,
  SHADOW_STEPS,
  TRACKING_OPTIONS,
  WEIGHT_OPTIONS,
} from '@samfox1/site-bridge/vocabulary'

export type StyleControl =
  | { id: string; label: string; kind: 'select'; options: StyleOption[]; owns: (token: string) => boolean; impliesLine?: boolean }
  | { id: string; label: string; kind: 'toggle'; onClass: string; owns: (token: string) => boolean; impliesLine?: boolean }
  /** A hex picker. The plain form (border colour) is special-cased where it renders; a
   *  control that sets `hexOf`/`toToken` is GENERIC — the row reads the current hex out
   *  of the class string and writes a whole replacement token, which lets two pickers
   *  share one token (a gradient's ends). '' from the picker clears the token. */
  | {
      id: string
      label: string
      kind: 'color'
      owns: (token: string) => boolean
      hexOf?: (classString: string) => string
      toToken?: (hex: string, classString: string) => string
      /** A decoration DRESSING: writing a value also switches a line on if none is set
       *  (see applyStyleValue). Declared at the control's definition, not inferred from
       *  its tokens, so a new dressing can't miss the rule. */
      impliesLine?: boolean
    }
  /** A slider over ORDERED steps (size, transparency). Reads/applies exactly like a select —
   *  one owned utility swapped, the rest preserved — but the manager drags a continuous scale
   *  instead of picking from a menu. `steps` runs low→high; the `''` step is the default. */
  | {
      id: string
      label: string
      kind: 'slider'
      steps: StyleOption[]
      /**
       * The `''` step is NOT a point on this scale — it means "whatever the site already
       * uses", which is an unknown size, not the smallest one. True for text size and
       * weight; false (default) for border/radius/shadow, where `''` genuinely IS the low
       * end (0px, square, no shadow), and for scale/opacity/speed, where it is the neutral
       * value sitting in the MIDDLE of the run.
       *
       * Getting this wrong in either direction is a live bug: leaving the default on an
       * ascending scale made dragging RIGHT shrink the text, and filtering it off a scale
       * that owns it deletes that scale's zero.
       */
      defaultOffScale?: boolean
      /**
       * MEASURE an owned token, so a value that is not one of the steps can still be
       * placed on the scale. Returns the token's magnitude in the scale's own unit (rem
       * for size, a ratio for line spacing, em for letter spacing, px, %) or null when the
       * value cannot be resolved to a number.
       *
       * Without this a slider had exactly two states — on a step, or "Default" resting at
       * the midpoint — and a site's OWN base classes are almost never on a step. skeen's
       * hero is `text-[clamp(4rem,18vw,11rem)]`, larger than any step we offer, so the
       * handle opened mid-scale and the first nudge right shrank an 11rem headline to
       * 2.25rem. See sliderIndex.
       */
      rank?: (token: string) => number | null
      owns: (token: string) => boolean
      /** See the color variant's note — a dressing slider (thickness, distance). */
      impliesLine?: boolean
    }
  /** A full colour palette (hue slider + saturation/brightness square + hex field). The owned
   *  utility is an arbitrary `border-[#hex]`, so the value is a free hex rather than one of a
   *  fixed option list — which is why this kind carries no `options`/`steps`. */


// Tailwind's fixed scales, used to tell text-* size from text-* colour from text-* align
// (all three share the `text-` prefix), and font-* weight from font-* family.
const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']
const WEIGHTS = ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black']
const ALIGNS = ['left', 'center', 'right', 'justify', 'start', 'end']

const textSuffix = (t: string) => (t.startsWith('text-') ? t.slice(5) : '')
/**
 * A font SIZE token: one of Tailwind's named steps, an arbitrary clamp() this slider
 * emits, or a plain arbitrary length a site wrote itself (skeen's captions are
 * `text-[12px]`). Must own all three — a site's existing size needs REPLACING when a new
 * one is picked, not left behind for source order to arbitrate.
 *
 * `text-[#ffffff]` shares the arbitrary shape and is a COLOUR, so the bracket case demands
 * a leading number-and-unit or a clamp. Getting that wrong would hand the size control a
 * colour to delete.
 */
export const isTextSize = (t: string) =>
  SIZES.includes(textSuffix(t)) ||
  // Any CSS length unit a site could size text with, not a favourites list: sites now
  // ADVERTISE their own scale, so a unit missing here means picking the next size fails
  // to remove the old one — two size classes on one element, source order deciding.
  /^text-\[(clamp\(|-?[\d.]+(r?em|px|v(w|h|min|max)|ch|ex|pt|%)[\])])/.test(t)
const fontSuffix = (t: string) => (t.startsWith('font-') ? t.slice(5) : '')

// FLUID sizes, not fixed ones. A `text-4xl` is 2.25rem at every width, so a caption
// sized against the desktop preview ran off the edge of a phone — which is exactly what
// happened to the polaroid captions.
//
// Each step is a clamp: the MAX is the old fixed size, so nothing already set moves on a
// laptop, and the MIN is roughly two-thirds of it, so the same choice simply has less to
// give on a narrow screen. The vw term in the middle scales continuously between them,
// which beats a breakpoint step: text does not jump at 768px, it just fits.
//
// The site's own hero already uses this idiom (`text-[clamp(4rem,18vw,11rem)]`), so this
// is its vocabulary, not one imposed on it.
//
// LABELS are the desktop px (the clamp's max), the number every other site editor shows
// for font size. The first pass used words ("Medium, XL, Large, Huge, Giant"), which read
// as random once the scale had 19 stops — words don't order.
//
// SAFELIST: like everything else here, the SITE must safelist these or Tailwind compiles
// nothing and the slider silently does nothing. See the header.
/**
 * The size ladder IS the package's TEXT_SIZES — one list, shared with every site
 * (skeen's textSizes.ts carried a character-identical copy until the 2026-08-07
 * extraction; tokens.css generates from the same source). The editor's SIZE_OPTIONS
 * name survives for its many readers below. The DISPLAY tail's reasoning (Sam,
 * 2026-08-05: "the header text needs to start at a bigger size") lives with the
 * ladder in @samfox1/site-bridge/styles.
 */
const SIZE_OPTIONS: StyleOption[] = TEXT_SIZES
/** Tailwind's named font sizes, in rem — the same numbers the fluid steps use as their
 *  MAX, which is what makes a legacy `text-4xl` land beside its clamp replacement. */
const SIZE_REM: Record<string, number> = {
  xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.25, '2xl': 1.5, '3xl': 1.875,
  '4xl': 2.25, '5xl': 3, '6xl': 3.75, '7xl': 4.5, '8xl': 6, '9xl': 8,
}

/** A font size in rem. A clamp is measured by its MAX — the desktop size, which is what
 *  the manager is looking at while they drag. */
function textSizeRank(t: string): number | null {
  const named = SIZE_REM[textSuffix(t)]
  if (named != null) return named
  const arb = /^text-\[(.+)\]$/.exec(t)
  if (!arb) return null
  const clamp = /^clamp\((.+)\)$/.exec(arb[1])
  if (clamp) {
    const parts = clamp[1].split(',')
    return lengthRem(parts[parts.length - 1])
  }
  return lengthRem(arb[1])
}

const LEADING_RATIO: Record<string, number> = {
  none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2,
}
/** A line-height RATIO. The `!` is stripped first: the site writes `leading-none`, this
 *  editor emits `!leading-none`, and they are the same 1.0 — treating them as different
 *  values is what put the handle at 1.1 on a region already sitting at 1.0. */
function leadingRank(t: string): number | null {
  const s = t.replace(/^!/, '')
  if (!s.startsWith('leading-')) return null
  const v = s.slice('leading-'.length)
  const arb = /^\[([\d.]+)\]$/.exec(v)
  if (arb) return Number(arb[1])
  return LEADING_RATIO[v] ?? null
}

const TRACKING_EM: Record<string, number> = {
  tighter: -0.05, tight: -0.025, normal: 0, wide: 0.025, wider: 0.05, widest: 0.1,
}
/** Letter spacing in em. */
function trackingRank(t: string): number | null {
  const s = t.replace(/^!/, '')
  if (!s.startsWith('tracking-')) return null
  const v = s.slice('tracking-'.length)
  const arb = /^\[(-?[\d.]+)em\]$/.exec(v)
  if (arb) return Number(arb[1])
  return TRACKING_EM[v] ?? null
}

/** A percentage scale (`scale-135`, `opacity-70`). The `''` step is 100% on both. */
const pctRank = (prefix: string) => (t: string): number | null => {
  if (t === '') return 100
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(t)
  return m ? Number(m[1]) : null
}
/** pctRank for the zero-resting families (B&W, sepia): their '' means 0%, not 100%.
 *  With the 100 default an untouched image RANKED as fully filtered — the thumb sat at
 *  the far end of a slider whose effect was off (found by the monotonicity invariant,
 *  2026-08-11). */
const pctRank0 = (prefix: string) => (t: string): number | null => {
  if (t === '') return 0
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(t)
  return m ? Number(m[1]) : null
}

const BORDER_PX: Record<string, number> = { border: 1, 'border-0': 0, 'border-2': 2, 'border-4': 4, 'border-8': 8 }
const RADIUS_PX: Record<string, number> = {
  'rounded-none': 0, 'rounded-sm': 2, rounded: 4, 'rounded-md': 6, 'rounded-lg': 8,
  'rounded-xl': 12, 'rounded-2xl': 16, 'rounded-3xl': 24,
  // Not a real px value — a pill. Ranked far above every other stop so nothing snaps to
  // it by accident, and so it stays the right-hand end of the scale.
  'rounded-full': 9999,
}
/** A px scale. `''` is the off/zero end for both border width and corner radius. */
const pxRank = (named: Record<string, number>) => (t: string): number | null => {
  if (t === '') return 0
  const arb = /-\[(-?\d+(?:\.\d+)?)px\]$/.exec(t)
  if (arb) return Number(arb[1])
  return named[t] ?? null
}

/** The padding slider must MEASURE a base's own Tailwind padding (`py-10` = 40px) and
 *  REPLACE it when a step is picked. Blind to those classes it started at "None" while
 *  the footer wore 40px, so the first drag right SHRANK the bar (Sam, 2026-08-12).
 *  `''` ranks null, not 0 — unset means "whatever the base wears", not zero. */
const TW_PAD_RE = /^p[trblxy]?-(\d+(?:\.\d+)?)$/
const padRank = (t: string): number | null => {
  if (t === '') return null
  const arb = /^pad-\[(\d+(?:\.\d+)?)px\]$/.exec(t)
  if (arb) return Number(arb[1])
  const tw = TW_PAD_RE.exec(t)
  return tw ? Number(tw[1]) * 4 : null
}
const ownsPad = (t: string) => t.startsWith('pad-[') || TW_PAD_RE.test(t)

// The centred dressing sliders: Auto sits mid-ladder and ranks like ~2px (a browser's
// usual auto thickness), so sub-pixel steps sort left of it and 3px+ right of it.
const thicknessRank = (t: string): number | null => (t === '' ? 2 : pxRank({})(t))

const SHADOW_RANK: Record<string, number> = {
  '': 0, 'shadow-none': 0, 'shadow-sm': 1, shadow: 2, 'shadow-md': 3,
  'shadow-lg': 4, 'shadow-xl': 5, 'shadow-2xl': 6,
}
const shadowRank = (t: string): number | null => SHADOW_RANK[t] ?? null

const DEFAULT: StyleOption = { value: '', label: 'Default' }

/**
 * The controls to show for a region, given the site's declared palette. Size / boldness /
 * alignment / uppercase / italic are universal; font + colours only appear when the site
 * declares them (their classes are the site's own, so the editor can't invent them).
 */
/**
 * Fold the artist's UPLOADED fonts into a manifest's style options, so the editor's font
 * dropdown offers both the site's compiled tokens (skeen's `font-momo`) and the fonts
 * the manager uploaded on the Brand page. The uploaded token is `font-<family>`, which
 * only resolves because the published payload's `fontStyleCss` emits the matching
 * utility class — offer a font that isn't in the payload and the class silently no-ops,
 * which is the exact failure this file's header warns about. Manifest tokens keep
 * precedence in the list (they are the site's own design); dedup is by token.
 */
export function withUploadedFonts(
  opts: SiteStyleOptions | undefined,
  uploaded: { family: string; label: string }[],
): SiteStyleOptions | undefined {
  if (!uploaded.length) return opts
  const manifest = opts?.fonts ?? []
  const seen = new Set(manifest.map((f) => f.value))
  const extra = uploaded
    .map((f) => ({ value: `font-${f.family}`, label: f.label }))
    .filter((f) => !seen.has(f.value))
  return { ...opts, fonts: [...manifest, ...extra] }
}

/** The scale to offer: the site's own if it advertises one, else this module's.
 *  EMPTY counts as "not advertised" — a site mid-migration announcing `textSizes: []`
 *  should get a working slider, not one with nothing on it. */
const sizeScale = (opts?: SiteStyleOptions): StyleOption[] =>
  opts?.textSizes?.length ? opts.textSizes : SIZE_OPTIONS

const isLeading = (t: string) => t.startsWith('leading-') || t.startsWith('!leading-')
const isTracking = (t: string) => t.startsWith('tracking-') || t.startsWith('!tracking-')

/* ── Measuring an owned token ────────────────────────────────────────────────────────
 * Each `rank` turns a class into a number on its own scale, so sliderIndex can place a
 * value the scale does not literally contain. They are deliberately conservative: an
 * unrecognised shape returns null and the slider falls back to its resting position
 * rather than guessing a position that would be wrong in an invisible way.
 */

/** A CSS length in rem. px is divided by 16 (the browser default and skeen's root size);
 *  anything relative to the viewport or wrapped in calc() is unmeasurable here. */
function lengthRem(raw: string): number | null {
  const s = raw.trim()
  const m = /^(-?[\d.]+)(rem|em|px)$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2] === 'px' ? n / 16 : n
}


export function buildStyleControls(opts?: SiteStyleOptions): StyleControl[] {
  const controls: StyleControl[] = []

  if (opts?.fonts?.length) {
    controls.push({
      id: 'font',
      label: 'Font',
      kind: 'select',
      options: [DEFAULT, ...opts.fonts],
      // Any font-* that isn't a weight is a family.
      owns: (t) => t.startsWith('font-') && !WEIGHTS.includes(fontSuffix(t)),
    })
  }
  controls.push({
    id: 'size',
    label: 'Size',
    kind: 'select',
    options: [DEFAULT, ...sizeScale(opts)],
    owns: isTextSize,
  })
  controls.push({
    id: 'weight',
    label: 'Boldness',
    kind: 'select',
    options: [DEFAULT, ...WEIGHT_OPTIONS],
    owns: (t) => WEIGHTS.includes(fontSuffix(t)),
  })
  // ONE colour-picking format everywhere (Sam, 2026-08-12): the ColorPalette hex
  // picker with the colours-on-site swatch row — never a select of palette classes.
  // Unconditional: a hex lifts inline (colorClass), so it works on a site that
  // declares no palette at all. Each control still OWNS the declared palette classes,
  // so picking a hex REPLACES a stored `bg-black` instead of fighting it, and a
  // stored palette class reads back as its declared hex so the picker tells the truth.
  controls.push(sectionColorControl('textColor', 'Text color', 'color', 'text', opts?.textColors))
  controls.push(sectionColorControl('bgColor', 'Background color', 'backgroundColor', 'bg', opts?.bgColors))
  controls.push({
    id: 'align',
    label: 'Alignment',
    kind: 'select',
    options: [DEFAULT, ...ALIGN_OPTIONS],
    owns: (t) => ALIGNS.includes(textSuffix(t)),
  })
  controls.push({
    id: 'textShadow',
    label: 'Text shadow',
    kind: 'slider',
    steps: TEXT_SHADOW_STEPS,
    rank: (t) => { const i = TEXT_SHADOW_STEPS.findIndex((o) => o.value === t); return i === -1 ? null : i },
    owns: (t) => t.startsWith('textshadow-'),
  })
  controls.push({
    id: 'textStroke',
    label: 'Outline',
    kind: 'slider',
    steps: TEXT_STROKE_STEPS,
    rank: strokeRank,
    owns: (t) => t.startsWith('textstroke-['),
  })
  controls.push({
    id: 'textGlow',
    label: 'Glow',
    kind: 'slider',
    steps: TEXT_GLOW_STEPS,
    rank: (t) => { const m = t.match(/^textglow-([1-9]|1[0-2])$/); return t === '' ? 0 : m ? Number(m[1]) : null },
    owns: (t) => /^textglow-([1-9]|1[0-2])$/.test(t),
  })
  controls.push({ id: 'underline', label: 'Underline', kind: 'toggle', onClass: UNDERLINE_TOGGLE, owns: (t) => t === UNDERLINE_TOGGLE })
  controls.push({ id: 'strike', label: 'Strikethrough', kind: 'toggle', onClass: STRIKE_TOGGLE, owns: (t) => t === STRIKE_TOGGLE })
  // The line's own dressing (Sam, 2026-08-11): colour, thickness, and how far an
  // underline sits from the word. One dressing serves both decorations.
  controls.push({ ...hexControl('decocolor', 'decoColor', 'Line color'), impliesLine: true })
  controls.push({ id: 'decoThickness', label: 'Line thickness', kind: 'slider', steps: DECO_THICKNESS_STEPS, rank: thicknessRank, owns: (t) => t.startsWith('decothick-['), impliesLine: true })
  controls.push({ id: 'decoOffset', label: 'Line Y position', kind: 'slider', steps: DECO_OFFSET_STEPS, rank: pxRank({}), owns: (t) => t.startsWith('underoffset-['), impliesLine: true })
  controls.push(...gradientPair('bggrad', 'Background gradient start', 'Background gradient end'))
  controls.push({
    id: 'frost',
    label: 'Frosted glass',
    kind: 'slider',
    steps: FROST_STEPS,
    rank: pxRank({}),
    owns: (t) => t.startsWith('frost-['),
  })
  controls.push({
    id: 'pad',
    label: 'Padding',
    kind: 'slider',
    steps: PAD_STEPS,
    // Off-scale default: a section's '' is "whatever its base wears" (a bar's py-10),
    // measured by padRank so the handle parks at the real inset — never the None end.
    defaultOffScale: true,
    rank: padRank,
    owns: ownsPad,
  })
  controls.push({ id: 'uppercase', label: 'Uppercase', kind: 'toggle', onClass: CASE_TOGGLE_CLASS, owns: (t) => t === CASE_TOGGLE_CLASS })
  controls.push({ id: 'italic', label: 'Italic', kind: 'toggle', onClass: ITALIC_TOGGLE_CLASS, owns: (t) => t === ITALIC_TOGGLE_CLASS })
  controls.push(...motionControls())
  return controls
}

/* ── Per-ITEM visual controls (images + videos) ──────────────────────────────────────
 * The per-item editor styles one image/video, not a text region: size (scale), transparency
 * (opacity), a border (width + colour), rounded corners, and a shadow. Same StyleControl
 * model + read/apply logic as the text controls — different owned utilities. Every option
 * VALUE is a literal here so Tailwind compiles it (the panel preview renders them live); the
 * SITE must safelist the same set for them to show on the published page. */
// `border` width vs `border-<color>`: a width is bare `border` or `border-<0|2|4|8>`; a colour
// is `border-<name>`. Split by shape so neither control eats the other's token.
// Width vs colour: `border`, `border-<0|2|4|8>`, or an arbitrary `border-[3px]` is a WIDTH;
// `border-<name>` is a colour (owned by the borderColor control's set). Radius likewise
// matches the named steps OR an arbitrary `rounded-[6px]`.
const isBorderWidth = (t: string) => t === 'border' || /^border-(0|2|4|8)$/.test(t) || /^border-\[\d+px\]$/.test(t)
const isRadius = (t: string) =>
  t === 'rounded' || /^rounded-(sm|md|lg|xl|2xl|3xl|full|none)$/.test(t) || /^rounded-\[\d+px\]$/.test(t)
const isShadow = (t: string) => t === 'shadow' || /^shadow-(sm|md|lg|xl|2xl|none|inner)$/.test(t)

/** The controls the per-item editor shows for one image: size, transparency, border
 *  (width + colour), corners, shadow. The border colour is any hex the manager picks from the
 *  palette; site-palette border colours (`border-<token>`) are a later addition once the site
 *  safelists them. */
/**
 * The controls for ONE text field, in its full-panel editor.
 *
 * Same three properties the Style panel offers for a text region, but shaped like the
 * image and video editors the manager is comparing this to: size and weight are ORDERED
 * scales, so they are sliders you drag rather than menus you open. Font is a select
 * because typefaces have no order — the site's own families, plus anything uploaded on
 * the Brand page.
 *
 * The `''` step is the site's own default, first on each scale, so "leave it alone" is
 * reachable by dragging back rather than by remembering which value was original.
 */
export function buildTextItemStyleControls(opts?: SiteStyleOptions): StyleControl[] {
  const controls: StyleControl[] = []
  if (opts?.fonts?.length) {
    controls.push({
      id: 'font',
      label: 'Font',
      kind: 'select',
      options: [DEFAULT, ...opts.fonts],
      owns: (t) => t.startsWith('font-') && !WEIGHTS.includes(fontSuffix(t)),
    })
  }
  controls.push({
    id: 'size',
    label: 'Size',
    kind: 'slider',
    steps: [DEFAULT, ...sizeScale(opts)],
    defaultOffScale: true,
    rank: textSizeRank,
    owns: isTextSize,
  })
  controls.push({
    id: 'weight',
    label: 'Thickness',
    kind: 'slider',
    // Five distinct weights, not Tailwind's nine: most fonts ship a handful and the
    // browser synthesizes the rest into near-duplicates, so nine steps meant dead
    // notches on the slider (Sam, 2026-08-12). Derived by filtering the one table.
    steps: [DEFAULT, ...WEIGHT_OPTIONS.filter((o) =>
      ['font-light', 'font-normal', 'font-medium', 'font-bold', 'font-black'].includes(o.value),
    )],
    defaultOffScale: true,
    owns: (t) => WEIGHTS.includes(fontSuffix(t)),
  })
  // Sam, 2026-08-05: "allow all text input editor sections to edit these parts" — the gap
  // between stacked lines and between letters. Both were previously fixed by whatever the
  // site declared, with no way to adjust them from the editor.
  controls.push({
    id: 'leading',
    label: 'Line spacing',
    kind: 'slider',
    steps: [DEFAULT, ...LEADING_OPTIONS],
    defaultOffScale: true,
    rank: leadingRank,
    owns: isLeading,
  })
  controls.push({
    id: 'tracking',
    label: 'Letter spacing',
    kind: 'slider',
    steps: [DEFAULT, ...TRACKING_OPTIONS],
    defaultOffScale: true,
    rank: trackingRank,
    owns: isTracking,
  })
  // Slice-1 text effects — in BOTH text surfaces (this per-field editor and the Style
  // panel's section controls), so a shadow set in one place is adjustable in the other.
  controls.push({
    id: 'textShadow',
    label: 'Text shadow',
    kind: 'slider',
    steps: TEXT_SHADOW_STEPS,
    rank: (t) => { const i = TEXT_SHADOW_STEPS.findIndex((o) => o.value === t); return i === -1 ? null : i },
    owns: (t) => t.startsWith('textshadow-'),
  })
  controls.push({
    id: 'textStroke',
    label: 'Outline',
    kind: 'slider',
    steps: TEXT_STROKE_STEPS,
    rank: strokeRank,
    owns: (t) => t.startsWith('textstroke-['),
  })
  controls.push({
    id: 'textGlow',
    label: 'Glow',
    kind: 'slider',
    steps: TEXT_GLOW_STEPS,
    rank: (t) => { const m = t.match(/^textglow-([1-9]|1[0-2])$/); return t === '' ? 0 : m ? Number(m[1]) : null },
    owns: (t) => /^textglow-([1-9]|1[0-2])$/.test(t),
  })
  // Font colour, with the SITE'S OWN colours offered as swatches (Sam, 2026-08-11:
  // "I want to have a selector for colors that already are used on the site" — the
  // swatch row comes from siteSwatches at the render site). Replaces the gradient
  // pair, which he judged not worth its two rows here; the textgrad tokens still
  // resolve, so anything stored keeps rendering.
  controls.push({
    id: 'textColor',
    label: 'Font color',
    kind: 'color',
    owns: (t) => colorToken(t)?.prop === 'color',
    hexOf: (cls) => {
      for (const t of cls.split(/\s+/)) {
        const c = colorToken(t)
        if (c?.prop === 'color') return c.value
      }
      return ''
    },
    toToken: (hex) => (hex ? colorClass('text', hex) : ''),
  })
  controls.push({ id: 'underline', label: 'Underline', kind: 'toggle', onClass: UNDERLINE_TOGGLE, owns: (t) => t === UNDERLINE_TOGGLE })
  // No strikethrough here (Sam, 2026-08-12: "for the text tab, remove strikethrough")
  // — the underline is the one decoration, so the dressing below is unambiguously its.
  // A stored line-through still renders; the section panel still offers it.
  controls.push({ ...hexControl('decocolor', 'decoColor', 'Line color'), impliesLine: true })
  controls.push({ id: 'decoThickness', label: 'Line thickness', kind: 'slider', steps: DECO_THICKNESS_STEPS, rank: thicknessRank, owns: (t) => t.startsWith('decothick-['), impliesLine: true })
  controls.push({ id: 'decoOffset', label: 'Line Y position', kind: 'slider', steps: DECO_OFFSET_STEPS, rank: pxRank({}), owns: (t) => t.startsWith('underoffset-['), impliesLine: true })
  controls.push(...motionControls())
  return controls
}

/** Playback rate as a multiplier. `''` is 1×, the middle of this scale rather than an end. */
const speedRank = (t: string): number | null => {
  if (t === '') return 1
  const m = /^speed-\[([\d.]+)x\]$/.exec(t)
  return m ? Number(m[1]) : null
}

/**
 * The steps a slider actually RENDERS: the real values, low → high, with the `''` default
 * removed.
 *
 * The default is not a point on the scale. Leaving it in as steps[0] put "whatever the
 * site already uses" at the far left of an ascending run, which for a large region (a hero
 * wordmark at text-[clamp(4rem,18vw,11rem)]) meant dragging RIGHT made the text smaller.
 *
 * Exported because the UI and its tests must agree on the indices. They did not: the panel
 * filtered the default out while the tests indexed into the raw `steps`, so every test
 * index was off by one.
 */
export function sliderSteps(control: StyleControl): StyleOption[] {
  if (control.kind !== 'slider') return []
  return control.defaultOffScale ? control.steps.filter((s) => s.value !== '') : control.steps
}

/**
 * WHERE THE HANDLE GOES for the current value, and what to call it.
 *
 * Three cases, and the middle one is the whole point:
 *
 *  • the value IS a step — sit on it, exactly.
 *  • the value is off-scale but MEASURABLE — sit on the nearest step. A site's own base
 *    classes are almost never one of ours: skeen writes `leading-none` where we emit
 *    `!leading-none`, sizes its captions `text-[12px]`, and sizes its hero at
 *    `text-[clamp(4rem,18vw,11rem)]` — bigger than any step this editor offers. Treating
 *    all of those as "no value" parked the handle mid-scale, so one notch right applied
 *    something wildly smaller than what was on the screen. That is the bug Sam reported:
 *    "starts in the middle, but when I move it one to the right it gets much smaller."
 *  • the value is unmeasurable, or absent — rest at the midpoint and read "Default",
 *    which leaves room to drag both ways and claims nothing we cannot back up.
 *
 * `exact` is what the caller should gate a Reset control on: nudging an off-scale value
 * is a real change, but there is nothing of the manager's own to clear yet.
 */
export function sliderIndex(
  control: StyleControl,
  current: string,
): { idx: number; label: string; exact: boolean } {
  const steps = sliderSteps(control)
  const middle = Math.floor((steps.length - 1) / 2)
  if (control.kind !== 'slider' || !steps.length) return { idx: 0, label: 'Default', exact: false }

  const exact = steps.findIndex((s) => s.value === current)
  if (exact >= 0) return { idx: exact, label: steps[exact].label, exact: true }

  const rank = control.rank
  const target = current && rank ? rank(current) : null
  if (target != null) {
    let best = -1
    let bestDistance = Infinity
    steps.forEach((step, i) => {
      const r = rank!(step.value)
      if (r == null) return
      const d = Math.abs(r - target)
      // Strictly closer, so a tie keeps the LOWER step. Nudging up from there is a
      // smaller lie than nudging down would be.
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    })
    // "≈" because the handle is beside the value, not on it — the manager should not read
    // an 11rem hero as though it were the 8rem step.
    if (best >= 0) return { idx: best, label: `≈ ${steps[best].label}`, exact: false }
  }
  return { idx: middle, label: 'Default', exact: false }
}

/** A section colour control in the house picker format: hex 'color' kind rendered as
 *  ColorPalette (custom picker + colours-on-site swatches). Owns BOTH the hex tokens
 *  for its property AND the site's declared palette classes for it; a declared class
 *  reads back as its declared hex (StyleOption.hex) so the picker shows where the
 *  site actually is — '' when the site never said. */
function sectionColorControl(
  id: string,
  label: string,
  prop: 'color' | 'backgroundColor',
  chan: 'text' | 'bg',
  declared: StyleOption[] | undefined,
): StyleControl {
  const declaredHex = new Map((declared ?? []).map((o) => [o.value, o.hex ?? '']))
  return {
    id,
    label,
    kind: 'color',
    owns: (t) => colorToken(t)?.prop === prop || declaredHex.has(t),
    hexOf: (cls) => {
      for (const t of cls.split(/\s+/)) {
        const c = colorToken(t)
        if (c?.prop === prop) return c.value
        const d = declaredHex.get(t)
        if (d) return d
      }
      return ''
    },
    toToken: (hex) => (hex ? colorClass(chan, hex) : ''),
  }
}

/** What a SITE-WIDE region (`scope: 'site'` — the page, the nav bar, the footer) may
 *  style: padding (which IS the bar-height knob), ONE colour, frost — no gradient and
 *  no text controls (Sam, 2026-08-12; text Size left the same day: it read as doing
 *  nothing, since every child sets its own size). An ALLOWLIST, deliberately: a
 *  control added later stays off site-wide regions unless it opts in here. Element
 *  regions keep the full set. */
const SITE_SCOPE_CONTROL_IDS = new Set(['pad', 'bgColor', 'frost'])
/** The border-side utilities a base can draw its divider with. */
const DIVIDER_SIDES = new Set(['border', 'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y'])
export function controlsForRegion(
  controls: StyleControl[],
  region: ManifestStyleRegion,
): StyleControl[] {
  if (region.scope !== 'site') return controls
  const out = controls.filter((c) => SITE_SCOPE_CONTROL_IDS.has(c.id))
  // "A way to remove the line below the nav bar and above the footer" (Sam,
  // 2026-08-12): a toggle built FROM the region's own base — off strips the border
  // side, on restores exactly the side the base drew. No base line, no toggle.
  const side = (region.base ?? '').split(/\s+/).find((t) => DIVIDER_SIDES.has(t))
  if (side)
    out.push({
      id: 'divider',
      label: 'Divider line',
      kind: 'toggle',
      onClass: side,
      owns: (t) => DIVIDER_SIDES.has(t),
    })
  return out
}

/* ENTRANCES PAUSED (2026-08-12) — the rank helpers rest with their sliders.

// Entrance-speed tokens measure in ms; '' is the CSS default (1200ms), a real point
// on the scale like Tilt's 0.
const msRank = (t: string): number | null => {
  if (t === '') return 1200
  const m = /-\[(\d+)ms\]$/.exec(t)
  return m ? Number(m[1]) : null
}

// Entrance-travel tokens measure in px, with vw as the "screen edge" tail — ranked
// past every px step (no px step approaches 10000). '' is the CSS default (28/36px).
const distRank = (t: string): number | null => {
  if (t === '') return 30
  const m = /-\[(\d+)(px|vw)\]$/.exec(t)
  return m ? (m[2] === 'vw' ? 10_000 + Number(m[1]) : Number(m[1])) : null
}
*/

/** Slice-3 motion (2026-08-11): entrance + its speed + hover, on every styleable
 *  surface. The classes are compiled CSS (tokens.css effects block), the speed lifts
 *  inline — see vocabulary.ts. */
function motionControls(): StyleControl[] {
  return [
    // ENTRANCES PAUSED (Sam, 2026-08-12) — pulled from the panel, not deleted. The
    // blocker: the IntersectionObserver watches the element's TRANSFORMED box, so a
    // Travel past the viewport parks the element where it never intersects and it
    // never releases. Resuming needs release-by-resting-position (observe an
    // untransformed proxy, or compute the resting rect by backing the translation
    // out). The bridge keeps the runtime + CSS; stored enter-* tokens still play on
    // sites whose drafts carry them — juniper's were stripped the same day.
    // { id: 'entrance', label: 'Entrance', kind: 'select', options: ENTRANCE_OPTIONS, owns: (t) => t.startsWith('enter-') },
    // { id: 'entranceSpeed', label: 'Entrance speed', kind: 'slider', steps: ENTRANCE_SPEED_STEPS, rank: msRank, owns: (t) => t.startsWith('enterdur-[') },
    // { id: 'entranceTravel', label: 'Entrance travel', kind: 'slider', steps: ENTRANCE_TRAVEL_STEPS, rank: distRank, owns: (t) => t.startsWith('enterdist-[') },
    { id: 'hover', label: 'On hover', kind: 'select', options: HOVER_OPTIONS, owns: (t) => t.startsWith('hover-') },
    // Hover colour (Sam, 2026-08-12). Two tokens as ONE value: the `hovercolor`
    // marker class carries the compiled :hover rule, `hovercolor-[#hex]` lifts the
    // colour inline — apart they are both no-ops, so they are written and cleared
    // together. No dash after "hover", so the effect select above never sweeps them.
    {
      id: 'hoverColor',
      label: 'Hover color',
      kind: 'color',
      owns: (t) => t === 'hovercolor' || t.startsWith('hovercolor-['),
      hexOf: (cls) =>
        cls.split(/\s+/).map((t) => /^hovercolor-\[(#[0-9a-fA-F]{3,8})\]$/.exec(t)?.[1]).find(Boolean) ?? '',
      toToken: (hex) => (hex ? `hovercolor hovercolor-[${hex}]` : ''),
    },
  ]
}

export function buildItemStyleControls(): StyleControl[] {
  return [
    { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, rank: pctRank('scale'), owns: (t) => t.startsWith('scale-') },
    { id: 'opacity', label: 'Transparency', kind: 'slider', steps: OPACITY_STEPS, rank: pctRank('opacity'), owns: (t) => t.startsWith('opacity-') },
    { id: 'borderWidth', label: 'Border', kind: 'slider', steps: BORDER_WIDTH_STEPS, rank: pxRank(BORDER_PX), owns: isBorderWidth },
    { id: 'borderColor', label: 'Border color', kind: 'color', owns: (t) => colorToken(t)?.prop === 'borderColor' },
    { id: 'radius', label: 'Corners', kind: 'slider', steps: RADIUS_STEPS, rank: pxRank(RADIUS_PX), owns: isRadius },
    { id: 'shadow', label: 'Shadow', kind: 'slider', steps: SHADOW_STEPS, rank: shadowRank, owns: isShadow },
    // Slice-1 effects (2026-08-10). All lift inline, so they work on every deployed
    // site with nothing recompiled; the six filters COMPOSE (styles.ts).
    ...filterControls(),
    tiltControl(),
    ...cropControls(),
    { id: 'shape', label: 'Shape', kind: 'select', options: SHAPE_STEPS, owns: (t) => t.startsWith('shape-') },
    { id: 'feather', label: 'Feather', kind: 'slider', steps: FEATHER_STEPS, rank: pctRank0('feather'), owns: (t) => /^feather-\d/.test(t) },
    { id: 'pad', label: 'Matte', kind: 'slider', steps: PAD_STEPS, rank: pxRank({}), owns: (t) => t.startsWith('pad-[') },
    ...motionControls(),
  ]
}

/**
 * The photographic FILTERS — shared by images, video embeds AND uploaded background
 * clips, because a filter acts on whatever pixels are in the box; a full-bleed hero
 * video dims and desaturates exactly like an image does (Sam, 2026-08-10).
 */
function filterControls(): StyleControl[] {
  return [
    { id: 'grayscale', label: 'Black & white', kind: 'slider', steps: GRAYSCALE_STEPS, rank: pctRank0('bw'), owns: (t) => /^bw-\d/.test(t) },
    { id: 'sepia', label: 'Sepia', kind: 'slider', steps: SEPIA_STEPS, rank: pctRank0('sepia'), owns: (t) => /^sepia-\d/.test(t) },
    { id: 'brightness', label: 'Brightness', kind: 'slider', steps: BRIGHTNESS_STEPS, rank: pctRank('brightness'), owns: (t) => /^brightness-\d/.test(t) },
    { id: 'contrast', label: 'Contrast', kind: 'slider', steps: CONTRAST_STEPS, rank: pctRank('contrast'), owns: (t) => /^contrast-\d/.test(t) },
    { id: 'saturate', label: 'Saturation', kind: 'slider', steps: SATURATE_STEPS, rank: pctRank('saturate'), owns: (t) => /^saturate-\d/.test(t) },
    { id: 'soften', label: 'Soften', kind: 'slider', steps: BLUR_STEPS, rank: pxRank({}), owns: (t) => t.startsWith('soften-[') },
  ]
}

/** Box-level media controls. CROP IS IMAGE/VIDEO-ELEMENT ONLY: `object-fit` does not
 *  reach inside an iframe, so on a YouTube embed the control would move and nothing
 *  would change — the silent no-op this panel must never offer (Sam, 2026-08-10:
 *  "I cant edit the youtube video via css if its just an embedding" — half right; the
 *  BOX styles work, the crop does not). */
function cropControls(): StyleControl[] {
  return [
    { id: 'fit', label: 'Crop', kind: 'select', options: FIT_STEPS, owns: (t) => t === 'fit-cover' || t === 'fit-contain' },
    { id: 'fitPosition', label: 'Crop anchor', kind: 'select', options: FIT_POSITIONS, owns: (t) => /^fit-(top|bottom|left|right)$/.test(t) },
  ]
}

const tiltControl = (): StyleControl =>
  ({ id: 'tilt', label: 'Tilt', kind: 'slider', steps: TILT_STEPS, rank: tiltRank, owns: (t) => t.startsWith('tilt-[') })

/** The two ends of a two-hex gradient token (`textgrad-[#a_#b]` / `bggrad-[#a_#b]`),
 *  as a PAIR of colour controls sharing one token. Each reads its half out of the
 *  stored string and writes the whole token back; clearing either end clears the
 *  gradient (half a gradient is not a thing). */
function gradientPair(prefix: 'bggrad', fromLabel: string, toLabel: string): StyleControl[] {
  const RE = new RegExp(`^${prefix}-\\[(#[0-9a-fA-F]{3,8})_(#[0-9a-fA-F]{3,8})\\]$`)
  const owns = (t: string) => t.startsWith(`${prefix}-[`)
  const halves = (cls: string): [string, string] | null => {
    const tok = cls.split(/\s+/).find(owns)
    const m = tok?.match(RE)
    return m ? [m[1], m[2]] : null
  }
  const make = (id: string, label: string, idx: 0 | 1): StyleControl => ({
    id,
    label,
    kind: 'color',
    owns,
    hexOf: (cls) => halves(cls)?.[idx] ?? '',
    toToken: (hex, cls) => {
      if (!hex) return '' // either end cleared → the whole gradient goes
      const other = halves(cls)?.[idx === 0 ? 1 : 0] ?? hex
      const pair = idx === 0 ? [hex, other] : [other, hex]
      return `${prefix}-[${pair[0]}_${pair[1]}]`
    },
  })
  return [make(`${prefix}From`, fromLabel, 0), make(`${prefix}To`, toLabel, 1)]
}

/** A single-hex colour control over one `<prefix>-[#hex]` token — the generic cousin of
 *  the gradient halves, for tokens that carry exactly one colour. */
function hexControl(prefix: string, id: string, label: string): StyleControl {
  const RE = new RegExp(`^${prefix}-\\[(#[0-9a-fA-F]{3,8})\\]$`)
  const owns = (t: string) => t.startsWith(`${prefix}-[`)
  return {
    id,
    label,
    kind: 'color',
    owns,
    hexOf: (cls) => cls.split(/\s+/).find(owns)?.match(RE)?.[1] ?? '',
    toToken: (hex) => (hex ? `${prefix}-[${hex}]` : ''),
  }
}

/** Stroke ranks by px, decimals included — pxRank's regex is integer-only. */
const strokeRank = (t: string): number | null => {
  if (t === '') return 0
  const m = t.match(/^textstroke-\[(\d(?:\.5)?)px\]$/)
  return m ? Number(m[1]) : null
}

/** Tilt ranks by DEGREES, signed — 0° sits mid-slider like Size's 100%, and '' IS 0°
 *  (found by the monotonicity invariant: a null rank for the resting value left the
 *  thumb unplaced on an untouched image). */
const tiltRank = (t: string): number | null => {
  if (t === '') return 0
  const m = t.match(/^tilt-\[(-?\d{1,2})deg\]$/)
  return m ? Number(m[1]) : null
}

/** Playback-speed steps, Normal (1×, the `''` default) in the middle of a slow→fast run.
 *  Values are `speed-[Nx]` pseudo-tokens (style-apply lifts them to `video.playbackRate`
 *  — speed can never be CSS), so nothing here needs safelisting. */
const SPEED_STEPS: StyleOption[] = [
  { value: 'speed-[0.25x]', label: '0.25×' },
  { value: 'speed-[0.5x]', label: '0.5×' },
  { value: 'speed-[0.75x]', label: '0.75×' },
  { value: '', label: 'Normal' },
  { value: 'speed-[1.25x]', label: '1.25×' },
  { value: 'speed-[1.5x]', label: '1.5×' },
  { value: 'speed-[2x]', label: '2×' },
]

/**
 * The per-item controls for one VIDEO — a different set from images (Sam, 2026-08-03):
 * borders don't earn their keep on video, and what IS wanted is video-specific.
 *
 *  • 'embed' (the YouTube band): visual-only — size, transparency, corners, shadow.
 *    An iframe's playback can't be touched from outside, so no Speed.
 *  • 'file' (an uploaded background clip): Speed + transparency. It renders full-bleed
 *    behind the page, so scale/corners/shadow have nothing visible to act on.
 */
export function buildVideoItemStyleControls(kind: 'embed' | 'file'): StyleControl[] {
  const opacity: StyleControl = {
    id: 'opacity',
    label: 'Transparency',
    kind: 'slider',
    steps: OPACITY_STEPS,
    rank: pctRank('opacity'),
    owns: (t) => t.startsWith('opacity-'),
  }
  if (kind === 'file') {
    return [
      { id: 'speed', label: 'Speed', kind: 'slider', steps: SPEED_STEPS, rank: speedRank, owns: (t) => t.startsWith('speed-') },
      opacity,
      // A full-bleed background still has PIXELS — dim it, desaturate it, soften it
      // under the text. What it lacks is a visible BOX, so size/corners/shadow/tilt
      // stay out (Sam, 2026-08-10: these slots had "only speed and transparency").
      // Motion stays out too: nothing hovers a full-bleed background, and an
      // entrance on the page's backdrop reads as a broken load, not a reveal.
      ...filterControls(),
    ]
  }
  return [
    { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, rank: pctRank('scale'), owns: (t) => t.startsWith('scale-') },
    opacity,
    { id: 'radius', label: 'Corners', kind: 'slider', steps: RADIUS_STEPS, rank: pxRank(RADIUS_PX), owns: isRadius },
    { id: 'shadow', label: 'Shadow', kind: 'slider', steps: SHADOW_STEPS, rank: shadowRank, owns: isShadow },
    // Filters + tilt act on the embed's BOX, which browsers style happily. No crop:
    // object-fit cannot reach inside an iframe (see cropControls). Shape and feather
    // DO work — clip-path and mask cut the box itself.
    ...filterControls(),
    tiltControl(),
    { id: 'shape', label: 'Shape', kind: 'select', options: SHAPE_STEPS, owns: (t) => t.startsWith('shape-') },
    { id: 'feather', label: 'Feather', kind: 'slider', steps: FEATHER_STEPS, rank: pctRank0('feather'), owns: (t) => /^feather-\d/.test(t) },
    ...motionControls(),
  ]
}

/** The control's current value in a class string: the owned utility ('' if none / Default),
 *  or 'on'/'' for a toggle. */
export function readStyleValue(control: StyleControl, classString: string): string {
  const tokens = classString.split(/\s+/).filter(Boolean)
  if (control.kind === 'toggle') return tokens.includes(control.onClass) ? 'on' : ''
  return tokens.find(control.owns) ?? ''
}

/** A new class string with this control set to `value`: every token the control owns is
 *  removed, then the new one appended. Non-owned tokens (layout, spacing, …) are kept in
 *  place. A '' value (Default) or 'off' toggle just removes the owned tokens. */
/** The decoration dressings' token prefixes — ONE list (AGENTS.md rule 4). The three
 *  controls mark themselves `impliesLine` where they are DEFINED; this list exists only
 *  for the sweep below, which has no control in hand for the tokens it must strip. */
const DRESSING_PREFIXES = ['decocolor-[', 'decothick-[', 'underoffset-[']
const isDressing = (t: string) => DRESSING_PREFIXES.some((p) => t.startsWith(p))

export function applyStyleValue(classString: string, control: StyleControl, value: string): string {
  const kept = classString.split(/\s+/).filter(Boolean).filter((t) => !control.owns(t))
  const hasLine = () => kept.includes(UNDERLINE_TOGGLE) || kept.includes(STRIKE_TOGGLE)
  if (control.kind === 'toggle') {
    if (value === 'on') kept.push(control.onClass)
    // Turning the LAST line off sweeps its dressing with it — dead decothick/decocolor
    // tokens would otherwise sit stored drawing nothing, and the sliders go back to
    // "not working" one toggle later (review, 2026-08-11). Switching between line
    // KINDS keeps the dressing: one decoration, one dressing.
    const isLineToggle = control.onClass === UNDERLINE_TOGGLE || control.onClass === STRIKE_TOGGLE
    if (isLineToggle && !hasLine()) return kept.filter((t) => !isDressing(t)).join(' ')
  } else if (value) {
    kept.push(value)
    // The decoration DRESSING implies a decoration LINE. text-decoration-thickness with
    // no text-decoration-line draws nothing, so a manager dragging Thickness with both
    // toggles off watched a slider that "wasn't working" (Sam, 2026-08-11). Underline is
    // the default line; an existing line — either kind — is respected, and clearing the
    // dressing never touches the line (the empty-value branch above skips this).
    // `impliesLine` is set where each dressing control is DEFINED, so a fourth dressing
    // cannot join the panel and miss this rule.
    if (control.impliesLine && !hasLine()) kept.push(UNDERLINE_TOGGLE)
  }
  return kept.join(' ')
}

/**
 * Do two class strings say the same thing? Order-insensitive, whitespace-insensitive.
 *
 * Used to decide whether an override is REALLY an override: a string equal to the
 * region's base is not a change, and storing it would pin a copy of today's defaults
 * that wins forever over any later change the site makes to its own base classes
 * (skeen brief, 2026-08-03). Shared so the Style panel and the text-field editor can
 * never disagree about what "unchanged" means.
 */
export function sameClasses(a: string, b: string): boolean {
  const norm = (s: string) => s.split(/\s+/).filter(Boolean).sort().join(' ')
  return norm(a) === norm(b)
}
