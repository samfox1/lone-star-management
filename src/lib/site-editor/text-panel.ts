import { styleRegionForField, type ManifestField, type ManifestStyleRegion } from '@/lib/site-editor/manifest'
import { isTextSize } from '@/lib/site-editor/style-controls'

/**
 * What the Text panel lists: every piece of the site that is WORDS.
 *
 * A site declares two separate things that bear on text, and the panel needs both:
 *
 *   • `fields`  — copy the manager TYPES (skeen: the five polaroid captions)
 *   • `styles`  — regions the manager RESTYLES (skeen: the hero wordmark, the nav,
 *                 every section, the footer — eleven of them)
 *
 * Driving the panel off `fields` alone showed five captions on an eleven-region site and
 * nothing else: the wordmark, the nav and the footer were unreachable from the panel
 * whose entire job is the site's text. MOST text on a site is the second kind — it is
 * written into the design, not typed by the manager, but it is still the thing a manager
 * points at when they say "make that bigger".
 *
 * Entries pair by key (or by the field's explicit `styleKey`), so one thing on screen is
 * one row: typeable if a field declared it, styleable if a region did, both when both.
 */
export type TextPanelEntry = {
  /** Stable row id: the field's key when there is one, else the region's. */
  key: string
  label: string
  /** The copy the manager types, or null when the site never declared it editable. */
  field: ManifestField | null
  /** The region that dresses it, or null when the site never declared it styleable. */
  styleRegion: ManifestStyleRegion | null
}

/**
 * Does this region hold TEXT? It must SET TYPE, not merely mention text.
 *
 * The only signal a site gives us is the region's base classes, so this reads them. A
 * region that sets type (a family, a size, a weight, tracking, leading, a casing) is text.
 * One that only positions or paints — `absolute inset-0 object-cover` on a video, a flex
 * container for the polaroid wall — is not.
 *
 * This used to count any `text-*`, on the reasoning that a region colouring or centring
 * text must contain words. That reasoning is wrong, and Sam found the way it is wrong on
 * 2026-08-05: every section WRAPPER on skeen carries `text-center` or `text-foreground`,
 * so the panel offered `shows_section` — a `max-w-6xl … px-6 pb-24 pt-16` container — as
 * if it were the TOUR heading. Setting a size on a wrapper sets font-size on everything
 * inside it, so the whole section grew. "I increase the size it increases the height of
 * the container."
 *
 * Alignment and colour are properties of a box that happens to hold words. A family, a
 * size, a weight, tracking, leading or a casing is someone saying "these are the words".
 * That is the line.
 *
 * Costing a real text region here is cheap — it stays reachable from the Style panel.
 * Offering a container is not: the manager resizes the page and has no way to see why.
 */
const CASING = /^(uppercase|lowercase|capitalize|italic)$/
/** Drop responsive/state variants and the `!` important flag, so `sm:text-[14px]` and
 *  `!leading-none` are read as the utilities they are. */
const bare = (token: string) => token.slice(token.lastIndexOf(':') + 1).replace(/^!/, '')

function setsType(token: string): boolean {
  const t = bare(token)
  // `font-*` is family or weight; both are type. Sizes are delegated to the size control's
  // own predicate so the two can never disagree about what a size looks like.
  return (
    t.startsWith('font-') ||
    t.startsWith('tracking-') ||
    t.startsWith('leading-') ||
    CASING.test(t) ||
    isTextSize(t)
  )
}

export function isTextRegion(region: ManifestStyleRegion): boolean {
  return (region.base ?? '').split(/\s+/).filter(Boolean).some(setsType)
}

export function textPanelEntries(
  fields: ManifestField[] | undefined,
  regions: ManifestStyleRegion[] | undefined,
): TextPanelEntry[] {
  const allRegions = regions ?? []

  // The manager's own copy first — it is what they came to the Text panel for.
  const entries: TextPanelEntry[] = []
  const claimed = new Set<string>()
  for (const f of fields ?? []) {
    if (f.type !== 'text' && f.type !== 'email') continue
    const region = styleRegionForField(f, allRegions)
    if (region) claimed.add(region.key)
    entries.push({ key: f.key, label: f.label, field: f, styleRegion: region })
  }

  // A region NO field speaks for is deliberately not listed. It used to be, as a
  // "Set by the site — restyle only" row, so a manager could restyle text they cannot
  // retype. In practice that filled the Text panel with things that are not text to
  // type: Operator's Tab buttons, Body copy, List rows and Section stamps all sat there
  // saying the same unhelpful sentence (Sam, 2026-08-15). They are already reachable —
  // click the element in the preview and its controls open — which is the one-edit-path-
  // per-thing rule this panel is built on.
  void claimed

  return entries
}
