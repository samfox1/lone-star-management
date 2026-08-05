import type { ManifestField, ManifestStyleRegion } from '@/lib/site-editor/manifest'

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
 * Does this region hold TEXT?
 *
 * The only signal a site gives us is the region's base classes, so this reads them: a
 * region that sets type (a family, a size, a weight, tracking, casing, leading) is text.
 * One that only positions or paints — `absolute inset-0 object-cover` on a video, a flex
 * container for the polaroid wall — is not.
 *
 * Deliberately CONSERVATIVE. A false positive puts Font and Size on something with no
 * words in it, which the manager has to learn to ignore; a false negative hides a text
 * area, which they can still reach from the Style panel. So it demands a type-setting
 * utility rather than guessing from the key's name.
 */
// Any `text-*` counts, not just sizes: a region setting text COLOUR or ALIGNMENT is
// telling us it contains words just as surely as one setting a size. `font-*` covers
// family and weight. The rest are unambiguous type properties.
const TYPE_UTILITY = /(^|\s)(font-|text-|tracking-|leading-|uppercase|lowercase|capitalize|italic)/

export function isTextRegion(region: ManifestStyleRegion): boolean {
  return TYPE_UTILITY.test(region.base ?? '')
}

export function textPanelEntries(
  fields: ManifestField[] | undefined,
  regions: ManifestStyleRegion[] | undefined,
): TextPanelEntry[] {
  const allRegions = regions ?? []
  const byKey = new Map(allRegions.map((r) => [r.key, r]))

  // The manager's own copy first — it is what they came to the Text panel for.
  const entries: TextPanelEntry[] = []
  const claimed = new Set<string>()
  for (const f of fields ?? []) {
    if (f.type !== 'text' && f.type !== 'email') continue
    const region = byKey.get(f.styleKey ?? f.key) ?? null
    if (region) claimed.add(region.key)
    entries.push({ key: f.key, label: f.label, field: f, styleRegion: region })
  }

  // Then the site's other text areas — the ones no field speaks for. A region already
  // paired above is NOT repeated: several captions can share one region, and listing it
  // again would say the same thing a sixth time.
  for (const r of allRegions) {
    if (claimed.has(r.key) || !isTextRegion(r)) continue
    entries.push({ key: r.key, label: r.label, field: null, styleRegion: r })
  }

  return entries
}
