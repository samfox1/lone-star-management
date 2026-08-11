/**
 * DOM markers for the editor — the ATTRIBUTES are the contract and live in
 * `@samfox1/site-bridge` (one spelling for every site and this editor); re-exported
 * here because this is where the templates have always found them. What stays local is
 * lone-star sugar: the `*Region` attribute-spread helpers the built-in templates render
 * with, and the item-marker builder (parsing lives frame-side in the package: `targetOf`).
 */
import { ITEM_ATTR, type LibraryAsset } from '@samfox1/site-bridge'

export {
  FIELD_ATTR,
  SLOT_ATTR,
  ITEM_ATTR,
  STYLE_ATTR,
  LINK_ATTR,
  HIGHLIGHT_ATTR,
  HIGHLIGHT_CSS,
  WINDOW_ATTR,
  TEXT_ATTR,
  IMG_CLASS_ATTR,
  SHIELD_ATTR,
  MARKED,
} from '@samfox1/site-bridge'
import { FIELD_ATTR, SLOT_ATTR } from '@samfox1/site-bridge'

/** `track:<id>` — one placed library item's marker value. */
export function itemMarker(assetType: LibraryAsset, id: string): string {
  return `${assetType}:${id}`
}

/* ── Region helpers — emit marker attrs only in edit mode ─────────────────────────
 * A template spreads these onto an element; when not editable they spread to nothing,
 * so the public render carries no editor attributes at all. */

export function fieldRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [FIELD_ATTR]: key } : {}
}

export function slotRegion(editable: boolean, key: string): Record<string, string> {
  return editable ? { [SLOT_ATTR]: key } : {}
}

export function itemRegion(editable: boolean, assetType: LibraryAsset, id: string): Record<string, string> {
  return editable ? { [ITEM_ATTR]: itemMarker(assetType, id) } : {}
}
