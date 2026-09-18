import { styleRegionForField, type ManifestField, type ManifestStyleRegion } from '@/lib/site-editor/manifest'

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
  /** The copy the manager types. Every entry pairs to a field — the region-only loop
   *  that used to produce field-less entries is gone (Sam, 2026-08-15: it filled the
   *  Text panel with things that are not text to type). */
  field: ManifestField
  /** The region that dresses it, or null when the site never declared it styleable. */
  styleRegion: ManifestStyleRegion | null
}

export function textPanelEntries(
  fields: ManifestField[] | undefined,
  regions: ManifestStyleRegion[] | undefined,
): TextPanelEntry[] {
  const allRegions = regions ?? []

  // The manager's own copy — it is what they came to the Text panel for. A region NO
  // field speaks for is deliberately not listed here; it used to be, as a "Set by the
  // site — restyle only" row, so a manager could restyle text they cannot retype. In
  // practice that filled the Text panel with things that are not text to type: Operator's
  // Tab buttons, Body copy, List rows and Section stamps all sat there saying the same
  // unhelpful sentence (Sam, 2026-08-15). They are already reachable — click the element
  // in the preview and its controls open — which is the one-edit-path-per-thing rule
  // this panel is built on.
  const entries: TextPanelEntry[] = []
  for (const f of fields ?? []) {
    if (f.type !== 'text' && f.type !== 'email') continue
    // A SITE-WRITTEN field (0.27.0) is stored and published like any other, but the
    // manager sets it by acting on the page — dragging ftbk's icons into an arrangement.
    // Its value is a serialized layout; a text box over it is a way to corrupt it, and
    // this panel is for words someone types.
    if (f.siteWritten) continue
    entries.push({ key: f.key, label: f.label, field: f, styleRegion: styleRegionForField(f, allRegions) })
  }

  return entries
}
