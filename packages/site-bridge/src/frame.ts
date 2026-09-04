/**
 * The FRAME RUNTIME — everything a site's `/edit` route mounts to live inside the
 * lone-star editor: the click→select capture, the optimistic DOM appliers, the
 * highlight, and the ready/hello handshake with its announce loop.
 *
 * Ported VERBATIM from skeen's `lib/frameBridge.ts` (SITE_BRIDGE_PLAN.md phase 1
 * slice 2) — a year of incident fixes lives in these comments; the port moves them,
 * it does not rewrite them. Three deliberate changes, each named in the plan:
 *
 *   1. The protocol block (versions, sources, message types, guards) is DELETED here —
 *      ./protocol owns it, and this module imports it. skeen's copy was the mirror.
 *   2. `regionBase` is INJECTED (`createStyleApplier` / mountFrameBridge's option) —
 *      the registry it reads is site design, not contract (the registry inversion).
 *   3. `applyHighlightToDom` marks EVERY match, not the first (plan P8): markers can
 *      legitimately repeat (socials render in hero AND footer), and applyStyleToDom
 *      learned the same lesson from the five polaroid captions.
 *
 * DOM access happens only inside functions, never at module top level — this file must
 * import cleanly in a server component or a node test (the isomorphism rule, P3).
 */
import {
  FIELD_ATTR,
  HIGHLIGHT_ATTR,
  IMG_CLASS_ATTR,
  ITEM_ATTR,
  LINK_ATTR,
  MARKED,
  SLOT_ATTR,
  STYLE_ATTR,
  WINDOW_ATTR,
} from "./markers";
import {
  MANAGED_STYLE_PROPS,
  isItemKey,
  resolveRegionStyle,
  splitItemOverlay,
} from "./styles";
import {
  EDITOR_SOURCE,
  frameMessage,
  isEditorMessage,
  type EditorMessage,
  type Rect,
  type RegionMeasurements,
  type SelectTarget,
  type FrameMode,
} from "./protocol";
import type { PublicSitePayload } from "./payload";
import { applyCursor, cursorSettingsFrom, normalizeCursorSettings } from "./cursor";
import { mountEntrances, replayAllEntrances, replayEntrances } from "./entrances";
import { setVideosPlaying } from "./playback";
import type { LibraryAsset, TemplateManifest } from "./manifest";
import { textFieldKeys } from "./manifest";

/** How often the frame re-announces `ready`, and how many times, before giving up
 *  (~10s). See the handshake note in `mountFrameBridge`. */
export const READY_RETRY_MS = 300;

/** How long the frame waits for a revealed region to mount before giving up. A reveal is
 *  a click's worth of work — a tab switch, an accordion — so this is generous, not a
 *  budget. Exported so a site's tests can wait the same amount rather than guessing. */
export const REVEAL_TIMEOUT_MS = 2000;
export const READY_RETRIES = 33;

/**
 * An editor message as the frame actually receives it: the protocol's union, WIDENED
 * with an unknown-type arm. The runtime guard checks source/version/type-is-string, so
 * a NEWER editor's unknown message types still arrive here — the additive-protocol
 * design — and flow through to `onEditorMessage` instead of being a type error.
 */
export type InboundEditorMessage =
  | EditorMessage
  | { v: number; source: typeof EDITOR_SOURCE; type: string };

/** A string payload field, or null. `type` guarantees nothing about SHAPE — the editor is
 *  a separate deploy, and an undefined `url` reaching `looksLikeUrl(value.trim())` throws
 *  out of the message listener and drops the message with only a console error. */
function strField(msg: InboundEditorMessage, field: string): string | null {
  const value = (msg as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}


/**
 * A STYLE APPLIER instance: the site's region-base lookup plus the per-element base
 * snapshots, constructed together (2026-08-07 deepening — this replaced a module-level
 * `let` + setter whose interface included an invisible ordering invariant: a lookup set
 * after the editor's first apply-style cached the wrong base for the element's
 * lifetime, the hero `opacity-0` incident made intermittent. Construction makes that
 * bug class impossible: the binding exists before the instance can be used, and a
 * remount gets a fresh snapshot cache instead of a stale module WeakMap).
 *
 * `regionBase` returns the DECLARED base classes for a region key ('' when the site
 * declares none — the snapshot then falls back to the element's live class attribute,
 * the pre-registry behaviour). The registry itself is site design, not contract.
 */
export type StyleApplier = {
  applyStyleToDom: (root: ParentNode, key: string, className: string) => void;
};

export function createStyleApplier(
  options: { regionBase?: (key: string) => string } = {},
): StyleApplier {
  const regionBase = options.regionBase ?? (() => "");
  /** Each styled element's ORIGINAL classes, captured on first touch — the per-item
   *  overlay merges onto THIS, never the previous overlay's result. Instance-lived:
   *  it dies with the applier, not the module. */
  const baseCache = new WeakMap<Element, string>();
  return {
    applyStyleToDom: (root, key, className) =>
      applyStyleWith(regionBase, baseCache, root, key, className),
  };
}

/** A bare-function convenience for callers with no registry (tests, one-off applies):
 *  a lazily-shared no-registry instance. Its cache is module-lived — a caller that
 *  needs remount-fresh snapshots constructs its own applier. */
const defaultApplier = createStyleApplier();
export function applyStyleToDom(root: ParentNode, key: string, className: string): void {
  defaultApplier.applyStyleToDom(root, key, className);
}

/** The nearest ancestor (or self) carrying any `data-lse-*` marker, or null. */
export function markedAncestor(el: Element): Element | null {
  return el.closest(MARKED);
}

/** The SelectTarget a marked element represents (field > item > slot > style > link). */
export function targetOf(marked: Element): SelectTarget | null {
  const field = marked.getAttribute(FIELD_ATTR);
  if (field) return { kind: "field", key: field };
  const item = marked.getAttribute(ITEM_ATTR);
  if (item) {
    const sep = item.indexOf(":");
    if (sep > 0 && sep < item.length - 1) {
      return {
        kind: "item",
        // Forwarded as-typed, DELIBERATELY: the protocol names today's LibraryAsset
        // union, but the frame must not be the filter — a site built against a newer
        // kit may mark asset types this union hasn't met, and the additive design says
        // the EDITOR decides what it can route (its PANEL_BY_ASSET drops unknowns).
        // Narrowing here would silently eat those selects one deploy too early.
        assetType: item.slice(0, sep) as LibraryAsset,
        id: item.slice(sep + 1),
      };
    }
    return null;
  }
  const slot = marked.getAttribute(SLOT_ATTR);
  if (slot) return { kind: "slot", key: slot };
  const style = marked.getAttribute(STYLE_ATTR);
  if (style) return { kind: "style", key: style };
  const link = marked.getAttribute(LINK_ATTR);
  if (link) return { kind: "link", key: link };
  return null;
}

/** Exported (unlike skeen's original private copy): the editor-side wrapper re-exports
 *  it, and a site may want the same viewport box for its own overlays. */
function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * What the element actually renders, read at click time (protocol.RegionMeasurements —
 * see its docblock for why the class-string guess kept failing). Read from the LIVE
 * layout, so phone view measures phone reality for free: the frame is already rendering
 * at the phone width when the editor is in phone view.
 */
function measureOf(el: Element): RegionMeasurements {
  const cs = getComputedStyle(el);
  const px = (v: string): number | null => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const fontSizePx = px(cs.fontSize) ?? 16;
  const child = el.firstElementChild;
  return {
    fontSizePx,
    lineHeightPx: cs.lineHeight === "normal" ? null : px(cs.lineHeight),
    // 'normal' IS zero for letter-spacing — report the truth, not a hole.
    letterSpacingPx: cs.letterSpacing === "normal" ? 0 : (px(cs.letterSpacing) ?? 0),
    padTopPx: px(cs.paddingTop) ?? 0,
    padBottomPx: px(cs.paddingBottom) ?? 0,
    padLeftPx: px(cs.paddingLeft) ?? 0,
    padRightPx: px(cs.paddingRight) ?? 0,
    gapPx: px(cs.columnGap) ?? px(cs.rowGap),
    childWidthPx: child ? child.getBoundingClientRect().width || null : null,
    // The per-item families (0.25.2): transparency, zoom, border, corners.
    opacity: px(cs.opacity) ?? 1,
    transformScale: (() => {
      // matrix(a, b, c, d, tx, ty) — `a` is the x scale for a plain scale().
      const m = /^matrix\((-?[\d.]+),/.exec(cs.transform);
      return m ? Number(m[1]) : null;
    })(),
    borderWidthPx: px(cs.borderTopWidth) ?? 0,
    radiusPx: px(cs.borderTopLeftRadius) ?? 0,
  };
}



/** Region keys reach us over postMessage and originate in lone-star's DB (`image:<uuid>`,
 *  `slot:<role>`), so they are NOT a closed vocabulary. Unescaped, a key carrying a quote
 *  or a bracket makes querySelector throw SyntaxError out of the message listener, and a
 *  crafted one could close the selector early and hit a different element. */
function attrSelector(attr: string, value: string): string {
  // Inside a QUOTED attribute value only the quote and the backslash are special, so this
  // is the whole escape — narrower than CSS.escape (which escapes for identifier
  // position) and with no dependency on CSS.escape existing.
  return `[${attr}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

/**
 * Optimistically apply an edited class string onto a styled region.
 *
 * Section regions REPLACE their classes; per-item regions (`slot:…`, `image:…`,
 * `video:…`) ADD to the element's base — see `mergeStyle` in lib/styles.ts, which the
 * server render uses, so the preview and the published page agree. The editor's whole
 * owned vocabulary (colours, lengths, corners, shadows, scale, opacity) applies as
 * inline style, and every MANAGED_STYLE_PROPS entry is cleared before re-apply, so
 * removing any control in the editor removes its effect here.
 */
function applyStyleWith(
  regionBaseLookup: (key: string) => string,
  BASE_CLASSES: WeakMap<Element, string>,
  root: ParentNode,
  key: string,
  className: string,
): void {
  // ALL matching elements, not the first. A region key used to address exactly one
  // element, so querySelector was enough. It no longer is: the five polaroid captions
  // share one region (`polaroid_caption`), and picking the first meant a manager changing
  // the font watched card 1 update while the other four sat there until a reload — the
  // preview disagreeing with the page it is previewing.
  const els = [...root.querySelectorAll(attrSelector(STYLE_ATTR, key))];
  if (!els.length) return;
  // A WINDOWED item (the polaroid photo) splits its overlay across two elements, the
  // same split the server render does in splitItemProps — corners/border/shadow onto
  // the window, size/transparency onto the item. Items without a window (a video tile)
  // take the whole string, where all of it is visible anyway.
  const windowEls = isItemKey(key)
    ? [...root.querySelectorAll(attrSelector(WINDOW_ATTR, key))]
    : [];
  const parts = windowEls.length
    ? splitItemOverlay(className)
    : { window: "", inner: className };
  for (const el of els) applyStylePart(regionBaseLookup, BASE_CLASSES, el, key, parts.inner);
  for (const windowEl of windowEls)
    applyStylePart(regionBaseLookup, BASE_CLASSES, windowEl, key, parts.window);
}

function applyStylePart(
  regionBaseLookup: (key: string) => string,
  BASE_CLASSES: WeakMap<Element, string>,
  el: Element,
  key: string,
  className: string,
): void {
  if (!BASE_CLASSES.has(el)) {
    // The DECLARED base wins over the live class attribute, because the live one is
    // time-varying: Hero appends `opacity-0` to the hero clip until `canplay`. Snapshot
    // that and an empty override — the editor's own reset — restores `opacity-0`, which
    // resolveStyle then hoists to inline `opacity: 0`. React can never take that back (it
    // owns the class attribute, not the style property it never set), so the clip goes
    // invisible for the rest of the session. Per-item keys declare no base, so they still
    // snapshot the element's own classes, which is exactly what they overlay onto.
    BASE_CLASSES.set(el, regionBaseLookup(key) || (el.getAttribute("class") ?? ""));
  }
  const resolved = resolveRegionStyle(
    key,
    BASE_CLASSES.get(el) ?? "",
    className,
  );
  el.setAttribute("class", resolved.className);
  if (el instanceof HTMLElement) {
    for (const prop of MANAGED_STYLE_PROPS) el.style.removeProperty(prop);
    for (const [prop, value] of Object.entries(resolved.style))
      el.style.setProperty(
        prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
        value,
      );
  }
  // Playback speed is a DOM property, not CSS. The marked region may be the <video>
  // itself or a wrapper around it (the hero clip); clearing the token resets to normal.
  //
  // Only the region that OWNS speed may reset it. The hero clip sits inside two styled
  // regions — the `slot:hero_*` wrapper, which carries `speed-[Nx]`, and `hero_video`,
  // which never does — so resetting on every apply meant restyling the section slammed
  // the clip back to 1x and wiped the speed the manager had just set on the slot.
  const video = el instanceof HTMLVideoElement ? el : el.querySelector("video");
  if (video && (isItemKey(key) || resolved.playbackRate != null))
    video.playbackRate = resolved.playbackRate ?? 1;
}

/**
 * Optimistically apply an edited field value (image src / text).
 *
 * An image field's element is NOT always an <img>: an unfilled slot renders a
 * placeholder (About's empty polaroid cards render a dashed "Add photo" div), and that
 * placeholder is exactly what a manager drops the first image onto. Writing the URL as
 * textContent there would print the URL instead of showing the photo, so a value that
 * looks like an image URL swaps the placeholder for a real <img> carrying the same
 * marker — which then behaves like any other image field on subsequent edits.
 */
export function applyFieldToDom(
  root: ParentNode,
  key: string,
  value: string,
  /**
   * The manifest declares this field as TEXT, so never guess from the value's shape.
   * Without it a polaroid caption of "skeen.com" satisfies looksLikeUrl and the caption
   * is replaced by a broken <img> — the guess below is right for an image slot's
   * placeholder and wrong for anything the manager is genuinely typing.
   */
  isText = false,
): void {
  const el = root.querySelector(attrSelector(FIELD_ATTR, key));
  if (!el) return;
  if (isText) {
    el.textContent = value;
  } else if (el instanceof HTMLImageElement) {
    el.src = value;
  } else if (looksLikeUrl(value)) {
    swapForImage(el, key, value);
  } else {
    el.textContent = value;
  }
}

/**
 * Replace an unfilled slot's placeholder with a real <img>.
 *
 * EVERY marker crosses over, not just the field one. The placeholder is also the item's
 * style region (`data-lse-style`), and dropping that marker meant the first photo a
 * manager added silently lost its size/border/corner/shadow controls for the rest of the
 * session: applyStyleToDom would find nothing and return early.
 *
 * CLASSES ARE NOT ALWAYS THE PLACEHOLDER'S. Copying `el.className` is right when the
 * placeholder is shaped like the image it stands in for — the polaroid drop targets are,
 * deliberately. It is wrong when the placeholder is the real content: the hero wordmark's
 * stand-in is the WORD "SKEEN", so its classes are an 11rem glitching display face, and
 * inheriting them rendered the first logo dropped at intrinsic size with the glitch
 * animation running, correct only after a save and reload (found in review, 2026-08-06).
 *
 * `data-lse-img-class` is how a placeholder says "use these instead". Opt-in, so every
 * existing target keeps the copy behaviour with no change.
 */
function swapForImage(el: Element, key: string, url: string): void {
  const img = el.ownerDocument.createElement("img");
  img.src = url;
  // The placeholder's own words are the best alt text available here: for the wordmark
  // they are the artist's name, which is exactly what the published <img> uses. Empty was
  // the old behaviour and made every freshly-dropped image invisible to a screen reader
  // until reload.
  img.alt = (el.textContent ?? "").trim();
  img.setAttribute(FIELD_ATTR, key);
  for (const attr of el.attributes)
    if (attr.name.startsWith("data-lse-"))
      img.setAttribute(attr.name, attr.value);
  // Not carried onto the image: it names the classes, it is not one of them.
  img.removeAttribute(IMG_CLASS_ATTR);
  img.className = el.getAttribute(IMG_CLASS_ATTR) ?? el.className;
  el.replaceWith(img);
}

/**
 * Repaint ONE image region (`apply-image`). Mirrors lone-star's applyImageToDom.
 *
 * NOT applyFieldToDom, which this used to route into. That helper falls back to
 * textContent for a value that doesn't look like a URL, so an EMPTY url — a slot being
 * cleared — would have blanked the element's markup rather than doing nothing. An image
 * URL landing as text is worse than no repaint, and what an empty slot should look like
 * is the template's call, so clearing is left to the init-data refresh.
 *
 * Order matters: the element's own src, then a nested <img> (the marked element may be a
 * wrapper), and only then the placeholder swap — which is skeen's own extra, since an
 * unfilled polaroid renders a dashed div and that div is exactly what a manager drops
 * the first photo onto.
 */
export function applyImageToDom(
  root: ParentNode,
  key: string,
  url: string,
): void {
  if (!url) return;
  const el = root.querySelector(attrSelector(FIELD_ATTR, key));
  if (!el) return;
  if (el instanceof HTMLImageElement) {
    el.src = url;
    return;
  }
  const nested = el.querySelector("img");
  if (nested) {
    nested.src = url;
    return;
  }
  if (looksLikeUrl(url)) swapForImage(el, key, url);
}

/** An http(s), protocol-relative, site-relative or data: URL — i.e. something that
 *  belongs in an <img src>, not something that belongs in textContent. */
function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|\/\/|\/|data:image\/)/i.test(value.trim());
}

/** Optimistically apply an edited URL onto a link-powered element (its href). */
export function applyLinkToDom(
  root: ParentNode,
  key: string,
  url: string,
): void {
  const el = root.querySelector(attrSelector(LINK_ATTR, key));
  if (!el) return;
  // A BLANK url removes the attribute: an <a href=""> is a live link to the current
  // page, and with target="_blank" it opens a second copy of the whole site (the exact
  // trap skeen's footer USB documents). No href = an inert element — what "cleared"
  // should mean. (Unified from lone-star's copy in the 2026-08-07 consolidation; the
  // original here set href unconditionally.)
  if (url) el.setAttribute("href", url);
  else el.removeAttribute("href");
}

/** The attribute selector that finds a SelectTarget's marked element — the inverse of
 *  targetOf. Used to resolve an editor `highlight` back to a DOM node. */
export function highlightSelector(target: SelectTarget): string {
  switch (target.kind) {
    case "field":
      return attrSelector(FIELD_ATTR, target.key);
    case "slot":
      return attrSelector(SLOT_ATTR, target.key);
    case "item":
      return attrSelector(ITEM_ATTR, `${target.assetType}:${target.id}`);
    case "style":
      return attrSelector(STYLE_ATTR, target.key);
    case "link":
      return attrSelector(LINK_ATTR, target.key);
  }
}

/** Move the highlight to `target`'s element(s): clear any prior mark, then mark EVERY
 *  match — a marker can legitimately repeat (the socials render in the hero AND the
 *  footer), and outlining only the first taught applyStyleToDom the same lesson via the
 *  five polaroid captions. Returns the first match (the scroll target) or null if the
 *  region isn't on the page. The edit shell styles `[data-lse-highlight]`. */
export function applyHighlightToDom(
  root: ParentNode,
  target: SelectTarget,
): Element | null {
  clearHighlightFromDom(root);
  const els = [...root.querySelectorAll(highlightSelector(target))];
  for (const el of els) el.setAttribute(HIGHLIGHT_ATTR, "");
  return els[0] ?? null;
}

/** Drop the highlight from whichever region holds it. No-op if none does. */
export function clearHighlightFromDom(root: ParentNode): void {
  root
    .querySelectorAll(`[${HIGHLIGHT_ATTR}]`)
    .forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));
}

/**
 * Wire the live frame bridge. Reports selects to the parent, applies editor
 * messages, and surfaces injected draft data via `onInitData`. Only acts on
 * messages from the trusted `editorOrigin`. Returns a teardown.
 */
export function mountFrameBridge(options: {
  editorOrigin: string;
  onInitData: (site: PublicSitePayload) => void;
  /**
   * The manifest, or a THUNK that builds it.
   *
   * A thunk because the text fields are read from the DOM (editList's textFieldsFromDom),
   * so the answer depends on what has rendered. Resolved fresh at every `ready` — the
   * first announce can fire before the page has painted, and a manifest captured then
   * would carry no text fields at all. Announcing repeatedly then costs nothing and
   * self-corrects; capturing once would have shipped an empty list to whichever editor
   * happened to be listening first.
   */
  editList?: unknown | (() => unknown);
  onEditorMessage?: (msg: InboundEditorMessage) => void;
  target?: Window;
  /** Called on every announce, and once the editor first answers. Lets the edit shell
   *  SHOW the handshake state instead of sitting on a blank "Waiting…" — the failure
   *  mode this whole bridge kept hitting was invisible, not complicated. */
  onStatus?: (status: { announces: number; connected: boolean }) => void;
  /** Called the first time the editor says anything. */
  onConnected?: () => void;
  /**
   * Handed the bridge's controls once it is mounted.
   *
   * `announce` re-posts `ready` with a FRESHLY BUILT manifest. The caller needs it
   * because this frame renders nothing until the editor sends init-data: the first
   * announce necessarily scans an empty document, finds no <Text> elements, and ships a
   * manifest with no DOM-derived fields in it. The editor then replies, announcing stops,
   * the content finally renders — and without this nothing ever tells the editor that the
   * page it is now looking at declares thirty strings it has never heard of.
   *
   * Deliberately NOT automatic on init-data: only the caller knows when its content has
   * actually painted, and announcing a beat too early would re-ship the same empty list
   * with more confidence.
   *
   * `writeField` saves a DECLARED field the manager changed by acting on the page —
   * dropping an icon where they want it (0.27.0). The editor treats it exactly like a
   * typed value, and ignores any key the manifest does not declare, so a site cannot
   * write outside what it asked for. Call it on the gesture's END, not during: every call
   * is a save.
   */
  onMounted?: (handle: {
    announce: () => void;
    writeField: (key: string, value: string) => void;
    /**
     * The shell is now SHOWING `page` — call it after the new page has painted, from
     * either cause (the editor's `set-page`, or the manager clicking the site's own nav
     * in browse mode). Announces the fresh manifest FIRST, then posts `page-change`, in
     * that order and as one call so a shell cannot get it backwards: the editor checks
     * `page-change` against the pages DECLARED in the announce, and one that arrives
     * ahead of its declaration is dropped as a stranger naming a page.
     */
    pageChanged: (page: string) => void;
  }) => void;
  /** The site's region registry lookup (its `regionBase`). Bound synchronously before
   *  any listener attaches — see the ordering note on `regionBaseLookup`. */
  regionBase?: (key: string) => string;
  /** Told when the editor switches between selecting regions and working the site, so a
   *  site can show its own affordance (dim the chrome, drop a hover outline). Optional:
   *  the mode works without it. */
  onModeChange?: (mode: FrameMode) => void;
  /**
   * The editor asked for a different PAGE (SITE_PAGES_PLAN.md A1). The shell swaps what it
   * renders in CLIENT STATE and, once the new page has painted, calls the handle's
   * `pageChanged`. It must not navigate: `/edit` is a route and this bridge is mounted in
   * that route's effect, so a real navigation unmounts it and leaves the editor holding a
   * dead frame. Optional — a one-page site never hears this and never needs to.
   */
  onSetPage?: (page: string) => void;
  /**
   * Bring a region into view — open its tab, expand its section, scroll its carousel.
   *
   * Called ONLY when a `highlight` finds nothing on the page, so a site whose content is
   * all mounted at once never needs it. The site does whatever it takes and returns; the
   * frame then waits for the element to appear and highlights it. A site that implements
   * nothing keeps today's behaviour exactly (the highlight is simply dropped).
   */
  onReveal?: (target: SelectTarget) => void;
}): () => void {
  // The applier is CONSTRUCTED from the option — no setter, no module state, so the
  // "bound before any listener" invariant holds by construction (2026-08-07 deepening;
  // the old setter's ordering hazard was the intermittent hero-clip failure the
  // StyleApplier docblock describes).
  const styler = createStyleApplier({ regionBase: options.regionBase });
  // Starts in `edit`, so a frame that never hears `set-mode` behaves exactly as before.
  let mode: FrameMode = "edit";
  const target = options.target ?? window.parent;
  // Cast, not validated: the edit-list is site-supplied and travels opaquely — the
  // EDITOR validates it on receipt. The cast is what lets `ready` ride the typed
  // frameMessage stamper instead of a loose local one.
  const manifest = () =>
    (typeof options.editList === "function"
      ? (options.editList as () => unknown)()
      : options.editList) as TemplateManifest | undefined;
  // Read once: the manifest is a module constant, and this decides how every inbound
  // `apply-field` is written to the DOM.
  // Recomputed per message rather than captured: the DOM-derived text fields are not
  // known at mount, and a set captured then would treat every wrapped string as an image
  // field — which is exactly the value-shape guessing this replaced.
  const textKeysNow = () => textFieldKeys(manifest());
  const post = (msg: object) => target.postMessage(msg, options.editorOrigin);
  // The protocol's own stamper — duplicating the v/source spread here was the one
  // way this file could drift from the wire contract it implements.
  const stamp = frameMessage;

  let announce: ReturnType<typeof setInterval> | null = null;
  let attempts = 0;
  const stopAnnouncing = () => {
    if (announce) clearInterval(announce);
    announce = null;
  };

  const onClick = (e: MouseEvent) => {
    // BROWSE: the frame keeps its hands off entirely — no select, no deselect, no
    // preventDefault — so the site works the way a fan's does. The listener stays
    // attached rather than being removed and re-added, so there is no window in which a
    // mode change races a click.
    if (mode === "browse") return;
    const el = e.target as Element | null;
    const marked = el && markedAncestor(el);
    if (!marked) return post(stamp({ type: "deselect" }));
    // preventDefault only suppresses NATIVE navigation. React's own handlers are
    // delegated and would still fire, so selecting a region in the editor also ran the
    // app underneath it: clicking Contact opened the enquiry modal over the editor, a
    // music tile opened the platform modal and locked body scroll. This listener is
    // registered in the capture phase, so stopping propagation here keeps a select
    // click from ever reaching them.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const sel = targetOf(marked);
    if (sel) post(stamp({ type: "select", target: sel, rect: rectOf(marked), measured: measureOf(marked) }));
  };

  /**
   * Highlight a region, ASKING THE SITE TO SHOW IT FIRST if it is not on the page.
   *
   * Panel → preview selection silently did nothing whenever the target sat behind a
   * closed tab, an unexpanded section, or an off-screen slide: the editor cannot know
   * the region is hidden, and the site cannot know the manager just clicked its row
   * (throwaway #2, 2026-08-10 — every windowed site has this, ftbk included).
   *
   * Deliberately NOT a new protocol message. Handling it inside `highlight` means the
   * editor sends exactly what it always sent, and a site that implements nothing behaves
   * exactly as before — the reveal is a capability a site opts into, not a handshake
   * both halves must agree on.
   */
  /** The one pending reveal wait, if any. ONE, not a list: a wait belongs to the
   *  manager's LATEST selection, and an older one completing later would re-ring a
   *  region they have already moved on from (2026-08-10 review — the tab's content
   *  mounting for any reason at all would have stolen the ring back). */
  let cancelWait: (() => void) | null = null;

  // scrollIntoView is optional-called throughout: jsdom (every site's test env) has no
  // layout and does not implement it, and a highlight that lands minus the scroll is
  // strictly better than an exception mid-apply.
  const revealAndHighlight = (target: SelectTarget) => {
    // Whatever was being waited for, this selection supersedes it.
    cancelWait?.();
    const found = applyHighlightToDom(document, target);
    if (found) return found.scrollIntoView?.({ behavior: "smooth", block: "center" });
    // Nothing matched. If the site can show it, ask — then wait for it to arrive.
    if (!options.onReveal) return;
    options.onReveal(target);
    // Check again FIRST. A site that reveals synchronously — appending the element, or
    // any non-React site — has already put it on the page, and a MutationObserver only
    // fires on FUTURE mutations, so observing first would wait out the timeout for an
    // element sitting right there. (Found by the test, 2026-08-10.)
    const now = applyHighlightToDom(document, target);
    if (now) return now.scrollIntoView?.({ behavior: "smooth", block: "center" });
    waitForRegion(target);
  };

  /** Wait for a revealed region to mount, then highlight it. Gives up quietly: a site
   *  may legitimately have no such region, and a spinner over someone's page for a
   *  region that is never coming is worse than the silence it replaced. */
  const waitForRegion = (target: SelectTarget) => {
    if (typeof MutationObserver === "undefined") return;
    let settled = false;
    const finish = (el: Element | null) => {
      if (settled) return;
      settled = true;
      cancelWait = null;
      observer.disconnect();
      clearTimeout(timer);
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    };
    const observer = new MutationObserver(() => {
      const el = applyHighlightToDom(document, target);
      if (el) finish(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // A reveal is a click's worth of work — a tab switch, an accordion. Anything slower
    // than this is a site doing something the manager will not connect to their click.
    const timer = setTimeout(() => finish(null), REVEAL_TIMEOUT_MS);
    cancelWait = () => {
      settled = true;
      cancelWait = null;
      observer.disconnect();
      clearTimeout(timer);
    };
  };

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== options.editorOrigin || !isEditorMessage(e.data)) return;
    stopAnnouncing(); // any reply proves the editor is listening
    options.onConnected?.();
    options.onStatus?.({ announces: attempts, connected: true });
    const msg = e.data as InboundEditorMessage;
    // `hello` IS the editor asking us to announce — it mounted after our announcements
    // were spent, which is exactly the case a one-way handshake could never recover from.
    if (msg.type === "hello")
      return post(stamp({ type: "ready", manifest: manifest() }));
    const key = strField(msg, "key");
    if (msg.type === "apply-style") {
      const className = strField(msg, "className");
      if (key !== null && className !== null) {
        styler.applyStyleToDom(document, key, className);
        // Picking an entrance should SHOW it — replay the animation for the region(s)
        // just styled (a key is [A-Za-z0-9_], safe to interpolate).
        replayEntrances(document, `[data-lse-style="${key}"]`);
      }
    }
    // apply-image has its OWN helper. It used to share applyFieldToDom, which writes
    // textContent for a non-URL value — so a cleared slot would have blanked the
    // element instead of no-oping. See applyImageToDom.
    else if (msg.type === "apply-image") {
      const url = strField(msg, "url");
      if (key !== null && url !== null) applyImageToDom(document, key, url);
    } else if (msg.type === "apply-field") {
      const value = strField(msg, "value");
      if (key !== null && value !== null)
        applyFieldToDom(document, key, value, textKeysNow().has(key));
    } else if (msg.type === "apply-link") {
      const url = strField(msg, "url");
      if (key !== null && url !== null) applyLinkToDom(document, key, url);
    }
    // The cursor isn't a marked DOM region, so it gets its own applier rather than a
    // silent fall-through in applyFieldToDom. Normalized on receipt: the guard checks
    // the envelope, not payload interiors.
    else if (msg.type === "replay-entrances") replayAllEntrances(document);
    else if (msg.type === "set-playback" && "playing" in msg)
      setVideosPlaying(document, msg.playing === true);
    else if (msg.type === "apply-cursor" && "settings" in msg)
      applyCursor(document, normalizeCursorSettings(msg.settings));
    else if (msg.type === "init-data" && "site" in msg) {
      // The cursor rides site_content, but rendering it is imperative (listeners +
      // overlay), not declarative — so the frame applies it here rather than hoping
      // every site's onInitData remembers to.
      applyCursor(document, cursorSettingsFrom(msg.site?.site_content ?? {}));
      options.onInitData(msg.site);
    }
    else if (msg.type === "highlight" && "target" in msg) revealAndHighlight(msg.target);
    else if (msg.type === "clear-highlight") {
      // A deselect also abandons any reveal in flight — the wait belongs to a selection
      // that no longer exists.
      cancelWait?.();
      clearHighlightFromDom(document);
    }
    else if (msg.type === "measure" && "key" in msg && typeof msg.key === "string") {
      // Measure ON DEMAND (0.25.2): a panel-opened editor has no click to ride, so the
      // editor asks. Silence when the region isn't on the page — the editor keeps its
      // class-string guess, exactly the older-frame behaviour.
      const el = document.querySelector(attrSelector(STYLE_ATTR, msg.key));
      if (el) post(stamp({ type: "measured", key: msg.key, measured: measureOf(el) }));
    }
    else if (msg.type === "set-mode" && "mode" in msg) {
      mode = msg.mode === "browse" ? "browse" : "edit";
      // Leaving edit mode drops the outline with it: a ring around something the manager
      // is now just looking at reads as a selection they cannot clear.
      if (mode === "browse") clearHighlightFromDom(document);
      options.onModeChange?.(mode);
    }
    else if (msg.type === "set-page" && "page" in msg && typeof msg.page === "string") {
      // Optional chaining is the compatibility story: a site built before pages existed
      // declares no handler, and the request has to be a no-op there rather than a throw
      // inside the one listener that handles everything else.
      options.onSetPage?.(msg.page);
    }
    else options.onEditorMessage?.(msg);
  };

  /**
   * Announce readiness + skeen's edit-list so the editor is data-driven (D-D).
   *
   * Announced ONCE, this was a race the frame regularly lost: a postMessage sent before
   * the editor attached its listener is dropped silently, and the editor then shows "0
   * regions" with every declared component missing and no error anywhere. Being remote
   * (Vercel) rather than same-origin made it the common case, not the rare one.
   *
   * So keep announcing until the editor replies. Re-announcing costs nothing — the
   * editor just re-reads the same manifest — and it stops on the first message back.
   */
  document.addEventListener("click", onClick, true);
  window.addEventListener("message", onMessage);
  // The preview animates like the live site: regions with a stored entrance class
  // play as they scroll into view. Idempotent — a site that mounted its own runtime
  // (SiteEffects) is simply re-armed.
  const unmountEntrances = mountEntrances(document);
  const announceOnce = () => {
    post(stamp({ type: "ready", manifest: manifest() }));
    // Counted OUTSIDE the optional call: `options.onStatus?.({ n: ++attempts })` skips
    // its own argument when no callback is passed, so the counter silently froze and the
    // give-up below never fired. The retry test caught it.
    attempts += 1;
    options.onStatus?.({ announces: attempts, connected: false });
  };
  announceOnce();
  // Re-announce, WITHOUT touching the retry counter or the connected status: this is not
  // another attempt at a handshake that has already succeeded, it is a corrected manifest
  // for one that did. Counting it would push `attempts` toward the give-up threshold and
  // flash the shell back to "not connected" after it had settled.
  const reannounce = () => post(stamp({ type: "ready", manifest: manifest() }));
  options.onMounted?.({
    announce: reannounce,
    writeField: (key, value) => post(stamp({ type: "field-change", key, value })),
    pageChanged: (page) => {
      // Manifest first — see the handle's docblock for why this order is not a style choice.
      reannounce();
      post(stamp({ type: "page-change", page }));
    },
  });
  announce = setInterval(() => {
    // Bounded (~10s): opened directly, with no editor parent, this must not spin forever.
    if (attempts >= READY_RETRIES) return stopAnnouncing();
    announceOnce();
  }, READY_RETRY_MS);

  return () => {
    stopAnnouncing();
    cancelWait?.(); // a reveal in flight must not outlive the bridge it belongs to
    unmountEntrances();
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("message", onMessage);
  };
}
