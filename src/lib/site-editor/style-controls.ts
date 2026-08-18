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
import { bridgeSupportsDeltas, bridgeSupportsMobileItem, bridgeSupportsMobileText, bridgeSupportsMobileVars, bridgeSupportsStyleVars, bridgeSupportsTextVars } from '@/lib/site-editor/manifest'

// MOVED to @samfox1/site-bridge (they ride the manifest — a site declares its palette
// through them). Re-exported from their historical home; imported for local use.
export type { StyleOption, SiteStyleOptions } from '@samfox1/site-bridge/manifest'
import type { ManifestStyleRegion, StyleOption, SiteStyleOptions } from '@samfox1/site-bridge/manifest'
import { DELTA_SENTINEL, TEXT_SIZES, familyOf } from '@samfox1/site-bridge/styles'
import type { RegionMeasurements } from '@samfox1/site-bridge/protocol'
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
  PAD_Y_STEPS,
  GAP_STEPS,
  ICON_SIZE_STEPS,
  CONTENT_WIDTH_STEPS,
  SECTION_WIDTH_STEPS,
  SECTION_HEIGHT_STEPS,
  DECO_THICKNESS_STEPS,
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
  | { id: string; label: string; kind: 'select'; options: StyleOption[]; owns: (token: string) => boolean; impliesLine?: boolean; phoneScoped?: boolean; segmented?: boolean }
  | { id: string; label: string; kind: 'toggle'; onClass: string; owns: (token: string) => boolean; impliesLine?: boolean; phoneScoped?: boolean }
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
      /** Colour controls are never phone-scoped, but the union member needs the field. */
      phoneScoped?: boolean
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
      /** Writes the `…sm-[…]` phone twin — the row shows a bold (Mobile) tag. */
      phoneScoped?: boolean
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

/* ── Size and font as VALUES, not classes (CONNECTING.md §5) ─────────────────────────
 * A class beats the site's breakpoints: it lands in the merged string, and a section
 * override replaces the base, so the `md:text-6xl` the site wrote is gone. These two
 * controls now emit VALUE tokens the bridge lifts onto `--lse-size` / `--lse-font`,
 * which a site can read and still shrink on a phone.
 *
 * Both controls own the OLD shape as well. Every already-styled region stores a class,
 * and owning only the new token would leave two sizes on one element with stylesheet
 * order deciding which wins — the exact silent failure the size control was built to
 * avoid in the first place.
 */

/** The size token the editor writes: a desktop px, which the bridge turns into a fluid
 *  clamp. `size-[Npx]` rather than a bare number so it reads like every other token in a
 *  stored string, and so `owns` can recognise it without ambiguity. */
const isSizeVar = (t: string) => /^size-\[\d{1,4}px\]$/.test(t)
const sizeVarPx = (t: string): number | null => {
  const m = /^size-\[(\d{1,4})px\]$/.exec(t)
  return m ? Number(m[1]) : null
}
const isFontVar = (t: string) => t.startsWith('fontfam-[')

/**
 * May the editor WRITE value tokens for this site?
 *
 * A site whose bundled applier predates them does not recognise `size-[48px]`, so it would
 * ride through to the class attribute as a dead class and the region would quietly fall
 * back to its base size — a control that stops working with no error anywhere. The editor
 * sets this from the manifest's `bridgeVersion` (see `withStyleVars`).
 *
 * Absent means YES: lone-star's own built-in templates render in-process against this very
 * package, and a caller that never met a remote site has nothing to be behind.
 *
 * Both shapes stay READABLE either way — the controls own the old classes forever, because
 * every region styled before the migration still stores one.
 */
const usesVars = (opts?: SiteStyleOptions) =>
  (opts as EditorStyleOptions | undefined)?.styleVars !== false

/** The second era's gate: weight/align/leading/tracking/case/italic tokens need 0.18+.
 *  A 0.16 site lifts `size-[…]` but has never heard of `weight-[…]`, so the two flags
 *  are independent — a mixed-era site gets size tokens AND weight classes. */
const usesTextVars = (opts?: SiteStyleOptions) =>
  (opts as EditorStyleOptions | undefined)?.textVars !== false

/** Phone-scoped editing: BOTH the phone view and a 0.19+ site. An older site in phone
 *  view keeps the desktop-scoped controls — a phone token it cannot lift would be a
 *  dead class AND an invisible marker class. */
const phoneScope = (opts?: SiteStyleOptions) => {
  const o = opts as EditorStyleOptions | undefined
  return o?.mobileView === true && o?.mobileVars !== false
}

/* ── Phone-scope token helpers. Ownership is DISJOINT from the desktop families by
 * regex shape (`sizesm-[` never matches `^size-\[`), which is what lets a desktop edit
 * preserve the phone override and vice versa. */
const isSizeSm = (t: string) => /^sizesm-\[\d{1,4}px\]$/.test(t)
const isPadSm = (t: string) => /^padsm-\[\d{1,4}px\]$/.test(t)
const sizeSmRank = (t: string): number | null => {
  const m = /^sizesm-\[(\d{1,4})px\]$/.exec(t)
  return m ? Number(m[1]) / 16 : null
}
const padSmRank = (t: string): number | null => {
  const m = /^padsm-\[(\d{1,4})px\]$/.exec(t)
  return m ? Number(m[1]) : null
}

/* ── The GENERIC phone twin (0.22, Sam: "all the styles"). Any token-emitting control
 * becomes phone-scoped by rewriting its vocabulary `x-[…]` → `xsm-[…]` and translating
 * back for owns/rank, so the twin can never drift from its desktop original. Colour and
 * effect controls pass through untouched — they stay device-global. */
const SM_SHAPE = /^([a-z]+)sm-\[/
const toSm = (v: string) => {
  if (v === '') return v
  // scale is the one bare-suffix family (`scale-135`, no brackets); its twin adopts the
  // bracket shape so SM detection stays one regex.
  const scale = /^scale-(\d{1,3})$/.exec(v)
  if (scale) return `scalesm-[${scale[1]}]`
  return v.replace(/^([a-z]+)-\[/, '$1sm-[')
}
const unSm = (t: string) => {
  const scale = /^scalesm-\[(\d{1,3})\]$/.exec(t)
  if (scale) return `scale-${scale[1]}`
  return t.replace(SM_SHAPE, '$1-[')
}
const phoneTwin = (c: StyleControl): StyleControl => {
  if (c.kind === 'select')
    return {
      ...c, phoneScoped: true,
      options: c.options.map((o) => ({ ...o, value: toSm(o.value) })),
      owns: (t) => SM_SHAPE.test(t) && c.owns(unSm(t)),
    }
  if (c.kind === 'slider')
    return {
      ...c, phoneScoped: true, defaultOffScale: true,
      steps: c.steps.map((o) => ({ ...o, value: toSm(o.value) })),
      rank: (t) => (t === '' ? null : SM_SHAPE.test(t) ? (c.rank?.(unSm(t)) ?? null) : null),
      owns: (t) => SM_SHAPE.test(t) && c.owns(unSm(t)),
    }
  if (c.kind === 'toggle')
    return {
      ...c, phoneScoped: true,
      onClass: toSm(c.onClass),
      owns: (t) => SM_SHAPE.test(t) && c.owns(unSm(t)),
    }
  return c
}
/** Twin the whole-set controls when the phone scope AND the 0.22 floor hold. */
const phoneTextScope = (opts?: SiteStyleOptions) =>
  phoneScope(opts) &&
  (opts as EditorStyleOptions | undefined)?.mobileTextVars !== false &&
  usesTextVars(opts) // class-era vocabularies have no sm shape to rewrite
const phoneItemScope = (opts?: SiteStyleOptions) =>
  phoneScope(opts) && (opts as EditorStyleOptions | undefined)?.mobileItemVars !== false
/** A desktop step → its phone twin, same label. Sizes measure via textSizeRank so a
 *  class-era ladder (a site that declares textSizes) converts too; an unmeasurable step
 *  is dropped rather than emitting a token the bridge would refuse. */
const sizeSmOption = (o: StyleOption): StyleOption => {
  const rem = textSizeRank(o.value) // reads both eras: size-[48px] tokens AND text-* classes
  return { ...o, value: rem != null ? `sizesm-[${Math.round(rem * 16)}px]` : o.value }
}
const padSmOption = (o: StyleOption): StyleOption => {
  if (o.value === '') return o
  const px = padRank(o.value)
  return { ...o, value: px != null ? `padsm-[${px}px]` : o.value }
}

/** Style options plus what the EDITOR knows that the site did not declare. Kept separate
 *  from `SiteStyleOptions` (the manifest type) because this is derived, not announced. */
export type EditorStyleOptions = SiteStyleOptions & {
  styleVars?: boolean
  textVars?: boolean
  /** The connected site's applier + tokens.css understand the mobile tokens (0.19+). */
  mobileVars?: boolean
  /** Phone twins for the whole style set (0.22+); size/pad need only mobileVars. */
  mobileTextVars?: boolean
  /** Per-item phone twins (scale, 0.23+). */
  mobileItemVars?: boolean
  /** The site renders delta overrides (0.24+), so saves store only changed families. */
  deltaStyles?: boolean
  /** The editor is currently in PHONE view. With the vars flags, controls become
   *  phone-scoped: same control, writing the `…sm-[…]` twin. */
  mobileView?: boolean
}

/**
 * Record what the connected site's bridge can lift, for the control builders to read.
 * Takes the announced VERSION rather than booleans, because the eras multiplied: size
 * and font tokens need 0.16+, the text families 0.18+, and a caller juggling two flags
 * is a caller that will someday pass them in the wrong order.
 * Call once where the options are prepared, beside `withUploadedFonts`.
 */
export function withStyleVars(
  opts: SiteStyleOptions | undefined,
  bridgeVersion: string | undefined,
): EditorStyleOptions {
  return {
    ...opts,
    styleVars: bridgeSupportsStyleVars(bridgeVersion),
    textVars: bridgeSupportsTextVars(bridgeVersion),
    mobileVars: bridgeSupportsMobileVars(bridgeVersion),
    mobileTextVars: bridgeSupportsMobileText(bridgeVersion),
    mobileItemVars: bridgeSupportsMobileItem(bridgeVersion),
    deltaStyles: bridgeSupportsDeltas(bridgeVersion),
  }
}
/** Both shapes — the value token this control now writes, and every class shape a region
 *  styled before the migration still stores. */
const ownsSize = (t: string) => isSizeVar(t) || isTextSize(t)

/* ── The SECOND-WAVE text tokens (2026-08-17): weight, align, leading, tracking, case,
 * italic — the same recipe as size, one bridge era later (usesTextVars gates emission).
 * Each control owns BOTH shapes forever: every region styled before today stores a class,
 * and owning only the token would leave two values on one element with stylesheet order
 * arbitrating. */
const WEIGHT_NUM: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
}
const isWeightVar = (t: string) => /^weight-\[\d{3}\]$/.test(t)
const weightRank = (t: string): number | null => {
  if (t === '') return null
  const m = /^weight-\[(\d{3})\]$/.exec(t)
  if (m) return Number(m[1])
  return WEIGHT_NUM[fontSuffix(t)] ?? null
}
/** A class option → its token twin (`font-bold` → `weight-[700]`), label untouched. */
const weightToken = (o: StyleOption): StyleOption =>
  ({ ...o, value: `weight-[${WEIGHT_NUM[o.value.slice('font-'.length)]}]` })

/** Two weights (Sam, 2026-08-17: "just normal or bold"), era-appropriate. Ownership
 *  still spans every weight, so stored intermediates and Black-era picks replace fine. */
const WEIGHT_SEGMENTS = (tokens: boolean): StyleOption[] =>
  [
    { value: 'font-normal', label: 'Normal' },
    { value: 'font-bold', label: 'Bold' },
  ].map((o) => (tokens ? weightToken(o) : o))

const isAlignVar = (t: string) => t.startsWith('align-[')
const alignToken = (o: StyleOption): StyleOption =>
  ({ ...o, value: `align-[${o.value.slice('text-'.length)}]` })

/** Leading/tracking option labels ARE their numeric values (that is why the scales read
 *  as numbers), so the token twin is derived from the label rather than re-tabulated. */
const isLeadVar = (t: string) => t.startsWith('lead-[')
const leadToken = (o: StyleOption): StyleOption => ({ ...o, value: `lead-[${o.label}]` })
const isTrackVar = (t: string) => t.startsWith('track-[')
const trackToken = (o: StyleOption): StyleOption =>
  ({ ...o, value: `track-[${o.label}em]` })

/**
 * The font token: the site's declared stack, underscore-encoded because a stored style
 * string is split on whitespace (Tailwind's own arbitrary-value convention).
 *
 * QUOTES ARE STRIPPED. A quote is one of the few characters that could end a style
 * attribute, so `cleanClassText` refuses it — a quoted stack would fail to save with
 * "that setting produced something the site can't use", the message Sam hit on the social
 * icons. The bridge re-quotes each family when it builds the CSS value, which is the only
 * place that can do it correctly (a generic keyword must stay bare).
 */
const encodeFontStack = (css: string) =>
  `fontfam-[${css.replace(/["']/g, '').trim().replace(/\s+/g, '_')}]`

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
  const varPx = sizeVarPx(t)
  if (varPx != null) return varPx / 16
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
  const tok = /^lead-\[(\d(?:\.\d{1,3})?)\]$/.exec(t)
  if (tok) return Number(tok[1])
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
  const tok = /^track-\[(-?\d(?:\.\d{1,3})?)em\]$/.exec(t)
  if (tok) return Number(tok[1])
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

/** The gap slider MEASURES a base's own Tailwind gap (`gap-8` = 32px) and REPLACES it,
 *  the same way the padding slider handles `py-10` — so the handle parks at the real
 *  gutter, not the None end. `''` ranks null: unset means "the base's gap", not zero. */
const GAP_TW_RE = /^gap-(\d+(?:\.\d+)?)$/
const gapRank = (t: string): number | null => {
  if (t === '') return null
  const arb = /^gap-\[(\d+(?:\.\d+)?)px\]$/.exec(t)
  if (arb) return Number(arb[1])
  const tw = GAP_TW_RE.exec(t)
  return tw ? Number(tw[1]) * 4 : null
}
const ownsGap = (t: string) => t.startsWith('gap-[') || GAP_TW_RE.test(t)

/** Icon-size slider (an icon group): measures `iconsize-[Npx]`. '' ranks null — unset is
 *  the site's own default, not zero. */
const iconSizeRank = (t: string): number | null => {
  if (t === '') return null
  const m = /^iconsize-\[(\d+)px\]$/.exec(t)
  return m ? Number(m[1]) : null
}
const ownsIconSize = (t: string) => t.startsWith('iconsize-[')

// The centred dressing sliders: Auto sits mid-ladder and ranks like ~2px (a browser's
// usual auto thickness), so sub-pixel steps sort left of it and 3px+ right of it.
const thicknessRank = (t: string): number | null => (t === '' ? 2 : pxRank({})(t))
/* Line Y position REMOVED entirely (Sam, 2026-08-17) — stored `underoffset-[…]` rows
 * keep rendering via the bridge; there is just no control writing new ones. */

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
    // `css` is the stack `fontStyleCss` writes for this family, character for character
    // (`.font-<family>{font-family:'<family>',sans-serif}`) — so choosing the font via
    // the variable renders identically to choosing it via the class.
    .map((f) => ({ value: `font-${f.family}`, label: f.label, css: `'${f.family}',sans-serif` }))
    .filter((f) => !seen.has(f.value))
  return { ...opts, fonts: [...manifest, ...extra] }
}

/**
 * The scale to offer: the site's own if it advertises one, else this module's.
 * EMPTY counts as "not advertised" — a site mid-migration announcing `textSizes: []`
 * should get a working slider, not one with nothing on it.
 *
 * Which STEPS to offer stays the site's call; what gets WRITTEN is a value token. The
 * declaration existed because Tailwind only builds the classes it can see, and a size the
 * site never compiled landed with no CSS behind it — a variable has nothing to compile,
 * so that reason is gone while the site's choice of scale is not.
 *
 * A step whose size cannot be measured is left as its own class: better a control that
 * behaves as it always did than one that silently writes a size nobody asked for.
 */
const sizeScale = (opts?: SiteStyleOptions): StyleOption[] => {
  // ADVERTISED SIZES ARE WRITTEN VERBATIM. A site that declares `textSizes` has said
  // exactly which classes it wants set, down to each clamp's floor — reinterpreting one
  // as a px and re-deriving the clamp would quietly substitute the editor's judgement for
  // the site's, which is the opposite of the point. Declaring the scale is how a site
  // opts OUT of the variable; omitting it is how a site opts in.
  if (opts?.textSizes?.length) return opts.textSizes
  if (!usesVars(opts)) return SIZE_OPTIONS
  return SIZE_OPTIONS.map((o) => {
    const rem = textSizeRank(o.value)
    return rem == null ? o : { ...o, value: `size-[${Math.round(rem * 16)}px]` }
  })
}

/** A font option as the editor should WRITE it: a value token when the site declared what
 *  its class resolves to, the class itself otherwise. The editor cannot know what
 *  `font-display` means, and inventing a stack would replace the site's typeface with a
 *  guess — so an undeclared font keeps working exactly as it does today. */
const fontOption = (opts: SiteStyleOptions | undefined) => (f: StyleOption): StyleOption =>
  f.css && usesVars(opts) ? { ...f, value: encodeFontStack(f.css) } : f

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
      options: [DEFAULT, ...opts.fonts.map(fontOption(opts))],
      // Any font-* that isn't a weight is a family.
      owns: (t) => isFontVar(t) || (t.startsWith('font-') && !WEIGHTS.includes(fontSuffix(t))),
    })
  }
  // PHONE SCOPE: in the editor's mobile view (on a 0.19+ site) Size and Padding write
  // the `…sm-[…]` twin — a value only applied below 640px — and own ONLY that twin, so
  // a phone edit preserves the desktop value and a desktop edit preserves the phone one.
  controls.push(
    phoneScope(opts)
      ? {
          id: 'size',
          label: 'Size',
          phoneScoped: true,
          kind: 'select',
          options: [DEFAULT, ...sizeScale(opts).map(sizeSmOption)],
          owns: isSizeSm,
        }
      : {
          id: 'size',
          label: 'Size',
          kind: 'select',
          options: [DEFAULT, ...sizeScale(opts)],
          owns: ownsSize,
        },
  )
  // BUTTONS, not a slider or a nine-deep menu (Sam, 2026-08-17: "a lot of text only has
  // 2 or 3 levels of thickness"): Default · Normal · Bold · Black. Ownership still spans
  // every weight of either era, so a stored intermediate is replaced, never stacked.
  controls.push({
    id: 'weight',
    label: 'Boldness',
    kind: 'select',
    segmented: true,
    options: [DEFAULT, ...WEIGHT_SEGMENTS(usesTextVars(opts))],
    owns: (t) => isWeightVar(t) || WEIGHTS.includes(fontSuffix(t)),
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
    options: [DEFAULT, ...(usesTextVars(opts) ? ALIGN_OPTIONS.map(alignToken) : ALIGN_OPTIONS)],
    owns: (t) => isAlignVar(t) || ALIGNS.includes(textSuffix(t)),
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
  controls.push({ id: 'decoThickness', label: 'Line thickness', kind: 'slider', steps: DECO_THICKNESS_STEPS, defaultOffScale: true, rank: thicknessRank, owns: (t) => t.startsWith('decothick-['), impliesLine: true })
  controls.push(...gradientPair('bggrad', 'Background gradient start', 'Background gradient end'))
  controls.push({
    id: 'frost',
    label: 'Frosted glass',
    kind: 'slider',
    steps: FROST_STEPS,
    rank: pxRank({}),
    owns: (t) => t.startsWith('frost-['),
  })
  controls.push(
    phoneScope(opts)
      ? {
          id: 'pad',
          label: 'Padding',
          phoneScoped: true,
          kind: 'slider',
          steps: PAD_STEPS.map(padSmOption),
          defaultOffScale: true,
          rank: padSmRank,
          owns: isPadSm,
        }
      : {
          id: 'pad',
          label: 'Padding',
          kind: 'slider',
          steps: PAD_STEPS,
          // Off-scale default: a section's '' is "whatever its base wears" (a bar's
          // py-10), measured by padRank so the handle parks at the real inset — never
          // the None end.
          defaultOffScale: true,
          rank: padRank,
          owns: ownsPad,
        },
  )
  // Toggles own the ON form of both eras, so a stored legacy class still reads as ON and
  // flipping it off removes the class rather than stacking a token beside it.
  controls.push({
    id: 'uppercase', label: 'Uppercase', kind: 'toggle',
    onClass: usesTextVars(opts) ? 'case-[uppercase]' : CASE_TOGGLE_CLASS,
    owns: (t) => t === CASE_TOGGLE_CLASS || t === 'case-[uppercase]',
  })
  controls.push({
    id: 'italic', label: 'Italic', kind: 'toggle',
    onClass: usesTextVars(opts) ? 'fstyle-[italic]' : ITALIC_TOGGLE_CLASS,
    owns: (t) => t === ITALIC_TOGGLE_CLASS || t === 'fstyle-[italic]',
  })
  controls.push(...motionControls())
  // 0.22, Sam: "all the styles" — in phone scope, every token-emitting text control
  // becomes its phone twin. Colours/effects pass through phoneTwin untouched (global).
  if (phoneTextScope(opts)) {
    const TWIN = new Set(['weight', 'align', 'leading', 'tracking', 'uppercase', 'italic'])
    return controls.map((c) => (TWIN.has(c.id) ? phoneTwin(c) : c))
  }
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
      options: [DEFAULT, ...opts.fonts.map(fontOption(opts))],
      owns: (t) => isFontVar(t) || (t.startsWith('font-') && !WEIGHTS.includes(fontSuffix(t))),
    })
  }
  controls.push(
    phoneScope(opts)
      ? {
          id: 'size',
          label: 'Size',
          phoneScoped: true,
          kind: 'slider',
          steps: [DEFAULT, ...sizeScale(opts).map(sizeSmOption)],
          defaultOffScale: true,
          rank: sizeSmRank,
          owns: isSizeSm,
        }
      : {
          id: 'size',
          label: 'Size',
          kind: 'slider',
          steps: [DEFAULT, ...sizeScale(opts)],
          defaultOffScale: true,
          rank: textSizeRank,
          owns: ownsSize,
        },
  )
  // BUTTONS (Sam, 2026-08-17): the five-step slider succeeded the nine-step one for the
  // same reason this succeeds it — "a lot of text only has 2 or 3 levels of thickness."
  // Default · Normal · Bold · Black, as one press each.
  controls.push({
    id: 'weight',
    label: 'Thickness',
    kind: 'select',
    segmented: true,
    options: [DEFAULT, ...WEIGHT_SEGMENTS(usesTextVars(opts))],
    owns: (t) => isWeightVar(t) || WEIGHTS.includes(fontSuffix(t)),
  })
  // Sam, 2026-08-05: "allow all text input editor sections to edit these parts" — the gap
  // between stacked lines and between letters. Both were previously fixed by whatever the
  // site declared, with no way to adjust them from the editor.
  controls.push({
    id: 'leading',
    label: 'Line spacing',
    kind: 'slider',
    steps: [DEFAULT, ...(usesTextVars(opts) ? LEADING_OPTIONS.map(leadToken) : LEADING_OPTIONS)],
    defaultOffScale: true,
    rank: leadingRank,
    owns: (t) => isLeadVar(t) || isLeading(t),
  })
  controls.push({
    id: 'tracking',
    label: 'Letter spacing',
    kind: 'slider',
    steps: [DEFAULT, ...(usesTextVars(opts) ? TRACKING_OPTIONS.map(trackToken) : TRACKING_OPTIONS)],
    defaultOffScale: true,
    rank: trackingRank,
    owns: (t) => isTrackVar(t) || isTracking(t),
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
  controls.push({ id: 'decoThickness', label: 'Line thickness', kind: 'slider', steps: DECO_THICKNESS_STEPS, defaultOffScale: true, rank: thicknessRank, owns: (t) => t.startsWith('decothick-['), impliesLine: true })
  controls.push(...motionControls())
  // 0.22, Sam: "all the styles" — in phone scope, every token-emitting text control
  // becomes its phone twin. Colours/effects pass through phoneTwin untouched (global).
  if (phoneTextScope(opts)) {
    const TWIN = new Set(['weight', 'align', 'leading', 'tracking', 'uppercase', 'italic'])
    return controls.map((c) => (TWIN.has(c.id) ? phoneTwin(c) : c))
  }
  if (phoneTextScope(opts)) {
    const TWIN = new Set(['weight', 'align', 'leading', 'tracking', 'uppercase', 'italic'])
    return controls.map((c) => (TWIN.has(c.id) ? phoneTwin(c) : c))
  }
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
/**
 * MEASURED PARKING (bridge 0.25.0): a select from the frame carries what the element
 * actually renders (getComputedStyle), keyed here by control id into that control's
 * rank space. This is the fallback for the case no class-string reader can win — the
 * value lives in site CSS, a breakpoint, or the browser default, so `current` is ''
 * and the handle used to rest mid-scale (six sliders bit on exactly this; the last was
 * Line spacing, Sam 2026-08-18: "i moved right and it got smaller").
 *
 * Phone twins share ids AND rank spaces with their desktop originals (size rem, pad px,
 * leading ratio, tracking em), and the frame measures the live layout — which in phone
 * view IS the phone rendering — so one map serves both.
 */
const MEASURE_BY_ID: Record<string, (m: RegionMeasurements) => number | null> = {
  size: (m) => m.fontSizePx / 16, // rem — textSizeRank / sizeSmRank space
  leading: (m) => (m.lineHeightPx != null && m.fontSizePx > 0 ? m.lineHeightPx / m.fontSizePx : null),
  tracking: (m) => (m.fontSizePx > 0 ? m.letterSpacingPx / m.fontSizePx : null), // em
  pad: (m) => m.padTopPx,
  gap: (m) => m.gapPx,
  iconSize: (m) => m.childWidthPx,
}

export function sliderIndex(
  control: StyleControl,
  current: string,
  measured?: RegionMeasurements,
): { idx: number; label: string; exact: boolean } {
  const steps = sliderSteps(control)
  const middle = Math.floor((steps.length - 1) / 2)
  if (control.kind !== 'slider' || !steps.length) return { idx: 0, label: 'Default', exact: false }

  const exact = steps.findIndex((s) => s.value === current)
  if (exact >= 0) return { idx: exact, label: steps[exact].label, exact: true }

  const rank = control.rank
  const target =
    (current && rank ? rank(current) : null) ??
    // Nothing stored — park on what the page MEASURABLY renders, when the frame told us.
    (measured ? (MEASURE_BY_ID[control.id]?.(measured) ?? null) : null)
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
// (frost left 2026-08-12, minutes after size and for the same reason: backdrop-blur
// only shows through a TRANSLUCENT background over layered content, and chrome bars
// sit opaque in normal flow — a control that reads as doing nothing.)
// The page BACKGROUND (scope 'site') offers ONE colour and nothing else: vertical padding
// there had no useful effect on a full-bleed band around a centred column, so it was pulled
// (Sam, 2026-08-14). Padding lives on the CHROME bars only now, where it is the bar-height
// knob. An allowlist, deliberately — a control added later stays off unless it opts in.
const SITE_SCOPE_CONTROL_IDS = new Set(['bgColor'])
/** The border-side utilities a base can draw its divider with. */
const DIVIDER_SIDES = new Set(['border', 'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y'])
/** The justify utilities that mean "orient this block" — the ones the Alignment control
 *  offers. Deliberately NOT `justify-between`/`-around`/`-evenly`, which are a bar's
 *  intrinsic layout, not an orientation a manager should flip. */
const ALIGNABLE_JUSTIFY = new Set(['justify-start', 'justify-center', 'justify-end'])

/** The gap slider, shared by every region that opts in on a `gap-*` base (the hero row,
 *  the socials group). Extracted so the site/chrome and icons branches use one control. */
const GAP_CONTROL: StyleControl = { id: 'gap', label: 'Gap', kind: 'slider', steps: GAP_STEPS, rank: gapRank, owns: ownsGap }
/** GAP is appended per-region here rather than built per-options, so its phone scope is
 *  read off the LIST it joins: a list whose controls carry phoneScoped was built in
 *  phone scope, and gap twins with them. */
const maybePhoneGap = (controls: StyleControl[]): StyleControl =>
  controls.some((c) => c.phoneScoped) ? phoneTwin(GAP_CONTROL) : GAP_CONTROL

/** The vertical rhythm BETWEEN sections (Sam, 2026-08-14): one slider for the top/bottom
 *  inset every section block wears. Emits `pady-` — top/bottom longhands only — because
 *  a full-width band's horizontal padding lands in gutters that are already empty, the
 *  same reason the page band lost its all-sides control. Owns the base's own `py-*` so
 *  the handle parks at the real rhythm and a pick REPLACES it rather than stacking. */
/*  VERTICAL TOKENS ONLY — deliberately NOT the shared `ownsPad`, which matches every
 *  padding utility including `px-6` and bare `p-4`. A vertical control that owned those
 *  would DELETE a band's side gutters (skeen's sections wear `px-6 pb-24 pt-16`) the
 *  first time someone touched the spacing, and nothing on screen would explain why. */
const TW_PAD_Y_RE = /^p[tby]-(\d+(?:\.\d+)?)$/
const ownsSectionSpacing = (t: string) => t.startsWith('pady-[') || TW_PAD_Y_RE.test(t)
const sectionSpacingRank = (t: string): number | null => {
  if (t === '') return null
  const arb = /^pady-\[(\d{1,3})px\]$/.exec(t)
  if (arb) return Number(arb[1])
  const tw = TW_PAD_Y_RE.exec(t)
  return tw ? Number(tw[1]) * 4 : null
}
const SECTION_SPACING_CONTROL: StyleControl = {
  id: 'sectionSpacing', label: 'Spacing', kind: 'slider',
  steps: PAD_Y_STEPS, rank: sectionSpacingRank, owns: ownsSectionSpacing,
}

/** Tailwind's named max-w caps in px — what a content column's compiled base wears, so
 *  the Width slider can MEASURE it and park the handle on the real value (max-w-3xl →
 *  768). Derived from Tailwind's own scale; an unknown name ranks null → mid-rest. */
const MAX_W_PX: Record<string, number> = {
  'max-w-xs': 320, 'max-w-sm': 384, 'max-w-md': 448, 'max-w-lg': 512, 'max-w-xl': 576,
  'max-w-2xl': 672, 'max-w-3xl': 768, 'max-w-4xl': 896, 'max-w-5xl': 1024,
  'max-w-6xl': 1152, 'max-w-7xl': 1280,
}
/** Does this token cap a width — the base's own (`max-w-3xl`, `max-w-[Npx]`) or the
 *  editor's (`maxw-[Npx]`, `maxw-full`)? Applying must strip BOTH: two caps on one
 *  element is a fight the narrower one always wins. */
const ownsMaxWidth = (t: string) => t.startsWith('maxw-') || t.startsWith('max-w-')
const maxWidthRank = (t: string): number | null => {
  if (t === 'maxw-full' || t === 'max-w-full' || t === 'max-w-none') return 10_000 // past every px step
  const arb = /^(?:maxw|max-w)-\[(\d{3,4})px\]$/.exec(t)
  if (arb) return Number(arb[1])
  return MAX_W_PX[t] ?? null
}
/** Content-column width, offered only where the base actually caps one (max-w-*). */
const CONTENT_WIDTH_CONTROL: StyleControl = {
  id: 'contentWidth', label: 'Width', kind: 'slider',
  steps: CONTENT_WIDTH_STEPS, rank: maxWidthRank, owns: ownsMaxWidth,
}

/**
 * Icon size for an icon group — one value scales every icon (they read `--lse-icon-size`).
 *
 * `defaultOffScale` is load-bearing (Sam, 2026-08-14: "it starts far left and when I move
 * it to the right it gets smaller"). ICON_SIZE_STEPS opens with a `''` "Default" entry,
 * and an un-styled row's value IS `''` — so it matched that entry EXACTLY and pinned the
 * handle to index 0, the far-left end. The first nudge right then applied 12px over icons
 * actually drawn at 18px or 24px. Filtering `''` out of the scale leaves only real,
 * ascending sizes: a row whose base declares its size (`iconsize-[18px]`) parks exactly
 * on it, and one that declares nothing rests mid-scale reading "Default" instead of at an
 * end. Clearing moves to the explicit Reset button. Identical fix, and identical reason,
 * to the text-size ladder of 2026-08-12.
 */
const ICON_SIZE_CONTROL: StyleControl = {
  id: 'iconSize', label: 'Icon size', kind: 'slider', steps: ICON_SIZE_STEPS,
  defaultOffScale: true, rank: iconSizeRank, owns: ownsIconSize,
}

/** Hover colour for an icon GROUP: emits ONLY the `hovercolor-[#hex]` var token (no
 *  `hovercolor` marker class). The var is set on the group and inherited; each icon reads
 *  it in its OWN `:hover` rule, so hovering one icon recolours just that icon — the marker
 *  version would recolour the whole group on any hover. */
const GROUP_HOVER_COLOR_CONTROL: StyleControl = {
  id: 'hoverColor',
  label: 'Hover color',
  kind: 'color',
  owns: (t) => t.startsWith('hovercolor-['),
  hexOf: (cls) =>
    cls.split(/\s+/).map((t) => /^hovercolor-\[(#[0-9a-fA-F]{3,8})\]$/.exec(t)?.[1]).find(Boolean) ?? '',
  toToken: (hex) => (hex ? `hovercolor-[${hex}]` : ''),
}

/**
 * The controls a region gets, filtered by its SCOPE (Sam, 2026-08-12). An element region
 * (no scope) keeps the full set — text styling belongs where the text is. A `'site'`
 * region (the body band) is surface-only: padding + one colour, no text controls (they
 * read as doing nothing on the page). A `'chrome'` region (nav/footer bar) adds geometry
 * (width/height) — a floor a bar can actually show, unlike the always-taller body — plus
 * a Divider-line toggle built from whatever border side its base draws. The site-scope
 * set is an ALLOWLIST, so a control added later stays off site/chrome regions unless it
 * opts in.
 */
export function controlsForRegion(
  controls: StyleControl[],
  region: ManifestStyleRegion,
): StyleControl[] {
  // An icon GROUP (the socials row): a curated, cascading set so every icon stays
  // consistent — size, colour (currentColor), hover colour (per-icon via an inherited
  // var), and the gap between them. NOT the full text set, none of which fits an icon row.
  if (region.scope === 'icons') {
    const iconColor = controls.find((c) => c.id === 'textColor')
    const base = (region.base ?? '').split(/\s+/)
    const isFlexOrGrid = base.some((t) => t === 'flex' || t === 'inline-flex' || t === 'grid' || t === 'inline-grid' || t.startsWith('grid-cols'))
    return [
      ICON_SIZE_CONTROL,
      ...(iconColor ? [{ ...iconColor, label: 'Icon color' }] : []),
      GROUP_HOVER_COLOR_CONTROL,
      ...(isFlexOrGrid && base.some((t) => /^gap-\d/.test(t) || t.startsWith('gap-[')) ? [maybePhoneGap(controls)] : []),
    ]
  }
  if (region.scope !== 'site' && region.scope !== 'chrome') return controls
  const out = controls.filter((c) => SITE_SCOPE_CONTROL_IDS.has(c.id))
  // The chrome bars (header/footer) keep NORMAL all-sides padding — the same 'pad' control
  // an element region has (Sam, 2026-08-14: "I didn't want the padding set up to change for
  // the footer and header bars … normal padding on all directions"). The page background
  // has no padding at all.
  if (region.scope === 'chrome') {
    const pad = controls.find((c) => c.id === 'pad')
    if (pad) out.push(pad)
  }
  // Geometry belongs to the CHROME bars only (Sam, 2026-08-12: "drop height and
  // width from the middle") — the body band stands taller than every height step,
  // so a floor never engages there, and narrowing it reads as a rightward push.
  // Width's '' IS the 100% right end — full-bleed is what a section is by default —
  // so it ranks 100, not off-scale. Height's '' is Auto: what the content needs.
  if (region.scope === 'chrome') out.push({
    id: 'width',
    label: 'Width',
    kind: 'slider',
    steps: SECTION_WIDTH_STEPS,
    rank: (t) => (t === '' ? 100 : Number(/^secw-\[(\d{1,3})%\]$/.exec(t)?.[1] ?? NaN) || null),
    owns: (t) => t.startsWith('secw-['),
  })
  if (region.scope === 'chrome') out.push({
    id: 'height',
    label: 'Height',
    kind: 'slider',
    steps: SECTION_HEIGHT_STEPS,
    defaultOffScale: true,
    rank: (t) => {
      if (t === '') return null
      const m = /^sech-\[(\d{1,4})px\]$/.exec(t)
      return m ? Number(m[1]) : null
    },
    owns: (t) => t.startsWith('sech-['),
  })
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
  // Alignment (Left/Center/Right) for a region whose base declares an ALIGNABLE justify —
  // the hero block, whose columns are content-sized so there's free space to orient them
  // (Sam, 2026-08-13). Gated on justify-start/center/end, NOT any justify-*, so a bar's
  // intrinsic `justify-between` (wordmark left, socials right) never sprouts the control.
  const base = (region.base ?? '').split(/\s+/)
  // Alignment and Gap both act through justify-content / gap, which do NOTHING outside a
  // flex or grid container — so BOTH require the base to actually be flex/grid, or the
  // control would appear and silently do nothing (Sam, 2026-08-14: "the alignment does
  // nothing" — its footer had justify-* but was a block). This is the guard that keeps a
  // control from being offered where it can't take effect.
  const isFlexOrGrid = base.some((t) => t === 'flex' || t === 'inline-flex' || t === 'grid' || t === 'inline-grid' || t.startsWith('grid-cols'))
  if (isFlexOrGrid && base.some((t) => ALIGNABLE_JUSTIFY.has(t)))
    out.push({
      id: 'justify',
      label: 'Alignment',
      kind: 'select',
      options: [DEFAULT, { value: 'just-[start]', label: 'Left' }, { value: 'just-[center]', label: 'Center' }, { value: 'just-[end]', label: 'Right' }],
      owns: (t) => t.startsWith('just-['),
    })
  // Gap between a region's items — same flex/grid requirement, plus a `gap-*` base class
  // (the hero row's name↔portrait gutter, the socials row).
  if (isFlexOrGrid && base.some((t) => /^gap-\d/.test(t) || t.startsWith('gap-['))) out.push(maybePhoneGap(controls))
  // Content width, for a region whose base CAPS one (the mx-auto max-w-* column). Gated
  // on the cap the same way Gap is gated on gap-*: a max-width on an uncapped full-bleed
  // band is a control that reads as doing nothing until you drag far enough to notice —
  // and the chrome bars already have their own % Width.
  if (region.scope === 'site' && base.some((t) => maxWidthRank(t) != null)) out.push(CONTENT_WIDTH_CONTROL)
  // Vertical rhythm, for a site-scope block that declares one (`py-*`). SITE ONLY: a
  // chrome bar's `py-4` is its HEIGHT knob and already belongs to the all-sides Padding
  // control (Sam, 2026-08-14) — offering both would put two controls on one token.
  if (region.scope === 'site' && base.some((t) => ownsSectionSpacing(t))) out.push(SECTION_SPACING_CONTROL)
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

export function buildItemStyleControls(opts?: SiteStyleOptions): StyleControl[] {
  // Per-item Size is a SCALE, and it was the control Sam caught cross-talking on the
  // hero logo — in phone scope it twins like everything else (0.23).
  const scale: StyleControl = { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, rank: pctRank('scale'), owns: (t) => t.startsWith('scale-') && !t.startsWith('scalesm-') }
  return [
    phoneItemScope(opts) ? phoneTwin(scale) : scale,
    { id: 'opacity', label: 'Transparency', kind: 'slider', steps: OPACITY_STEPS, rank: pctRank('opacity'), owns: (t) => t.startsWith('opacity-') },
    { id: 'borderWidth', label: 'Border', kind: 'slider', steps: BORDER_WIDTH_STEPS, rank: pxRank(BORDER_PX), owns: isBorderWidth },
    {
      id: 'borderColor',
      label: 'Border color',
      kind: 'color',
      owns: (t) => colorToken(t)?.prop === 'borderColor',
      // Own hex read/write, so the GENERIC StyleControlRow colour branch renders it —
      // ItemEditor no longer special-cases it (2026-08-12 consolidation). Reads the hex
      // back out of the same resolution the site uses, so the picker reflects what's set.
      hexOf: (cls) => {
        for (const t of cls.split(/\s+/)) {
          const c = colorToken(t)
          if (c?.prop === 'borderColor') return c.value
        }
        return ''
      },
      toToken: (hex) => (hex ? colorClass('border', hex) : ''),
    },
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
 * The BACKGROUND image control set (Sam, 2026-08-18): a slot that fills a screen has no
 * visible frame, so edges, borders, corners, shadow, matte and shape are noise — and
 * Zoom never goes below 100%, because zooming a background OUT uncovers the page it
 * exists to cover. What remains: zoom IN, transparency, and the photographic filters.
 * Chosen by the slot's manifest `background: true` (ComponentSlot, bridge 0.25.1).
 */
export function buildBackgroundItemStyleControls(opts?: SiteStyleOptions): StyleControl[] {
  const zoom: StyleControl = {
    id: 'size',
    label: 'Zoom',
    kind: 'slider',
    steps: SCALE_STEPS.filter((o) => (pctRank('scale')(o.value) ?? 0) >= 100),
    rank: pctRank('scale'),
    owns: (t) => t.startsWith('scale-') && !t.startsWith('scalesm-'),
  }
  return [
    phoneItemScope(opts) ? phoneTwin(zoom) : zoom,
    { id: 'opacity', label: 'Transparency', kind: 'slider', steps: OPACITY_STEPS, rank: pctRank('opacity'), owns: (t) => t.startsWith('opacity-') },
    ...filterControls(),
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
export function buildVideoItemStyleControls(kind: 'embed' | 'file', opts?: SiteStyleOptions): StyleControl[] {
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
  const scale: StyleControl = { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, rank: pctRank('scale'), owns: (t) => t.startsWith('scale-') && !t.startsWith('scalesm-') }
  return [
    phoneItemScope(opts) ? phoneTwin(scale) : scale,
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
  // ANY owned token reads as ON, not just the era's own onClass — half the stored
  // strings still say `uppercase` while the control now writes `case-[uppercase]`, and
  // reading only the onClass would show OFF on a plainly uppercase region (the first
  // click would then stack the token on top of the class).
  if (control.kind === 'toggle') return tokens.some(control.owns) ? 'on' : ''
  // A delta-era seed is kept-base-tokens + delta-tokens, and a base-measuring control
  // (pad, gap, width) owns tokens in BOTH halves — the base's px-6 it measures and the
  // pad-[80px] the manager saved. First-match read the base and the handle lied after
  // every reload (review F3). The discriminator is familyOf: editor-WRITTEN tokens have
  // a family, measured base classes do not — so the manager's saved value (last of the
  // family-bearing) wins, and with none the first owned keeps the legacy measuring
  // semantics (a base's py-10 before its px-6).
  const owned = tokens.filter(control.owns)
  const written = owned.filter((t) => familyOf(t) !== null)
  if (written.length) return written[written.length - 1]
  // Nothing SAVED — the control is measuring the base. A base can wear several owned
  // tokens (skeen's footer: `px-6 py-16`), and first-match parked the handle at
  // whichever came first in the string: px-6, 24px, on a bar visibly wearing 64px —
  // one nudge right SHRANK it (Sam, 2026-08-17; the fourth occurrence of this bug
  // class). Open on the LARGEST measurable owned value instead, so the notch right of
  // the handle is bigger than everything on screen, whatever the base's token order.
  if (control.kind === 'slider' && control.rank && owned.length > 1) {
    let best = owned[0]
    let bestRank = -Infinity
    for (const t of owned) {
      const r = control.rank(t)
      if (r != null && r > bestRank) {
        bestRank = r
        best = t
      }
    }
    return best
  }
  return owned[0] ?? ''
}

/** A new class string with this control set to `value`: every token the control owns is
 *  removed, then the new one appended. Non-owned tokens (layout, spacing, …) are kept in
 *  place. A '' value (Default) or 'off' toggle just removes the owned tokens. */
/** The decoration dressings' token prefixes — ONE list (AGENTS.md rule 4). The three
 *  controls mark themselves `impliesLine` where they are DEFINED; this list exists only
 *  for the sweep below, which has no control in hand for the tokens it must strip. */
const DRESSING_PREFIXES = ['decocolor-[', 'decothick-[', 'underoffset-[']
const isDressing = (t: string) => DRESSING_PREFIXES.some((p) => t.startsWith(p))

/**
 * The DELTA a save stores: only the families whose value differs from the base,
 * canonically compared (font-black ≡ weight-[900]), sentinel-led; an emptied family the
 * base still carries becomes an explicit `lse-not-[fam]`. '' when nothing differs — the
 * row is deleted, never pinned. Family knowledge comes from the bridge (familyOf), the
 * same function that renders deltas, so writer and renderer cannot disagree.
 */
export function deltaFromEffective(base: string, effective: string): string {
  const byFamily = (s: string) => {
    const out = new Map<string, string[]>()
    for (const t of s.split(/\s+/).filter(Boolean)) {
      const fam = familyOf(t)
      if (!fam) continue
      out.set(fam, [...(out.get(fam) ?? []), t])
    }
    return out
  }
  const canonList = (tokens: string[]) => tokens.map(canonToken).sort().join(' ')
  const baseFams = byFamily(base)
  const effFams = byFamily(effective)
  const changed: string[] = []
  for (const fam of new Set([...baseFams.keys(), ...effFams.keys()])) {
    const b = baseFams.get(fam) ?? []
    const e = effFams.get(fam) ?? []
    if (canonList(b) === canonList(e)) continue
    if (e.length) changed.push(...e)
    else changed.push(`lse-not-[${fam}]`)
  }
  return changed.length ? `${DELTA_SENTINEL} ${changed.join(' ')}` : ''
}

export function applyStyleValue(classString: string, control: StyleControl, value: string, base?: string): string {
  const kept = classString.split(/\s+/).filter(Boolean).filter((t) => !control.owns(t))
  // DEFAULT RESTORES THE BASE (delta era): a non-toggle applied with '' brings back the
  // base's own family token, so "Default" genuinely means the site's default rather
  // than "delete the property" — CONNECTING.md rough edge #2. Toggles keep removal:
  // off against a base that is on is a real intent, which the delta spells lse-not.
  if (value === '' && base && control.kind !== 'toggle') {
    const restored = base.split(/\s+/).filter((t) => t && control.owns(t))
    if (restored.length) return [...kept, ...restored].join(' ')
  }
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
/** A token in its CANONICAL spelling: every class-era form rewritten as its token twin,
 *  so `font-black` ≡ `weight-[900]` across the migration. The region's BASE wears
 *  classes while the controls emit tokens — without this, returning a control to the
 *  base's own value reads as a change and pins an override forever. Anything without a
 *  twin (layout, colours, effects) passes through untouched. */
function canonToken(t: string): string {
  const w = WEIGHT_NUM[fontSuffix(t)]
  if (w != null) return `weight-[${w}]`
  if (ALIGNS.includes(textSuffix(t))) return `align-[${textSuffix(t)}]`
  const lead = leadingRank(t)
  if (lead != null && (isLeading(t) || isLeadVar(t))) return `lead-[${lead}]`
  const track = trackingRank(t)
  if (track != null && (isTracking(t) || isTrackVar(t))) return `track-[${track}em]`
  if (t === CASE_TOGGLE_CLASS) return 'case-[uppercase]'
  if (t === ITALIC_TOGGLE_CLASS) return 'fstyle-[italic]'
  if (isTextSize(t)) {
    const rem = textSizeRank(t)
    if (rem != null) return `size-[${Math.round(rem * 16)}px]`
  }
  const size = sizeVarPx(t)
  if (size != null) return `size-[${size}px]`
  return t
}

export function sameClasses(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.split(/\s+/).filter(Boolean).map(canonToken).sort().join(' ')
  return norm(a) === norm(b)
}
