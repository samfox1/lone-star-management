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
      owns: (token: string) => boolean
    }
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
/** A font SIZE token: one of Tailwind's named steps, or an arbitrary clamp() the size
 *  slider emits. Must own BOTH — a site storing the old `text-4xl` needs it REPLACED
 *  when a new size is picked, not left behind for source order to arbitrate. */
const isTextSize = (t: string) => SIZES.includes(textSuffix(t)) || /^text-\[clamp\(/.test(t)
const fontSuffix = (t: string) => (t.startsWith('font-') ? t.slice(5) : '')

// Tailwind's FULL size scale. It was five friendly steps ("Small…Huge"), which reads well
// in a menu and is too coarse on a slider — Sam asked for roughly double the stops so he
// can land between them. The labels stay plain-word at the ends and fall back to the
// Tailwind name in the middle, where "Large-ish" would be worse than `2xl`.
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
// SAFELIST: like everything else here, the SITE must safelist these or Tailwind compiles
// nothing and the slider silently does nothing. See the header.
const SIZE_OPTIONS: StyleOption[] = [
  { value: 'text-[clamp(0.7rem,1.6vw,0.75rem)]', label: 'XS' },
  { value: 'text-[clamp(0.78rem,1.9vw,0.875rem)]', label: 'Small' },
  { value: 'text-[clamp(0.85rem,2.2vw,1rem)]', label: 'Base' },
  { value: 'text-[clamp(0.95rem,2.6vw,1.125rem)]', label: 'Medium' },
  { value: 'text-[clamp(1rem,3vw,1.25rem)]', label: 'XL' },
  { value: 'text-[clamp(1.15rem,3.6vw,1.5rem)]', label: 'Large' },
  { value: 'text-[clamp(1.3rem,4.4vw,1.875rem)]', label: '3xl' },
  { value: 'text-[clamp(1.5rem,5.2vw,2.25rem)]', label: '4xl' },
  { value: 'text-[clamp(1.75rem,6.5vw,3rem)]', label: '5xl' },
  { value: 'text-[clamp(2rem,8vw,3.75rem)]', label: 'Huge' },
  { value: 'text-[clamp(2.25rem,9.5vw,4.5rem)]', label: '7xl' },
  { value: 'text-[clamp(2.6rem,12vw,6rem)]', label: '8xl' },
  { value: 'text-[clamp(3rem,15vw,8rem)]', label: 'Giant' },
]
/**
 * LINE HEIGHT, emitted with Tailwind's `!` important prefix.
 *
 * Two things fight it otherwise. Tailwind's `text-*` size utilities set font-size AND
 * line-height together, so picking a Size would silently re-loosen the lines. And a site
 * may pin a line-height structurally on a parent (skeen's polaroid strip does, at
 * `.strip > p`, which outranks a plain utility class) precisely so a half-styled caption
 * cannot come out loose. `!` says the manager's explicit choice beats both — which is the
 * right precedence, and the only one that makes this control feel like it works.
 */
const LEADING_OPTIONS: StyleOption[] = [
  // The bottom four are arbitrary values, and deliberately BELOW 1.0: a site may default
  // tighter than `leading-none`, and a scale whose tight end is looser than what the page
  // already shows reads as broken — the manager drags toward "tighter" and it loosens.
  //
  // Every value here must be safelisted by the rendering site (skeen does, in globals.css)
  // or the class compiles to nothing and the slider silently does nothing.
  { value: '!leading-[0.8]', label: '0.8' },
  { value: '!leading-[0.85]', label: '0.85' },
  { value: '!leading-[0.9]', label: '0.9' },
  { value: '!leading-[0.95]', label: '0.95' },
  { value: '!leading-none', label: '1.0' },
  { value: '!leading-[1.1]', label: '1.1' },
  { value: '!leading-tight', label: '1.25' },
  { value: '!leading-snug', label: '1.375' },
  { value: '!leading-normal', label: '1.5' },
  { value: '!leading-relaxed', label: '1.625' },
  { value: '!leading-loose', label: '2.0' },
]

/** LETTER SPACING. No `!` needed: nothing else in the vocabulary sets letter-spacing, so a
 *  plain utility already wins over an inherited value from a parent. */
const TRACKING_OPTIONS: StyleOption[] = [
  // Named Tailwind steps interleaved with arbitrary em values, so the gaps between the
  // named ones — which are wide — become adjustable. Same safelist requirement as leading.
  { value: 'tracking-[-0.08em]', label: '-0.08' },
  { value: 'tracking-[-0.06em]', label: '-0.06' },
  { value: 'tracking-tighter', label: '-0.05' },
  { value: 'tracking-[-0.04em]', label: '-0.04' },
  { value: 'tracking-[-0.03em]', label: '-0.03' },
  { value: 'tracking-tight', label: '-0.025' },
  { value: 'tracking-[-0.01em]', label: '-0.01' },
  { value: 'tracking-normal', label: '0' },
  { value: 'tracking-wide', label: '0.025' },
  { value: 'tracking-wider', label: '0.05' },
  { value: 'tracking-widest', label: '0.1' },
]

const isLeading = (t: string) => t.startsWith('leading-') || t.startsWith('!leading-')
const isTracking = (t: string) => t.startsWith('tracking-') || t.startsWith('!tracking-')

// Every Tailwind weight, not four. A variable font renders the in-between ones properly,
// and on a slider the missing stops are exactly where a manager wants to sit.
const WEIGHT_OPTIONS: StyleOption[] = [
  { value: 'font-thin', label: 'Thin' },
  { value: 'font-extralight', label: 'Extra light' },
  { value: 'font-light', label: 'Light' },
  { value: 'font-normal', label: 'Normal' },
  { value: 'font-medium', label: 'Medium' },
  { value: 'font-semibold', label: 'Semibold' },
  { value: 'font-bold', label: 'Bold' },
  { value: 'font-extrabold', label: 'Extra bold' },
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
    owns: isTextSize,
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
    steps: [DEFAULT, ...SIZE_OPTIONS],
    defaultOffScale: true,
    owns: isTextSize,
  })
  controls.push({
    id: 'weight',
    label: 'Thickness',
    kind: 'slider',
    steps: [DEFAULT, ...WEIGHT_OPTIONS],
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
    owns: isLeading,
  })
  controls.push({
    id: 'tracking',
    label: 'Letter spacing',
    kind: 'slider',
    steps: [DEFAULT, ...TRACKING_OPTIONS],
    defaultOffScale: true,
    owns: isTracking,
  })
  return controls
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
