/**
 * Fold a site's CURRENT base classes back into an override written against an older one.
 *
 * A section override REPLACES the region's base — that is what lets a control REMOVE a
 * base token (the Divider toggle strips `border-t`). The cost: the stored string is
 * frozen at the base it was written against, so every later improvement to the site's own
 * design is invisible to any region the manager already styled, with nothing on screen to
 * say so. Skeen's footer gained `grid content-center` and `bg-background`; the stored
 * override predated both, so the contents stayed pinned to the top and the background
 * picker read "none" (Sam, 2026-08-15 — two reports, one cause).
 *
 * The rule: pick up what the manager never touched, never overwrite what they chose.
 * Three cases, decided by the EDITOR'S OWN control ownership rather than by guesswork:
 *
 *   • no control owns the token (layout: `grid`, `content-center`) → ADD it. Nothing the
 *     manager did could have meant to remove it; the editor cannot even express that.
 *   • a control owns it AND the stored string carries a token that same control owns →
 *     SKIP. That is their choice, and re-adding would fight it for the same property.
 *   • a TOGGLE owns it and the stored string carries nothing for it → SKIP. A toggle's
 *     absence is a decision: the Divider control turns a line OFF by storing a string
 *     without `border-t`, so folding the base back in would switch every manager's
 *     divider back on. `includeOwned` overrides this for a human who has read a dry run.
 *   • any OTHER control owns it and the manager set nothing → ADD. "Not set" on a colour,
 *     size or font is not a decision to remove it; it is a gap the design should fill.
 *     This is the distinction that lets skeen's footer pick up the `bg-background` it was
 *     always meant to have without also relighting a divider someone switched off.
 *
 * Returns null when nothing is missing, so an already-current row is never rewritten.
 */
import type { StyleControl } from './style-controls'

/**
 * The utility FAMILY a token belongs to — `tracking-[-0.03em]` and `tracking-tight` are
 * both `tracking`, `!leading-[0.9]` and `leading-[0.95]` are both `leading`.
 *
 * Control ownership alone is not enough to tell "the manager already decided this". A
 * control's `owns` is often an option-list match, so an ARBITRARY value it never offered
 * (`tracking-[-0.03em]`, `font-sorg-font`) reads as unowned — and the base's own value
 * would then be folded in beside the manager's, two classes fighting for one property.
 * Caught on skeen's polaroid captions, 2026-08-15.
 */
function family(token: string): string {
  const bare = token.replace(/^!/, '')
  const cut = bare.indexOf('-[')
  const head = cut === -1 ? bare : bare.slice(0, cut)
  return head.split('-')[0]
}

export function rebaseOverride(
  base: string,
  stored: string,
  controls: StyleControl[],
  opts: { includeOwned?: boolean } = {},
): string | null {
  const storedTokens = stored.split(/\s+/).filter(Boolean)
  const has = new Set(storedTokens)
  const missing: string[] = []

  for (const token of base.split(/\s+/).filter(Boolean)) {
    if (has.has(token)) continue
    // The manager's string already says something about this family — leave it alone,
    // whether or not a control claims to own either side.
    if (storedTokens.some((t) => family(t) === family(token))) continue
    const owner = controls.find((c) => c.owns(token))
    if (owner) {
      if (storedTokens.some((t) => owner.owns(t))) continue // their choice stands
      // A toggle's absence IS its off state — see the docblock.
      if (owner.kind === 'toggle' && !opts.includeOwned) continue
    }
    missing.push(token)
  }
  return missing.length ? [...storedTokens, ...missing].join(' ') : null
}

/** One region whose stored styling predates the site's current design. */
export type DriftedRegion = { key: string; label: string; next: string; adds: string[] }

/**
 * Every styled region that is behind the site's design, with what it would pick up.
 *
 * This is what lets the editor SAY SO. Drift was invisible: the site improved, the region
 * kept rendering the old string, and the only symptom was a control that looked wrong or a
 * layout that would not respond — Sam reported skeen's footer twice, as two separate bugs,
 * before the cause turned out to be one stale override (2026-08-15).
 */
export function driftedRegions(
  regions: { key: string; label: string; base?: string; scope?: string }[],
  values: Record<string, string>,
  controlsFor: (region: { key: string; label: string; base?: string; scope?: string }) => StyleControl[],
): DriftedRegion[] {
  const out: DriftedRegion[] = []
  for (const region of regions) {
    const stored = values[region.key]
    // No stored override means the region already renders the live base — nothing to do.
    if (!region.base || !stored?.trim()) continue
    const next = rebaseOverride(region.base, stored, controlsFor(region))
    if (!next) continue
    const before = new Set(stored.split(/\s+/).filter(Boolean))
    out.push({
      key: region.key,
      label: region.label,
      next,
      adds: next.split(/\s+/).filter((t) => t && !before.has(t)),
    })
  }
  return out
}
