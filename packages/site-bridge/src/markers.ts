/**
 * The DOM MARKER vocabulary — how a site tags its editable regions in edit mode, and
 * how the frame bridge maps a click back to an edit-list key. Ported VERBATIM from
 * skeen's `lib/editMarkers.ts` (SITE_BRIDGE_PLAN.md phase 1 slice 2), which was itself
 * a hand mirror of lone-star's markers module — this package retires both copies.
 *
 *   data-lse-field="hero_tagline"    → an editable atom (text / image)
 *   data-lse-slot="shows"            → a section that holds library items
 *   data-lse-item="tour_date:<uuid>" → one placed item inside a slot
 *   data-lse-style="hero_nav"        → a re-styleable region (class string editable)
 *   data-lse-link="usb"              → a link-powered element (its href is editable)
 *
 * Pure strings, no DOM access — safe to import from a server component (the public
 * site renders the same components with `editable` false and no markers) and tests.
 */
export const FIELD_ATTR = "data-lse-field";
export const SLOT_ATTR = "data-lse-slot";
export const ITEM_ATTR = "data-lse-item";
export const LINK_ATTR = "data-lse-link";
/** Transient marker the editor sets on the regions it's highlighting (editor →
 *  frame `highlight`). Carries no value; `HIGHLIGHT_CSS` styles it. */
export const HIGHLIGHT_ATTR = "data-lse-highlight";

/**
 * How a highlighted region LOOKS. Every edit shell injects this verbatim; it is built
 * from `HIGHLIGHT_ATTR` so a rename cannot leave a stale selector behind.
 *
 * It lives here because it was the LAST hand mirror: byte-identical copies sat in
 * lone-star's built-in edit-frame and in skeen's /edit route (whose comment admitted
 * it "mirrors lone-star's"), so a fix had to be applied twice by memory.
 *
 * NO PAGE-WIDE WASH. The mirrors carried `box-shadow:0 0 0 9999px rgba(37,99,235,.06)`
 * to dim the rest of the page, which only ever worked when the marked element had no
 * clipping ancestor. `applyHighlightToDom` marks EVERY match, and skeen renders its
 * socials in both the hero and the footer: the hero's wash was clipped away by
 * `overflow-hidden` while the footer's painted an edged grey rectangle across the page
 * — reported as "this weird container opens below" (Sam, 2026-08-08). The outline
 * carries the affordance on its own, and the editor scrolls the selection into view.
 */
export const HIGHLIGHT_CSS = `[${HIGHLIGHT_ATTR}]{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:2px}`;

/**
 * Attribute spread for a slot SECTION, in EDIT MODE only:
 *   <section {...slotProps(editable, SLOT.shows)}>
 * Off edit mode it returns `{}`, so the public site carries no markers.
 */
export function slotProps(
  editable: boolean,
  key: string,
): Record<string, string> {
  return editable ? { [SLOT_ATTR]: key } : {};
}

/**
 * Attribute spread for ONE library item inside a slot:
 *   <li {...itemProps(editable, "tour_date", show.id)}>
 *
 * `assetType` must match lone-star's LibraryAsset union, and `id` is the row's id in
 * lone-star — the id `get_public_site` returns, not anything skeen invents, since the
 * editor looks the row up by it. The first colon separates the two: asset types never
 * contain one and ids are UUIDs.
 */
export function itemProps(
  editable: boolean,
  assetType: string,
  id: string,
): Record<string, string> {
  return editable ? { [ITEM_ATTR]: `${assetType}:${id}` } : {};
}

/**
 * Attribute spread for a LINK-POWERED element (an `<a>` whose href a manager sets),
 * in EDIT MODE only:
 *   <a href={usbHref} {...linkProps(editable, LINK.usb)}>
 *
 * `key` is a link-region key from the edit-list (see ./editList LINK) — the editor maps
 * the click back to the declared link ("USB button") and edits its URL, so it never has
 * to guess what a link powers from its label. Off edit mode it returns `{}`, so the
 * public site carries no markers.
 */
export function linkProps(
  editable: boolean,
  key: string,
): Record<string, string> {
  return editable ? { [LINK_ATTR]: key } : {};
}


/** The edit-tag lone-star's editor reads to identify a styled region. Lives here with
 *  the other markers; the style machinery (./styles) re-exports it. */
export const STYLE_ATTR = "data-lse-style";

/** The edit-tag for a per-item region's WINDOW — the `overflow-hidden` wrapper around
 *  the item (the polaroid's photo window). Distinct from STYLE_ATTR so the editor's
 *  select/highlight, which look for exactly one STYLE_ATTR element per key, still land
 *  on the item itself. */
export const WINDOW_ATTR = "data-lse-style-window";

/**
 * The DISCOVERY marker a text-wrapper component stamps on every wrapped string, so the
 * edit list can be DERIVED from the DOM (skeen's textFieldsFromDom; the site-kit
 * generalizes it). Its own attribute rather than reusing FIELD_ATTR, because that one
 * is ambiguous: image drop targets carry it too, and offering an image as a text box is
 * worse than not offering it. Empty value — its presence is the whole signal.
 */
export const TEXT_ATTR = "data-lse-text";

/** A placeholder's opt-in override for the classes a freshly-dropped image should get
 *  (`swapForImage`). Named here so sites and the bridge agree on the spelling. */
export const IMG_CLASS_ATTR = "data-lse-img-class";

/**
 * The edit-mode CLICK SHIELD for embedded iframes. A click inside an <iframe> belongs
 * to the embedded document — the parent page never sees it — so an embed tile's item
 * marker could never fire. In edit mode the site overlays a transparent element with
 * this attribute over each embed; the click hits the shield and bubbles to the marked
 * wrapper. Never rendered on the public site.
 */
export const SHIELD_ATTR = "data-lse-shield";

/** Every attribute that makes an element clickable-to-select, as one selector —
 *  `markedAncestor` (./frame) walks up to the closest of these. */
export const MARKED = `[${FIELD_ATTR}],[${SLOT_ATTR}],[${ITEM_ATTR}],[${STYLE_ATTR}],[${LINK_ATTR}]`;

/**
 * Attribute spread for an editable FIELD element (text or image atom), edit mode only:
 *   <img {...fieldProps(editable, "polaroid_3_photo")} />
 * The sibling of slotProps/itemProps/linkProps that skeen assembled by hand per
 * component; named here so every site spells it the same way.
 */
export function fieldProps(
  editable: boolean,
  key: string,
): Record<string, string> {
  return editable ? { [FIELD_ATTR]: key } : {};
}
