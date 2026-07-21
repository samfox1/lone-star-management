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

export type StyleOption = { value: string; label: string }

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
