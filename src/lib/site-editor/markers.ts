/**
 * DOM markers for the editor — the ATTRIBUTES are the contract and live in
 * `@samfox1/site-bridge` (one spelling for every site and this editor); re-exported
 * here because this is where the templates have always found them. What stays local is
 * lone-star sugar: the `*Region` attribute-spread helpers the built-in templates render
 * with, and the item-marker pair bound to the package's asset REGISTRY.
 */
import { ITEM_ATTR, LIBRARY_ASSETS, type LibraryAsset } from '@samfox1/site-bridge'

export {
  FIELD_ATTR,
  SLOT_ATTR,
  ITEM_ATTR,
  STYLE_ATTR,
  LINK_ATTR,
  HIGHLIGHT_ATTR,
  WINDOW_ATTR,
  TEXT_ATTR,
  IMG_CLASS_ATTR,
  SHIELD_ATTR,
  MARKED,
} from '@samfox1/site-bridge'
import { FIELD_ATTR, SLOT_ATTR, LINK_ATTR } from '@samfox1/site-bridge'

/** `track:<id>` — one placed library item's marker value. */
export function itemMarker(assetType: LibraryAsset, id: string): string {
  return `${assetType}:${id}`
}

/**
 * Parse an item marker, validating the asset type against the package REGISTRY —
 * `LIBRARY_ASSETS`, not a local list (the 2026-08-07 review found a hand copy here that
 * would have silently dropped clicks on any future asset type in the built-in frame
 * only). Unknown types return null: this parser feeds EDITOR lookups that need a known
 * type; the frame side deliberately forwards unknowns instead (the editor filters).
 */
export function parseItemMarker(value: string): { assetType: LibraryAsset; id: string } | null {
  const sep = value.indexOf(':')
  if (sep <= 0 || sep === value.length - 1) return null
  const assetType = value.slice(0, sep)
  if (!(LIBRARY_ASSETS as readonly string[]).includes(assetType)) return null
  return { assetType: assetType as LibraryAsset, id: value.slice(sep + 1) }
}

/* ── Attribute spreads for the built-in templates (edit mode only; the public site
 * carries no markers). Note the naming trap the review flagged: the PACKAGE's
 * `slotRegion`/`itemRegion` (styles module) build per-item style KEYS — these build
 * attribute SPREADS. Both are importable in editor code; these keep their historical
 * names because every built-in template calls them. ── */

export function fieldRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [FIELD_ATTR]: key } : {}
}

export function slotRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [SLOT_ATTR]: key } : {}
}

export function linkRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [LINK_ATTR]: key } : {}
}

export function itemRegion(editable: boolean, assetType: LibraryAsset, id: string): Record<string, string> {
  return editable ? { [ITEM_ATTR]: itemMarker(assetType, id) } : {}
}
