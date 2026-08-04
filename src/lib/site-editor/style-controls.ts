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
import { colorToken } from '@/lib/site-editor/style-apply'

export type StyleOption = {
  value: string
  label: string
  /** For a COLOUR option, the hex it renders as. The value is a class (`text-flash-1`)
   *  whose colour lives in the site's own CSS, so the editor can't know what it looks
   *  like — a site that declares this gets its palette offered as real swatches in the
   *  colour picker. Optional: a site that omits it simply isn't offered there. */
  hex?: string
}

/** A site's declared design palette (from its manifest). Colours + fonts are the site's
 *  OWN tokens (skeen: `bg-flash-1`, `font-momo`), so the dropdowns offer real, compiled
 *  classes rather than generic guesses. */
export type SiteStyleOptions = {
  fonts?: StyleOption[]
  textColors?: StyleOption[]
  bgColors?: StyleOption[]
}

export type StyleControl =
  | { id: string; label: string; kind: 'select'; options: StyleOption[]; owns: (token: string) => boolean }
  | { id: string; label: string; kind: 'toggle'; onClass: string; owns: (token: string) => boolean }
  /** A slider over ORDERED steps (size, transparency). Reads/applies exactly like a select —
   *  one owned utility swapped, the rest preserved — but the manager drags a continuous scale
   *  instead of picking from a menu. `steps` runs low→high; the `''` step is the default. */
  | { id: string; label: string; kind: 'slider'; steps: StyleOption[]; owns: (token: string) => boolean }
  /** A full colour palette (hue slider + saturation/brightness square + hex field). The owned
   *  utility is an arbitrary `border-[#hex]`, so the value is a free hex rather than one of a
   *  fixed option list — which is why this kind carries no `options`/`steps`. */
  | { id: string; label: string; kind: 'color'; owns: (token: string) => boolean }

// Tailwind's fixed scales, used to tell text-* size from text-* colour from text-* align
// (all three share the `text-` prefix), and font-* weight from font-* family.
const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']
const WEIGHTS = ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black']
const ALIGNS = ['left', 'center', 'right', 'justify', 'start', 'end']

const textSuffix = (t: string) => (t.startsWith('text-') ? t.slice(5) : '')
const fontSuffix = (t: string) => (t.startsWith('font-') ? t.slice(5) : '')

// A short, friendly scale rather than Tailwind's full 13 steps — five is plenty for a
// no-code panel. `owns` (below) still detects any size the site's base classes use, and
// the control surfaces that current value even when it's outside this list.
const SIZE_OPTIONS: StyleOption[] = [
  { value: 'text-sm', label: 'Small' },
  { value: 'text-lg', label: 'Medium' },
  { value: 'text-2xl', label: 'Large' },
  { value: 'text-4xl', label: 'XL' },
  { value: 'text-6xl', label: 'Huge' },
]
const WEIGHT_OPTIONS: StyleOption[] = [
  { value: 'font-normal', label: 'Normal' },
  { value: 'font-semibold', label: 'Semibold' },
  { value: 'font-bold', label: 'Bold' },
  { value: 'font-black', label: 'Black' },
]
const ALIGN_OPTIONS: StyleOption[] = [
  { value: 'text-left', label: 'Left' },
  { value: 'text-center', label: 'Center' },
  { value: 'text-right', label: 'Right' },
]
const DEFAULT: StyleOption = { value: '', label: 'Default' }

/**
 * The controls to show for a region, given the site's declared palette. Size / boldness /
 * alignment / uppercase / italic are universal; font + colours only appear when the site
 * declares them (their classes are the site's own, so the editor can't invent them).
 */
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
    options: [DEFAULT, ...SIZE_OPTIONS],
    owns: (t) => SIZES.includes(textSuffix(t)),
  })
  controls.push({
    id: 'weight',
    label: 'Boldness',
    kind: 'select',
    options: [DEFAULT, ...WEIGHT_OPTIONS],
    owns: (t) => WEIGHTS.includes(fontSuffix(t)),
  })
  if (opts?.textColors?.length) {
    const own = new Set(opts.textColors.map((o) => o.value))
    controls.push({
      id: 'textColor',
      label: 'Text color',
      kind: 'select',
      options: [DEFAULT, ...opts.textColors],
      owns: (t) => own.has(t),
    })
  }
  if (opts?.bgColors?.length) {
    const own = new Set(opts.bgColors.map((o) => o.value))
    controls.push({
      id: 'bgColor',
      label: 'Background',
      kind: 'select',
      options: [DEFAULT, ...opts.bgColors],
      owns: (t) => own.has(t),
    })
  }
  controls.push({
    id: 'align',
    label: 'Alignment',
    kind: 'select',
    options: [DEFAULT, ...ALIGN_OPTIONS],
    owns: (t) => ALIGNS.includes(textSuffix(t)),
  })
  controls.push({ id: 'uppercase', label: 'Uppercase', kind: 'toggle', onClass: 'uppercase', owns: (t) => t === 'uppercase' })
  controls.push({ id: 'italic', label: 'Italic', kind: 'toggle', onClass: 'italic', owns: (t) => t === 'italic' })
  return controls
}

/* ── Per-ITEM visual controls (images + videos) ──────────────────────────────────────
 * The per-item editor styles one image/video, not a text region: size (scale), transparency
 * (opacity), a border (width + colour), rounded corners, and a shadow. Same StyleControl
 * model + read/apply logic as the text controls — different owned utilities. Every option
 * VALUE is a literal here so Tailwind compiles it (the panel preview renders them live); the
 * SITE must safelist the same set for them to show on the published page. */
/** A percentage slider scale in `step`% increments, low → high, with 100% as the DEFAULT
 *  (`''` — no class). Values are safelisted in globals.css (@source inline), so they compile
 *  even though they're built here rather than written as literals. */
function pctSteps(prefix: string, from: number, to: number, step: number): StyleOption[] {
  const out: StyleOption[] = []
  for (let n = from; n <= to; n += step) {
    out.push({ value: n === 100 ? '' : `${prefix}-${n}`, label: `${n}%` })
  }
  return out
}
// Size runs 50%→150% (100% in the MIDDLE — drag left to shrink, right to grow); transparency
// runs 5%→100% (solid at the RIGHT end). Both in 5% steps.
const SCALE_STEPS = pctSteps('scale', 50, 150, 5)
const OPACITY_STEPS = pctSteps('opacity', 5, 100, 5)
/** A px slider scale in `step`px increments, `''` (off) first, then arbitrary-value classes
 *  (`border-[3px]`, `rounded-[6px]`). Arbitrary values give every-1/2px granularity the named
 *  Tailwind widths/radii don't; they're safelisted in globals.css so the preview compiles. */
function pxSteps(prefix: string, from: number, to: number, step: number, zeroLabel: string, extra: StyleOption[] = []): StyleOption[] {
  const out: StyleOption[] = [{ value: '', label: zeroLabel }]
  for (let n = from; n <= to; n += step) out.push({ value: `${prefix}-[${n}px]`, label: `${n}px` })
  return [...out, ...extra]
}
// Border width every 1px (0→12); corners every 2px (0→24) plus a Circle at the end.
const BORDER_WIDTH_STEPS = pxSteps('border', 1, 12, 1, 'None')
const RADIUS_STEPS = pxSteps('rounded', 2, 24, 2, 'Square', [{ value: 'rounded-full', label: 'Circle' }])
const SHADOW_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  { value: 'shadow-sm', label: 'XS' },
  { value: 'shadow', label: 'S' },
  { value: 'shadow-md', label: 'M' },
  { value: 'shadow-lg', label: 'L' },
  { value: 'shadow-xl', label: 'XL' },
  { value: 'shadow-2xl', label: 'XXL' },
]
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
export function buildItemStyleControls(): StyleControl[] {
  return [
    { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, owns: (t) => t.startsWith('scale-') },
    { id: 'opacity', label: 'Transparency', kind: 'slider', steps: OPACITY_STEPS, owns: (t) => t.startsWith('opacity-') },
    { id: 'borderWidth', label: 'Border', kind: 'slider', steps: BORDER_WIDTH_STEPS, owns: isBorderWidth },
    { id: 'borderColor', label: 'Border color', kind: 'color', owns: (t) => colorToken(t)?.prop === 'borderColor' },
    { id: 'radius', label: 'Corners', kind: 'slider', steps: RADIUS_STEPS, owns: isRadius },
    { id: 'shadow', label: 'Shadow', kind: 'slider', steps: SHADOW_STEPS, owns: isShadow },
  ]
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
    owns: (t) => t.startsWith('opacity-'),
  }
  if (kind === 'file') {
    return [
      { id: 'speed', label: 'Speed', kind: 'slider', steps: SPEED_STEPS, owns: (t) => t.startsWith('speed-') },
      opacity,
    ]
  }
  return [
    { id: 'size', label: 'Size', kind: 'slider', steps: SCALE_STEPS, owns: (t) => t.startsWith('scale-') },
    opacity,
    { id: 'radius', label: 'Corners', kind: 'slider', steps: RADIUS_STEPS, owns: isRadius },
    { id: 'shadow', label: 'Shadow', kind: 'slider', steps: SHADOW_STEPS, owns: isShadow },
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
export function applyStyleValue(classString: string, control: StyleControl, value: string): string {
  const kept = classString.split(/\s+/).filter(Boolean).filter((t) => !control.owns(t))
  if (control.kind === 'toggle') {
    if (value === 'on') kept.push(control.onClass)
  } else if (value) {
    kept.push(value)
  }
  return kept.join(' ')
}
