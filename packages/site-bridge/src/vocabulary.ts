/**
 * THE STYLE VOCABULARY — the option tables behind every editor control, AS DATA
 * (2026-08-07 deepening, candidate 3). These tables are contract, not editor
 * furniture: tokens.css — append-only FOREVER, because deployed sites compile it while
 * stored styles reference it at runtime — is generated from exactly this module, so
 * the vocabulary lives beside the sheet it produces and a package publish can never
 * lag its own tokens. The editor imports these tables and adds its machinery (control
 * kinds, owns-matchers, rank functions) on top; the coming site-kit reads the same
 * ladders instead of the editor being the only party who knows them.
 *
 * ORIGIN TAGS matter: section overrides lift only colours to inline style, item
 * overlays lift the whole owned vocabulary — so the same token can need CSS in one
 * context and none in the other. `classVocabulary()` judges each family in ITS context.
 *
 * TEXT_SIZES (the fluid ladder) lives in ./styles beside fluidizeSizes, which consumes
 * it; it joins the section families below.
 */
import type { StyleOption } from "./manifest";
import { TEXT_SIZES, resolveRegionStyle, resolveStyle } from "./styles";

// Every Tailwind weight, not four. A variable font renders the in-between ones properly,
// and on a slider the missing stops are exactly where a manager wants to sit.
export const WEIGHT_OPTIONS: StyleOption[] = [
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
export const ALIGN_OPTIONS: StyleOption[] = [
  { value: 'text-left', label: 'Left' },
  { value: 'text-center', label: 'Center' },
  { value: 'text-right', label: 'Right' },
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
export const LEADING_OPTIONS: StyleOption[] = [
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
export const TRACKING_OPTIONS: StyleOption[] = [
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


/* ── Measuring an owned token ────────────────────────────────────────────────────────
 * Each `rank` turns a class into a number on its own scale, so sliderIndex can place a
 * value the scale does not literally contain. They are deliberately conservative: an
 * unrecognised shape returns null and the slider falls back to its resting position
 * rather than guessing a position that would be wrong in an invisible way.
 */



/** The case + emphasis toggles' one-token vocabulary. */
export const CASE_TOGGLE_CLASS = "uppercase";
export const ITALIC_TOGGLE_CLASS = "italic";

/** A percentage slider scale in `step`% increments, low → high, with 100% as the DEFAULT
 *  (`''` — no class). Values are safelisted via tokens.css, so they compile even though
 *  they're built here rather than written as literals. (Moved VERBATIM from the editor —
 *  the first cut reinvented this with an "Off" entry and two tests caught it, which is
 *  what verbatim moves are for.) */
function pctSteps(prefix: string, from: number, to: number, step: number): StyleOption[] {
  const out: StyleOption[] = []
  for (let n = from; n <= to; n += step) {
    out.push({ value: n === 100 ? '' : `${prefix}-${n}`, label: `${n}%` })
  }
  return out
}
// Size runs 50%→150% (100% in the MIDDLE — drag left to shrink, right to grow); transparency
// runs 5%→100% (solid at the RIGHT end). Both in 5% steps.

export const SCALE_STEPS = pctSteps('scale', 25, 175, 5)
export const OPACITY_STEPS = pctSteps('opacity', 5, 100, 5)
/** A px slider scale in `step`px increments, `''` (off) first, then arbitrary-value classes
 *  (`border-[3px]`, `rounded-[6px]`). Arbitrary values give every-1/2px granularity the named
 *  Tailwind widths/radii don't; they're safelisted in globals.css so the preview compiles. */
function pxSteps(prefix: string, from: number, to: number, step: number, zeroLabel: string, extra: StyleOption[] = []): StyleOption[] {
  const out: StyleOption[] = [{ value: '', label: zeroLabel }]
  for (let n = from; n <= to; n += step) out.push({ value: `${prefix}-[${n}px]`, label: `${n}px` })
  return [...out, ...extra]
}
// Border width every 1px (0→12); corners every 2px (0→24) plus a Circle at the end.
export const BORDER_WIDTH_STEPS = pxSteps('border', 1, 16, 1, 'None')
export const RADIUS_STEPS = pxSteps('rounded', 2, 48, 2, 'Square', [{ value: 'rounded-full', label: 'Circle' }])
/* ── Slice-1 visual effects (2026-08-10, Sam: "more features for text, images,
 * videos"). ALL of these lift to inline style, which is the point: they work on every
 * already-deployed site the moment the editor offers them, with nothing to recompile.
 * Filters share ONE CSS property, so the resolver composes them (see styles.ts). */

/** Filter families: token `<prefix>-N` → `fn(N%)`. 100 is the no-op for the three that
 *  have one; grayscale/sepia/blur rest at zero, expressed as '' (no token). */
export const GRAYSCALE_STEPS = pctSteps0('bw', 0, 100, 5)
export const SEPIA_STEPS = pctSteps0('sepia', 0, 100, 5)
export const BRIGHTNESS_STEPS = pctSteps('brightness', 25, 175, 5)
export const CONTRAST_STEPS = pctSteps('contrast', 25, 175, 5)
export const SATURATE_STEPS = pctSteps('saturate', 0, 200, 5)
export const BLUR_STEPS = pxSteps('soften', 1, 16, 1, 'None')

/** Tilt: a few degrees either way — scattered-polaroid energy, not rotation as layout.
 *  0° sits in the MIDDLE, like Size. Negative degrees need the bracket form. */
export const TILT_STEPS: StyleOption[] = Array.from({ length: 31 }, (_, i) => {
  const deg = i - 15
  return { value: deg === 0 ? '' : `tilt-[${deg}deg]`, label: `${deg}°` }
})

/** Crop fit: how the media fills its frame, and which edge survives a crop. */
export const FIT_STEPS: StyleOption[] = [
  { value: '', label: 'Default' },
  { value: 'fit-cover', label: 'Fill the frame' },
  { value: 'fit-contain', label: 'Fit inside' },
]
export const FIT_POSITIONS: StyleOption[] = [
  { value: '', label: 'Center' },
  { value: 'fit-top', label: 'Top' },
  { value: 'fit-bottom', label: 'Bottom' },
  { value: 'fit-left', label: 'Left' },
  { value: 'fit-right', label: 'Right' },
]

/** Text shadow as a DEPTH ladder (1–8, each a computed offset+blur). A ladder, not
 *  named presets, because every text slider owes ≥9 stops (Sam's granularity rule,
 *  pinned in text-tools-styling). The shadow is BLACK: on a dark site it reads subtle
 *  to invisible by physics, which is what Glow is for — the two are separate sliders
 *  (Sam, 2026-08-10: "glow should be its own slider") and they COMPOSE, since CSS
 *  text-shadow takes a list. */
export const TEXT_SHADOW_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `textshadow-${i + 1}`, label: `${i + 1}` })),
]

/** Glow: a currentColor halo that follows the text's own colour — the dark-site
 *  counterpart to the black drop shadow. Its own family, its own slider. */
export const TEXT_GLOW_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `textglow-${i + 1}`, label: `${i + 1}` })),
]

/** Outline text: a stroke around the letters, riding the text colour. Half-pixel steps
 *  — strokes are a continuum, and 0.5px renders distinctly on every modern display. */
export const TEXT_STROKE_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  ...Array.from({ length: 12 }, (_, i) => {
    const px = (i + 1) / 2
    return { value: `textstroke-[${px}px]`, label: `${px}px` }
  }),
]

/* ── Slice-2 (2026-08-11): decoration toggles, gradients, shapes, feather, frost,
 * padding. Still ALL inline-lift — no site recompiles anything. */

export const UNDERLINE_TOGGLE = 'underline'
export const STRIKE_TOGGLE = 'line-through'

/** Image (and embed-box) cutout shapes — clip-path presets. */
export const SHAPE_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  { value: 'shape-circle', label: 'Circle' },
  { value: 'shape-arch', label: 'Arch' },
  { value: 'shape-pill', label: 'Pill' },
  { value: 'shape-diagonal', label: 'Diagonal' },
]

/** Feathered edges: N is how much of the image fades out at the rim (a mask). */
export const FEATHER_STEPS = pctSteps0('feather', 0, 60, 5)

/** Frosted glass: blur whatever is BEHIND the region (bars, overlays). */
export const FROST_STEPS = pxSteps('frost', 1, 24, 1, 'None')

/** Breathing room inside a region — the matte around an image, the inset of a bar. */
export const PAD_STEPS = pxSteps('pad', 2, 64, 2, 'None')

/** Freeform two-hex gradients (`textgrad-[#a_#b]`, `bggrad-[#a_#b]`) — like the colour
 *  tokens, no build can compile 16.7M pairs, so they were never classes. The single
 *  options below exist for the isomorphism probe, not as a menu. */
export const TEXT_GRADIENT_PROBE: StyleOption[] = [{ value: 'textgrad-[#ff0000_#0000ff]', label: 'probe' }]
export const BG_GRADIENT_PROBE: StyleOption[] = [{ value: 'bggrad-[#ff0000_#0000ff]', label: 'probe' }]

/** pctSteps with ZERO as the resting default ('' — no token), for effects that are off
 *  until asked for (B&W, sepia), unlike scale/opacity whose neutral is 100%. */
function pctSteps0(prefix: string, from: number, to: number, step: number): StyleOption[] {
  const out: StyleOption[] = []
  for (let n = from; n <= to; n += step) {
    out.push({ value: n === 0 ? '' : `${prefix}-${n}`, label: `${n}%` })
  }
  return out
}

export const SHADOW_STEPS: StyleOption[] = [
  { value: '', label: 'None' },
  { value: 'shadow-sm', label: 'XS' },
  { value: 'shadow', label: 'S' },
  { value: 'shadow-md', label: 'M' },
  { value: 'shadow-lg', label: 'L' },
  { value: 'shadow-xl', label: 'XL' },
  { value: 'shadow-2xl', label: 'XXL' },
]

/** Every family, tagged with the lift context it is emitted for. */
export const VOCABULARY: { id: string; origin: "section" | "item"; options: StyleOption[] }[] = [
  { id: "size", origin: "section", options: TEXT_SIZES },
  { id: "weight", origin: "section", options: WEIGHT_OPTIONS },
  { id: "align", origin: "section", options: ALIGN_OPTIONS },
  { id: "leading", origin: "section", options: LEADING_OPTIONS },
  { id: "tracking", origin: "section", options: TRACKING_OPTIONS },
  { id: "case", origin: "section", options: [{ value: CASE_TOGGLE_CLASS, label: "Uppercase" }] },
  { id: "italic", origin: "section", options: [{ value: ITALIC_TOGGLE_CLASS, label: "Italic" }] },
  { id: "scale", origin: "item", options: SCALE_STEPS },
  { id: "opacity", origin: "item", options: OPACITY_STEPS },
  { id: "borderWidth", origin: "item", options: BORDER_WIDTH_STEPS },
  { id: "radius", origin: "item", options: RADIUS_STEPS },
  { id: "shadow", origin: "item", options: SHADOW_STEPS },
  { id: "grayscale", origin: "item", options: GRAYSCALE_STEPS },
  { id: "sepia", origin: "item", options: SEPIA_STEPS },
  { id: "brightness", origin: "item", options: BRIGHTNESS_STEPS },
  { id: "contrast", origin: "item", options: CONTRAST_STEPS },
  { id: "saturate", origin: "item", options: SATURATE_STEPS },
  { id: "soften", origin: "item", options: BLUR_STEPS },
  { id: "tilt", origin: "item", options: TILT_STEPS },
  { id: "fit", origin: "item", options: FIT_STEPS },
  { id: "fitPosition", origin: "item", options: FIT_POSITIONS },
  { id: "textShadow", origin: "section", options: TEXT_SHADOW_STEPS },
  { id: "textGlow", origin: "section", options: TEXT_GLOW_STEPS },
  { id: "underline", origin: "section", options: [{ value: UNDERLINE_TOGGLE, label: "Underline" }] },
  { id: "strike", origin: "section", options: [{ value: STRIKE_TOGGLE, label: "Strikethrough" }] },
  { id: "textGradient", origin: "section", options: TEXT_GRADIENT_PROBE },
  { id: "bgGradient", origin: "section", options: BG_GRADIENT_PROBE },
  { id: "frost", origin: "section", options: FROST_STEPS },
  { id: "pad", origin: "section", options: PAD_STEPS },
  { id: "shape", origin: "item", options: SHAPE_STEPS },
  { id: "feather", origin: "item", options: FEATHER_STEPS },
  { id: "textStroke", origin: "section", options: TEXT_STROKE_STEPS },
];

/** Does this token survive AS A CLASS in the context it is emitted for? Section
 *  overrides route through merge + the colour-only lift (what a site's server render
 *  does); item overlays take the full lift. */
function survivesAsClass(token: string, origin: "section" | "item"): boolean {
  if (origin === "item") return resolveStyle(token).className === token;
  return resolveRegionStyle("vocabulary_probe", "", token).className === token;
}

/**
 * The classes a site must COMPILE: every emitted token that survives resolution as a
 * class in its own context, plus the legacy named sizes as a belt (fluidizeSizes
 * translates them at resolve time; they cost nothing). This is tokens.css's content —
 * the repo script wraps it in @source lines and maintains the append-only baseline.
 */
export function classVocabulary(legacySizes: string[]): string[] {
  const vocab = new Set<string>();
  for (const family of VOCABULARY) {
    for (const opt of family.options) {
      for (const part of opt.value.split(/\s+/).filter(Boolean)) {
        if (survivesAsClass(part, family.origin)) vocab.add(part);
      }
    }
  }
  for (const legacy of legacySizes) vocab.add(legacy);
  return [...vocab].sort();
}
