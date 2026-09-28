/**
 * LINK stored colours to the Brand page colours they already are (bridge 0.42.0).
 *
 * Until 0.42 a brand swatch saved a copy of its hex (`text-[#f4f1ea]`), so every region a
 * manager painted Cream stayed that hex forever, whatever the Brand page later said. New
 * picks now save the brand token (`text-[brand-cream_#f4f1ea]` → `var(--brand-cream,
 * #f4f1ea)`). This is the one-off catch-up for the picks made before that: a plain text /
 * background / border hex that EQUALS a brand colour becomes that colour's token.
 *
 * Deliberately narrow. Only the exact token shapes the editor writes and the site lifts;
 * only an exact colour match (a translucent Cream is not Cream); a colour the applier would
 * drop (bad key or hex) is never written; every other token in the string is left as it
 * was, in place. The first brand colour of a shared hex wins, which is the one the editor's
 * swatch row shows (mergeSwatches keeps the first).
 *
 * Pure. `scripts/link-brand-colors.ts` reads the rows and writes the plan.
 */
import { canonicalHex } from '@/lib/color'
import { cleanClassText } from '@/lib/site-editor/save'
import { colorClass, colorToken, isBrandColorKey, type ManagedColorProp } from '@samfox1/site-bridge'

export type BrandColorRef = { key: string; name: string; hex: string }
export type TokenLink = { from: string; to: string; key: string; name: string }

const PREFIX: Record<ManagedColorProp, 'text' | 'bg' | 'border'> = {
  color: 'text',
  backgroundColor: 'bg',
  borderColor: 'border',
}

/** One class string with each plain colour hex that IS a brand colour rewritten as that
 *  colour's brand token, and what was linked. null when nothing changes. */
export function linkBrandColors(
  classString: string,
  colors: readonly BrandColorRef[],
): { next: string; links: TokenLink[] } | null {
  const byHex = new Map<string, BrandColorRef & { hex: string }>()
  for (const c of colors) {
    const hex = canonicalHex(c.hex)
    // Only a colour the applier would paint: a real hex and a key that passes the brand
    // key rule (the applier drops anything else).
    if (!hex || !isBrandColorKey(c.key) || byHex.has(hex)) continue
    byHex.set(hex, { ...c, hex })
  }
  const links: TokenLink[] = []
  const tokens = classString.split(/\s+/).filter(Boolean)
  const next = tokens.map((t) => {
    const read = colorToken(t)
    if (!read || read.kind !== 'hex') return t
    const hit = byHex.get(canonicalHex(read.hex))
    if (!hit) return t
    const to = colorClass(PREFIX[read.prop], hit.hex, hit.key)
    links.push({ from: t, to, key: hit.key, name: hit.name })
    return to
  })
  return links.length ? { next: next.join(' '), links } : null
}

export type StyleRow = { id: string; region_key: string; class_names: string }
export type PlannedLink = StyleRow & { before: string; after: string; links: TokenLink[] }

/**
 * Every row that would change, and every row whose linked string the editor's own save
 * would refuse (linking lengthens a token; a row near the 500-character ceiling can cross
 * it). A refused row is reported and never written.
 */
export function planBrandLinks(
  rows: readonly StyleRow[],
  colors: readonly BrandColorRef[],
): { changes: PlannedLink[]; refused: { region_key: string; after: string }[] } {
  const changes: PlannedLink[] = []
  const refused: { region_key: string; after: string }[] = []
  for (const row of rows) {
    const linked = linkBrandColors(row.class_names ?? '', colors)
    if (!linked) continue
    if (cleanClassText(linked.next) === null) {
      refused.push({ region_key: row.region_key, after: linked.next })
      continue
    }
    changes.push({ ...row, before: row.class_names, after: linked.next, links: linked.links })
  }
  return { changes, refused }
}
