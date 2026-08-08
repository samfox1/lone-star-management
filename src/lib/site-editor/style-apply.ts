/**
 * The editor's style helpers — WHAT REMAINS after the 2026-08-07 consolidation.
 *
 * The resolution machinery and the token grammar moved to `@samfox1/site-bridge`
 * (this file's own comment used to say its semantics "mirror skeen's — change them in
 * both repos or the preview and the live site disagree"; the package IS that shared
 * home now, and the five documented divergences between the two copies died with the
 * move). Re-exported below from the historical path so no consumer changed.
 *
 * What stays is EDITOR-side: the swatch-row builders, which read the site's palette
 * and its saved styles — panel furniture, not contract.
 */
import { canonicalHex } from '@/lib/color'
import type { SiteStyleOptions } from '@samfox1/site-bridge/manifest'
import { colorToken } from '@samfox1/site-bridge/styles'

export {
  MANAGED_STYLE_PROPS,
  colorToken,
  colorClass,
  speedToken,
  isItemKey,
  mergeStyle,
  resolveStyle,
  resolveRegionStyle,
  type ManagedColorProp,
  type ResolvedStyle,
} from '@samfox1/site-bridge/styles'

/** Historical alias: this module named the colour-prop union ManagedStyleProp. */
export type { ManagedColorProp as ManagedStyleProp } from '@samfox1/site-bridge/styles'

/**
 * The site's OWN declared colours, as hexes.
 *
 * A site declares its palette as classes (`text-flash-1`) because those are what its
 * build compiles — but a class name says nothing about what colour it is, so the editor
 * can only offer them as swatches if the site also declares the hex. Sites that don't
 * contribute nothing here rather than guesses.
 */
function paletteColors(options?: SiteStyleOptions): string[] {
  const out: string[] = []
  for (const opt of [...(options?.textColors ?? []), ...(options?.bgColors ?? [])]) {
    const hex = canonicalHex(opt.hex ?? '')
    if (hex && !out.includes(hex)) out.push(hex)
  }
  return out
}

/**
 * The swatch row the colour picker offers: the site's declared palette FIRST, then any
 * other colour already used in its saved styles.
 *
 * Palette first because those are the site's canonical colours — the ones a manager
 * should be reaching for to stay in sync. The used-elsewhere colours follow so a one-off
 * that isn't in the palette is still one click away on the next item.
 */
export function siteSwatches(
  options: SiteStyleOptions | undefined,
  styleValues: Record<string, string>,
  limit = 14,
): string[] {
  const palette = paletteColors(options)
  const extras = usedColors(styleValues, limit).filter((hex) => !palette.includes(hex))
  return [...palette, ...extras].slice(0, limit)
}

/**
 * Every colour already in use across the site's saved styles, most-used first.
 *
 * A palette of 16.7M is precise but not consistent: matching the border you put on one
 * photo three sections ago means remembering its hex. This reads the colours back out of
 * what's already stored, so the editor can offer them as one-click swatches and the site
 * stays in sync with itself.
 *
 * `#FFF` and `#ffffff` are the same colour and collapse to one entry (canonicalised to
 * the long form). Ties keep first-seen order, so the list is stable between renders.
 */
export function usedColors(styleValues: Record<string, string>, limit = 12): string[] {
  const counts = new Map<string, { count: number; order: number }>()
  let seen = 0
  for (const classString of Object.values(styleValues)) {
    for (const token of (classString ?? '').split(/\s+/).filter(Boolean)) {
      const color = colorToken(token)
      if (!color) continue
      const hex = canonicalHex(color.value)
      if (!hex) continue
      const entry = counts.get(hex)
      if (entry) entry.count++
      else counts.set(hex, { count: 1, order: seen++ })
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .slice(0, limit)
    .map(([hex]) => hex)
}
