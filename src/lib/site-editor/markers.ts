/**
 * DOM MARKER convention for the editable-regions rulebook (SITE_EDITOR_PLAN.md).
 *
 * A site in EDIT MODE tags its editable regions with these `data-lse-*`
 * attributes; the bridge (./bridge) reads them on click and reports the target to
 * the editor. The attribute VALUES are manifest keys (see ./manifest) — the editor
 * maps a clicked marker back to a ManifestField / ManifestSlot / library item.
 *
 *   data-lse-field="hero_tagline"   → an editable atom (text / image field)
 *   data-lse-slot="tracks"          → a section that accepts library items
 *   data-lse-item="track:<uuid>"    → one placed item inside a slot
 *
 * Pure string helpers only — no DOM access here, so this is safe to import
 * server-side (the template emits the attributes) and in tests.
 */
import type { LibraryAsset } from '@/lib/site-editor/manifest'

export const FIELD_ATTR = 'data-lse-field'
export const SLOT_ATTR = 'data-lse-slot'
export const ITEM_ATTR = 'data-lse-item'
export const STYLE_ATTR = 'data-lse-style'

/** Build a `data-lse-item` value. Asset ids are UUIDs (no colon), and the asset
 *  type has no colon, so the first colon is an unambiguous separator. */
export function itemMarker(assetType: LibraryAsset, id: string): string {
  return `${assetType}:${id}`
}

const ASSET_TYPES: readonly LibraryAsset[] = ['track', 'video', 'image', 'merch', 'tour_date', 'link']

/** Parse a `data-lse-item` value back into its parts, or null if malformed /
 *  unknown asset type. */
export function parseItemMarker(value: string): { assetType: LibraryAsset; id: string } | null {
  const sep = value.indexOf(':')
  if (sep <= 0 || sep === value.length - 1) return null
  const assetType = value.slice(0, sep) as LibraryAsset
  const id = value.slice(sep + 1)
  if (!ASSET_TYPES.includes(assetType)) return null
  return { assetType, id }
}

/**
 * Region attribute spreads for a template to emit in EDIT MODE only. A template
 * threads its `editable` flag and spreads these onto the region element:
 *   <h2 {...fieldRegion(editable, 'shows_heading')}>…</h2>
 *   <section {...slotRegion(editable, 'shows')}> … {shows.map((s) =>
 *     <div {...itemRegion(editable, 'tour_date', s.id)}> … </div>)} </section>
 * Off edit mode they return `{}` — the public site carries no markers.
 */
export function fieldRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [FIELD_ATTR]: key } : {}
}

export function slotRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [SLOT_ATTR]: key } : {}
}

export function itemRegion(editable: boolean, assetType: LibraryAsset, id: string): Record<string, string> {
  return editable ? { [ITEM_ATTR]: itemMarker(assetType, id) } : {}
}
