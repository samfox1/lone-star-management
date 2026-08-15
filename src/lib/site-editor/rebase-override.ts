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
 *   • a control owns it and the stored string carries NOTHING for that control → AMBIGUOUS.
 *     It reads identically whether the base gained the token yesterday or the manager
 *     deliberately cleared it — the Divider toggle removes `border-t` by storing a string
 *     without it, and blindly folding the base back in would switch every manager's
 *     divider back on. Skipped unless `includeOwned` says a human has looked.
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
      if (!opts.includeOwned) continue // ambiguous: cleared on purpose, or new to the base?
    }
    missing.push(token)
  }
  return missing.length ? [...storedTokens, ...missing].join(' ') : null
}
