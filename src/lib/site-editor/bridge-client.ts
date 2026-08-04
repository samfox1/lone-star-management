/**
 * The FRAME side of the bridge (SITE_EDITOR_PLAN.md, phase 1). Runs inside the
 * edit-mode site frame: a click resolves to the nearest marked region and is
 * reported to the editor (the parent window) over the postMessage bridge; editor
 * messages (apply-field / apply-style / apply-link / highlight) are applied back.
 *
 * `markedAncestor` / `targetOf` / `rectOf` are pure DOM reads (unit-tested in
 * jsdom); `mountFrameBridge` wires the live listeners and is exercised in the
 * browser. No React here.
 */
import {
  FIELD_ATTR,
  HIGHLIGHT_ATTR,
  ITEM_ATTR,
  LINK_ATTR,
  SLOT_ATTR,
  STYLE_ATTR,
  itemMarker,
  parseItemMarker,
} from '@/lib/site-editor/markers'
import {
  type EditorMessage,
  type Rect,
  type SelectTarget,
  frameMessage,
  isEditorMessage,
} from '@/lib/site-editor/bridge'
import { MANAGED_STYLE_PROPS, resolveRegionStyle } from '@/lib/site-editor/style-apply'

const MARKED = `[${FIELD_ATTR}],[${SLOT_ATTR}],[${ITEM_ATTR}],[${STYLE_ATTR}],[${LINK_ATTR}]`

/** How often the frame re-announces `ready`, and how many times, before giving up. See
 *  the handshake note in `mountFrameBridge`. ~10s total. */
export const READY_RETRY_MS = 300
export const READY_RETRIES = 33

/** The nearest ancestor (or self) carrying any `data-lse-*` marker, or null. An
 *  inner item wins over its enclosing slot because `closest` walks up. */
export function markedAncestor(el: Element): Element | null {
  return el.closest(MARKED)
}

/** The SelectTarget a marked element represents (field > item > slot > style > link),
 *  or null if its marker is malformed. Style/link are lowest so an element that is BOTH
 *  content and re-styleable/link-powered selects its content on click; its style/link is
 *  reached from the inspector (which reads the element's marker alongside). */
export function targetOf(marked: Element): SelectTarget | null {
  const field = marked.getAttribute(FIELD_ATTR)
  if (field) return { kind: 'field', key: field }
  const item = marked.getAttribute(ITEM_ATTR)
  if (item !== null) {
    const parsed = parseItemMarker(item)
    return parsed ? { kind: 'item', assetType: parsed.assetType, id: parsed.id } : null
  }
  const slot = marked.getAttribute(SLOT_ATTR)
  if (slot) return { kind: 'slot', key: slot }
  const style = marked.getAttribute(STYLE_ATTR)
  if (style) return { kind: 'style', key: style }
  const link = marked.getAttribute(LINK_ATTR)
  if (link) return { kind: 'link', key: link }
  return null
}

/** A region's viewport box, for the editor's selection overlay. */
export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Optimistically apply an edited field value into the frame's DOM: an image
 *  field updates its `src`, any other (text) field updates its text. No-op if the
 *  field isn't present. Keys are identifier-safe, so plain attribute selection. */
export function applyFieldToDom(root: ParentNode, key: string, value: string): void {
  const el = root.querySelector(`[${FIELD_ATTR}="${key}"]`)
  if (!el) return
  if (el instanceof HTMLImageElement) el.src = value
  else el.textContent = value
}

/** Optimistically repaint ONE image region (`apply-image`): the marked element's own
 *  `src` if it is an <img>, else the first <img> inside it. Never writes text — an
 *  image URL landing as textContent is worse than no repaint — and a '' url is left to
 *  the init-data refresh, since what "empty" looks like is the template's call. */
export function applyImageToDom(root: ParentNode, key: string, url: string): void {
  if (!url) return
  const el = root.querySelector(`[${FIELD_ATTR}="${key}"]`)
  if (!el) return
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
  if (img) img.src = url
}

/** Each styled element's ORIGINAL class list, captured the first time the editor touches
 *  it. A per-item overlay merges onto this rather than onto the previous overlay's result
 *  — otherwise every keystroke would compound and the classes would grow without bound.
 *  Keyed on the node, so it dies with the document. */
const BASE_CLASSES = new WeakMap<Element, string>()

/**
 * Optimistically apply an edited class string onto the styled region.
 *
 * Section regions REPLACE and per-item regions ADD to the element's base classes
 * (`style-apply.ts`), and any arbitrary hex colour is applied as an INLINE style because
 * no build can compile one. Managed colour properties are cleared before each apply, so
 * removing a colour in the panel removes it here too instead of leaving the last one
 * stuck on the element.
 *
 * No-op if the region isn't present. A ':' in a per-item key is fine inside a quoted
 * attribute selector — and per-item keys are any `<kind>:<id>` (`slot:<role>` or an
 * asset type from `ASSET_TYPES`, e.g. `image:`/`video:`), not a fixed pair.
 */
export function applyStyleToDom(root: ParentNode, key: string, className: string): void {
  const el = root.querySelector(`[${STYLE_ATTR}="${key}"]`)
  if (!el) return
  if (!BASE_CLASSES.has(el)) BASE_CLASSES.set(el, el.getAttribute('class') ?? '')
  const resolved = resolveRegionStyle(key, BASE_CLASSES.get(el) ?? '', className)
  el.setAttribute('class', resolved.className)
  if (el instanceof HTMLElement) {
    // One pass sets what the resolved style carries and clears what it doesn't — the
    // CSSOM camelCase index accepts both, so no name conversion is needed.
    for (const prop of MANAGED_STYLE_PROPS) el.style[prop] = resolved.style[prop] ?? ''
  }
  // Playback speed is a DOM property, not CSS. The marked region may be the <video>
  // itself or a wrapper around it; clearing the token resets to normal speed.
  const video = el instanceof HTMLVideoElement ? el : el.querySelector('video')
  if (video) video.playbackRate = resolved.playbackRate ?? 1
}

/** Optimistically set a link-powered element's href by key. No-op if the region isn't
 *  present. A blank url clears the href (the button falls back to inert). */
export function applyLinkToDom(root: ParentNode, key: string, url: string): void {
  const el = root.querySelector(`[${LINK_ATTR}="${key}"]`)
  if (!el) return
  if (url) el.setAttribute('href', url)
  else el.removeAttribute('href')
}

/** The attribute selector that finds a SelectTarget's marked element — the inverse
 *  of `targetOf`. Used to resolve an editor `highlight` back to a DOM node. Keys are
 *  identifier-safe and item markers carry a single `:`, both fine unquoted-value here. */
export function highlightSelector(target: SelectTarget): string {
  switch (target.kind) {
    case 'field':
      return `[${FIELD_ATTR}="${target.key}"]`
    case 'slot':
      return `[${SLOT_ATTR}="${target.key}"]`
    case 'item':
      return `[${ITEM_ATTR}="${itemMarker(target.assetType, target.id)}"]`
    case 'style':
      return `[${STYLE_ATTR}="${target.key}"]`
    case 'link':
      return `[${LINK_ATTR}="${target.key}"]`
  }
}

/** Move the highlight to `target`'s element: clear any prior `data-lse-highlight`, then
 *  mark the match. Returns the newly-marked element (so the caller can scroll it into
 *  view) or null if the region isn't on the page. The frame styles `[data-lse-highlight]`. */
export function applyHighlightToDom(root: ParentNode, target: SelectTarget): Element | null {
  clearHighlightFromDom(root)
  const el = root.querySelector(highlightSelector(target))
  if (el) el.setAttribute(HIGHLIGHT_ATTR, '')
  return el
}

/** Drop the highlight from whichever region holds it. No-op if none does. */
export function clearHighlightFromDom(root: ParentNode): void {
  root.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR))
}

/**
 * Wire the live frame bridge. Reports selects to `target` (default the parent
 * window), and applies editor messages onto the DOM. Returns a teardown. The
 * caller (the edit-mode client) passes the trusted editor origin; we only act on
 * messages from it.
 */
export function mountFrameBridge(options: {
  editorOrigin: string
  onEditorMessage?: (msg: EditorMessage) => void
  target?: Window
}): () => void {
  const target = options.target ?? window.parent

  const post = (msg: object) => target.postMessage(msg, options.editorOrigin)

  const onClick = (e: MouseEvent) => {
    const el = e.target as Element | null
    const marked = el && markedAncestor(el)
    if (!marked) return post(frameMessage({ type: 'deselect' }))
    // In edit mode a click SELECTS the region; don't let it navigate / submit.
    e.preventDefault()
    const sel = targetOf(marked)
    if (sel) post(frameMessage({ type: 'select', target: sel, rect: rectOf(marked) }))
  }

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== options.editorOrigin || !isEditorMessage(e.data)) return
    // Any message proves the editor is listening, so stop re-announcing.
    stopAnnouncing()
    // ...except `hello`, which IS the editor asking us to announce. It arrives when the
    // editor mounted after our announcements were already spent.
    if (e.data.type === 'hello') return post(frameMessage({ type: 'ready' }))
    // apply-field updates the DOM here (generic frame behaviour); everything else
    // goes to the caller.
    if (e.data.type === 'apply-field') applyFieldToDom(document, e.data.key, e.data.value)
    else if (e.data.type === 'apply-image') applyImageToDom(document, e.data.key, e.data.url)
    else if (e.data.type === 'apply-style') applyStyleToDom(document, e.data.key, e.data.className)
    else if (e.data.type === 'apply-link') applyLinkToDom(document, e.data.key, e.data.url)
    else if (e.data.type === 'highlight') {
      // Outline the region and bring it on-screen so a tile click in the inspector
      // reveals the matching element even when it's scrolled out of the frame.
      applyHighlightToDom(document, e.data.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (e.data.type === 'clear-highlight') clearHighlightFromDom(document)
    else options.onEditorMessage?.(e.data)
  }

  /**
   * `ready` carries the frame's edit-list, and a postMessage sent before the editor has
   * attached its listener is gone for good — there is no queue and no error. Announcing
   * exactly once made the whole handshake a race: win it and the editor is data-driven,
   * lose it and the panel silently reads "0 regions" with every declared component
   * missing. It was survivable while the frame was same-origin and instant; a remote
   * custom site changed the timing and it started losing regularly.
   *
   * So the frame keeps announcing until the editor says anything back. Re-announcing is
   * harmless — the editor just re-reads the same manifest — and the retries stop on the
   * first reply, so a healthy load posts once or twice.
   */
  let announce: ReturnType<typeof setInterval> | null = null
  let attempts = 0
  const stopAnnouncing = () => {
    if (announce) clearInterval(announce)
    announce = null
  }

  document.addEventListener('click', onClick, true)
  window.addEventListener('message', onMessage)
  post(frameMessage({ type: 'ready' }))
  announce = setInterval(() => {
    // Bounded: if nothing has answered in ~10s the editor isn't there (someone opened
    // the frame route directly), and a forever-timer would just burn cycles.
    if (++attempts >= READY_RETRIES) return stopAnnouncing()
    post(frameMessage({ type: 'ready' }))
  }, READY_RETRY_MS)

  return () => {
    stopAnnouncing()
    document.removeEventListener('click', onClick, true)
    window.removeEventListener('message', onMessage)
  }
}
